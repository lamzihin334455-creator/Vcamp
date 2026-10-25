import { nativeDeepSeek, providerBaseUrl, sameProviderConnection } from '../contracts/provider-config';
import {webOptions} from '../contracts/web';
import { instructionTraces } from './instruction-trace';
import {executeGeneration} from './executor';
import {wakeVisionDecision} from './run-vision';
import { currentPageConsent } from '../video/media-hosts';
import { isLegacyHtmlTemplate } from '../contracts/template';
import { subtitleBatches } from './run-subtitle';
import { ApplicationError } from '../contracts/application';
import { terminal, type ChatRequestSnapshot, type GenerationJob, type GenerationPort, type RequestTarget } from '../contracts/generation';
import { sameBinding, type Cue, type VideoView } from '../contracts/video';
import type { ProviderService } from '../contracts/provider';
import { IndexedGenerationStore } from '../data/generation-store';
import { IndexedWorkspaceStore } from '../data/indexed-store';
import { limits, subtitleBasis } from './subtitle-context';
import { grantKey, releaseMedia } from '../video/original-media';
import { fallbackEvidencePreparation, type EvidencePreparationPort } from './evidence-preparation';
import {withWebPermission} from '../contracts/evidence';
import { providerModelId } from './provider-model-routing';

export interface TaskHost {
  start?(ownerId:number,jobId:string,attemptId:string,cues:Cue[],changed:()=>void,done:()=>void): void;
  cancel?(jobId: string, attemptId: string): Promise<void>;
  create(): Promise<number>; navigate(tabId: number, jobId: string, attemptId: string): Promise<void>;
  exists(tabId: number, jobId: string, attemptId: string): Promise<boolean>; close(tabId: number): Promise<void>;
}
export interface ExecutorSender { id?: string; url?: string; frameId?: number; tab?: { id?: number } }
export function createTaskService(store: IndexedGenerationStore, spaces: IndexedWorkspaceStore, provider: ProviderService,
  currentVideo: (windowId?: number) => Promise<VideoView>, host: TaskHost, extensionId: string, changed: () => void, subtitles = store.subtitleStore, _legacyAutoVision: (target: { workspaceId: string; chatId: string }) => Promise<boolean> = async () => false, evidencePreparation: EvidencePreparationPort = fallbackEvidencePreparation, roleAllOutputs:()=>Promise<boolean>=async()=>false) {
  const raw = new Map<string, Cue[]>();
  let queue = Promise.resolve();
  const serial = <T>(work: () => Promise<T>) => { const task = queue.then(work); queue = task.then(() => {}, () => {}); return task; };
  const ready = serial(async () => {
    for (const job of await store.list()) {
      const attempt = job.attempts.at(-1)!;
      if (terminal(attempt.state)) { await releaseMedia(job.jobId, attempt.attemptId).catch(() => {}); if (attempt.executor && await host.exists(attempt.executor.tabId, job.jobId, attempt.attemptId)) await host.close(attempt.executor.tabId).catch(() => {}); continue; }
      if (!attempt.executor || !await host.exists(attempt.executor.tabId, job.jobId, attempt.attemptId)) {
        await store.finish(job.jobId, attempt.attemptId, 'interrupted', 'executor-lost'); changed();
        await releaseMedia(job.jobId, attempt.attemptId).catch(() => {});
      }
      // A surviving page owns its raw subtitles, fetch and credential. No POST
      // is dispatched here; recovery only checks the recorded executor.
    }
  });
  void ready.catch(() => {});
  const targetFor = (job: GenerationJob): RequestTarget => job.snapshot.target;
  async function validateModel(modelId: string) {
    const state = await provider.command({ type: 'provider.query' });
    modelId = providerModelId(state, modelId);
    if (!state.hasKey || !state.models.some(model => model.id === modelId && model.text !== 'unsupported')) throw new ApplicationError('model-unavailable');
    return { connection: { providerId: state.providerId, baseUrl: providerBaseUrl(state), ...(state.profileId ? { profileId: state.profileId } : {}) }, revision: state.revision, visionDeclared: nativeDeepSeek(state) && state.models.find(model=>model.id===modelId)!.vision==='declared', webAvailable: nativeDeepSeek(state) && state.models.some(model=>model.id==='deepseek-flash'&&model.text!=='unsupported') };
  }
  async function validateWeb(enabled:boolean) {
    if(!enabled)return;
    const state=await provider.command({type:'provider.query'});
    if(!nativeDeepSeek(state)||!state.hasKey||!state.models.some(m=>m.id==='deepseek-flash'&&m.text!=='unsupported'))throw new ApplicationError('web-unsupported');
  }
  async function release(job: GenerationJob) {
    raw.delete(job.jobId);
    const attempt = job.attempts.at(-1)!;

    if (attempt.executor) await host.cancel?.(job.jobId, attempt.attemptId).catch(() => {});
    await releaseMedia(job.jobId, attempt.attemptId).catch(() => {});
    if (attempt.executor && await host.exists(attempt.executor.tabId, job.jobId, attempt.attemptId)) await host.close(attempt.executor.tabId).catch(() => {});
  }
  function pump() {
    return serial(async () => {
      const jobs = await store.list();
      let available = limits.concurrent - jobs.filter(job => { const attempt = job.attempts.at(-1)!; return !terminal(attempt.state) && !!attempt.executor; }).length;
      const subtitles = new Set(jobs.filter(job => job.snapshot.target.kind === 'subtitle' && !!job.attempts.at(-1)!.executor && !terminal(job.attempts.at(-1)!.state)).map(job => job.snapshot.target.workspaceId));
      for (const job of jobs) {
        const attempt = job.attempts.at(-1)!;
        if (available <= 0) break;
        if (attempt.state !== 'queued' || (job.snapshot.target.kind === 'subtitle' && subtitles.has(job.snapshot.target.workspaceId))) continue;
        if (!raw.has(job.jobId)) { await store.finish(job.jobId, attempt.attemptId, 'interrupted', 'executor-lost'); changed(); continue; }
        let tabId: number | undefined;
        try {
          tabId = await host.create();
          await store.attach(job.jobId, attempt.attemptId, tabId);
          if(host.start){const cues=raw.get(job.jobId)!;raw.delete(job.jobId);host.start(tabId,job.jobId,attempt.attemptId,cues,changed,()=>{changed();void pump();});}
          else await host.navigate(tabId, job.jobId, attempt.attemptId);
          available--;
          if (job.snapshot.target.kind === 'subtitle') subtitles.add(job.snapshot.target.workspaceId);
          changed();
        } catch {
          await store.finish(job.jobId, attempt.attemptId, 'failed', 'executor-lost');
          raw.delete(job.jobId); if (tabId !== undefined) await host.close(tabId).catch(() => {}); changed();
        }
      }
    });
  }
  async function getJob(jobId: string) { const job = await store.get(jobId); if (!job) throw new ApplicationError('not-found'); return job; }
  function authorize(sender: ExecutorSender, job: GenerationJob, attemptId: string) {
    const attempt = job.attempts.at(-1)!;
    if (sender.id !== extensionId || sender.frameId !== 0 || sender.tab?.id !== attempt.executor?.tabId || attempt.attemptId !== attemptId
      || sender.url !== `chrome-extension://${extensionId}/executor.html#${job.jobId}/${attemptId}`) throw new ApplicationError('forbidden');
  }
  const port: GenerationPort = { async command(op, windowId) {
    await ready;
    if (op.type === 'generation.query') return store.view(op.target);
    if (op.type === 'generation.send') {
      const space = await spaces.read(op.target.workspaceId, op.target.chatId);
      if (!space) throw new ApplicationError('not-found');
      const storedPlanningContext = await store.planningContext(op.target, op.expectedRevision);
      const { connection, revision: providerRevision, visionDeclared, webAvailable }=await validateModel(storedPlanningContext.modelId);
      // Video-frame planning is opt-in for this draft. A template may describe
      // frames as desirable, but it cannot authorize reading the source video.
      const requestedVision = !op.subtitleOnly && (storedPlanningContext.explicitSources??[]).includes('video_frames');
      if (requestedVision && !visionDeclared) throw new ApplicationError('unsupported-capability');
      const sources = await subtitles.query(op.target.workspaceId);
      const selectedSource = sources.analysisSource;
      const liveVideo = await currentVideo(windowId);
      let cues: Cue[], basis;
      if (selectedSource.kind !== 'native') {
        if (!sources.sourceValid) throw new ApplicationError('source-changed');
        const version = sources.versions.find(version => version.id === selectedSource.versionId)!;
        cues = version.cues;
        // Stable workspace identity, no page fetch required for saved content.
        const binding = { platform: space.source.platform, videoId: space.source.videoId, partId: space.source.partId, tabId: 0, documentId: 'saved-subtitle', epoch: 1 };
        basis = { ...await subtitleBasis(binding, version.language, cues, {mediaDuration:liveVideo.playback?.duration??undefined}), subtitleVersionId: version.id };
      } else {
        if (!op.binding || !sameBinding(liveVideo.binding, op.binding)) throw new ApplicationError('stale-binding');
        if(liveVideo.status==='no-subtitles'&&requestedVision&&visionDeclared){
          cues=[];basis=await subtitleBasis(op.binding,null,cues,{allowEmpty:true,mediaDuration:liveVideo.playback?.duration??Math.max(1,(liveVideo.playback?.time??0)+1)});
        }else{
          if(liveVideo.status!=='ready')throw new ApplicationError('stale-binding');
          const track = selectedSource.language ? liveVideo.tracks?.find(track => track.language === selectedSource.language && track.status === 'ready') : undefined;
          if (selectedSource.language && !track) throw new ApplicationError('source-changed');
          cues = track?.cues ?? liveVideo.cues; basis = await subtitleBasis(op.binding, track?.language ?? liveVideo.language, cues,{mediaDuration:liveVideo.playback?.duration??undefined});
        }
        if (!sameBinding((await currentVideo(windowId)).binding, op.binding)) throw new ApplicationError('stale-binding');
      }
      if (!op.binding || !sameBinding(liveVideo.binding, op.binding) || op.binding.videoId !== space.source.videoId || op.binding.partId !== space.source.partId) throw new ApplicationError('stale-binding');
      const requestedWeb=(storedPlanningContext.explicitSources??[]).includes('web');
      await validateWeb(requestedWeb);
      const planningContext = { ...storedPlanningContext, explicitSources: op.subtitleOnly ? (storedPlanningContext.explicitSources??[]).filter(source => source !== 'video_frames') : storedPlanningContext.explicitSources??[], hasFullSubtitles: cues.length > 0, canUseVideoFrames: requestedVision && visionDeclared && !!op.binding, canUseWeb: requestedWeb && webAvailable };
      const traceId = crypto.randomUUID();
      const evidence = withWebPermission(await evidencePreparation.prepare({ source: space.source, context: planningContext, traceId, providerConnection: connection }),requestedWeb);
      const enabled = requestedVision && evidence.includedSources.includes('video_frames');
      if (!sameBinding((await currentVideo(windowId)).binding, op.binding)) throw new ApplicationError('stale-binding');
      if (op.preauthorize && (!enabled || !op.binding || !sameBinding((await currentVideo(windowId)).binding, op.binding)
        || op.binding.videoId !== basis.binding.videoId || op.binding.partId !== basis.binding.partId)) throw new ApplicationError('stale-binding');
      // Saved enhanced subtitles keep their frozen analysis identity; the media
      // capability, if explicitly granted, binds the verified source document.
      if (enabled && op.binding && op.binding.videoId === basis.binding.videoId && op.binding.partId === basis.binding.partId) basis.binding = op.binding;
      const consent = op.preauthorize ? await currentPageConsent(basis.binding).catch(() => { throw new ApplicationError('stale-binding'); }) : undefined;
      if ((await provider.command({ type: 'provider.query' })).revision !== providerRevision) throw new ApplicationError('revision-conflict');
      const job = await store.freezeChat(op.target, op.expectedRevision, basis, visionDeclared, enabled, evidence, await roleAllOutputs(), connection);
      try { await instructionTraces().link(traceId, job.jobId, job.attempts.at(-1)!.attemptId); } catch { /* Inspection must not block generation. */ }
      if (op.preauthorize) await chrome.storage.session.set({ [grantKey(job.attempts.at(-1)!.attemptId)]: { ...consent, jobId: job.jobId, binding: basis.binding } });
      raw.set(job.jobId, structuredClone(cues)); changed(); await pump();
      return store.view(op.target);
    }
    if (op.type === 'generation.subtitle.send') {
      if (op.target.operation === 'translate' && !op.targetLanguage) throw new ApplicationError('invalid-message');
      const { connection } = await validateModel(op.modelId);
      await validateWeb(op.subtitleWorkflow===2&&op.webEnabled===true);
      let cues: Cue[], basis;
      if (op.sourceVersionId) {
        const version = (await subtitles.query(op.target.workspaceId, op.sourceVersionId)).versions[0];
        const previous = await store.get(version.jobId);
        if (!previous) throw new ApplicationError('source-changed');
        cues = version.cues;
        basis = { ...await subtitleBasis(previous.basis.binding, version.language, cues,{purpose:'subtitle'}), subtitleVersionId: version.id };
      } else {
        const video = await currentVideo(windowId);
        if (!op.binding || video.status !== 'ready' || !sameBinding(video.binding, op.binding)) throw new ApplicationError('stale-binding');
        const track = op.sourceLanguage ? video.tracks?.find(track => track.language === op.sourceLanguage && track.status === 'ready') : undefined;
        if (op.sourceLanguage && !track) throw new ApplicationError('source-changed');
        cues = track?.cues ?? video.cues; basis = await subtitleBasis(op.binding, track?.language ?? video.language, cues,{purpose:'subtitle'});
        if (!sameBinding((await currentVideo(windowId)).binding, op.binding)) throw new ApplicationError('stale-binding');
      }
      subtitleBatches(cues);
      const subtitleSpace=op.subtitleWorkflow===2?(await spaces.emptySpace?.(op.target.workspaceId)??await spaces.read(op.target.workspaceId)):undefined;
      const job = await store.freezeSubtitle({ providerConnection: connection, ...(op.subtitleWorkflow===2?{subtitleWorkflow:2 as const,webEnabled:op.webEnabled===true,...(op.webEnabled?{web:webOptions()}:{}),videoTitle:subtitleSpace?.source.videoTitle??subtitleSpace?.source.title}:{}),snapshotId: crypto.randomUUID(), target: op.target, source: basis.subtitleVersionId ? { subtitleVersionId: basis.subtitleVersionId } : { locator: basis.locator, fingerprint: basis.fingerprint }, targetLanguage: op.target.operation === 'translate' ? op.targetLanguage : null, requirements: op.requirements ?? '', modelId: op.modelId }, basis);
      raw.set(job.jobId, structuredClone(cues)); changed(); await pump();
      return store.view(op.target);
    }
    const job = await getJob(op.jobId), attempt = job.attempts.at(-1)!;
    if (op.type === 'generation.vision.decide') {
      if (op.choice === 'images') {
        if (!sameBinding((await currentVideo(windowId)).binding, job.basis.binding)) throw new ApplicationError('stale-binding');
        const consent=await currentPageConsent(job.basis.binding).catch(()=>{throw new ApplicationError('stale-binding');});
        await chrome.storage.session.set({ [grantKey(attempt.attemptId)]: { ...consent, jobId: job.jobId, binding: job.basis.binding } });
      }
      try { await store.decideVisual(job.jobId, op.choice); }
      catch (error) { await chrome.storage.session.remove(grantKey(attempt.attemptId)); throw error; }
      changed(); wakeVisionDecision(job.jobId,attempt.attemptId);
      await chrome.runtime.sendMessage({ type: 'executor.wake', jobId: job.jobId, attemptId: attempt.attemptId }).catch(() => {});
      return store.view(job.snapshot.target);
    }
    if (op.type === 'generation.stop') {
      if(attempt.state==='committing')return store.view(job.snapshot.target);
      const stopped = await store.finish(job.jobId, attempt.attemptId, 'stopped');
      await release(stopped); changed(); await pump();
    } else {
      if ('outputType' in job.snapshot && job.snapshot.outputType === 'html' && ((job.snapshot.htmlFormat!==1 && job.snapshot.knowledgeFormat !== 1) || isLegacyHtmlTemplate(job.snapshot.templateSnapshot))) throw new ApplicationError('legacy-knowledge');
      const vision=await validateModel(job.snapshot.modelId);
      if (!sameProviderConnection(job.snapshot.providerConnection, vision.connection)) throw new ApplicationError('model-unavailable');
      if(job.snapshot.target.kind==='chat' && (job.snapshot as ChatRequestSnapshot).webEnabled){
        const current=await spaces.read(job.snapshot.target.workspaceId,job.snapshot.target.chatId);
        if(!current?.draft.webEnabled)throw new ApplicationError('web-disabled');
      }
      await validateWeb('webEnabled' in job.snapshot&&job.snapshot.webEnabled===true);
      if('attachmentIds' in job.snapshot && (job.snapshot.attachmentIds.length||job.snapshot.historyProjection.some(h=>h.attachmentIds.length))&&!vision.visionDeclared)throw new ApplicationError('unsupported-capability');
      let cues: Cue[];
      if (job.basis.subtitleVersionId) {
        const version = (await subtitles.query(job.snapshot.target.workspaceId, job.basis.subtitleVersionId).catch(() => { throw new ApplicationError('source-changed'); })).versions[0];
        const basis = await subtitleBasis(job.basis.binding, version.language, version.cues,{mediaDuration:job.basis.mediaDuration});
        if (basis.fingerprint !== job.basis.fingerprint) throw new ApplicationError('source-changed');
        cues = version.cues;
      } else if((job.snapshot as ChatRequestSnapshot).visionOnly){
        const video=await currentVideo(windowId);
        if(video.status!=='no-subtitles'||!video.binding||video.binding.videoId!==job.basis.binding.videoId||video.binding.partId!==job.basis.binding.partId)throw new ApplicationError('source-changed');
        const basis=await subtitleBasis(video.binding,null,[],{allowEmpty:true,mediaDuration:video.playback?.duration??job.basis.mediaDuration});
        if(basis.fingerprint!==job.basis.fingerprint||basis.locator!==job.basis.locator)throw new ApplicationError('source-changed');
        cues=[];
      } else {
        const video = await currentVideo(windowId);
        if (video.status !== 'ready' || !video.binding || video.binding.videoId !== job.basis.binding.videoId || video.binding.partId !== job.basis.binding.partId) throw new ApplicationError('source-changed');
        const track=job.basis.language?video.tracks?.find(track=>track.language===job.basis.language&&track.status==='ready'):undefined;
        if(job.basis.language&&video.tracks?.length&&!track)throw new ApplicationError('source-changed');
        const selectedCues=track?.cues??video.cues;
        const basis = await subtitleBasis(video.binding, track?.language??video.language, selectedCues,{...(job.snapshot.target.kind==='subtitle'?{purpose:'subtitle' as const}:{}),mediaDuration:video.playback?.duration??job.basis.mediaDuration});
        if (basis.fingerprint !== job.basis.fingerprint || basis.locator !== job.basis.locator) throw new ApplicationError('source-changed');
        cues = selectedCues;
      }
      if (job.snapshot.target.kind === 'subtitle') subtitleBatches(cues);
      await store.retry(job.jobId); raw.set(job.jobId, structuredClone(cues)); changed(); await pump();
    }
    return store.view(targetFor(job));
  } };
  return {
    ...port,
    currentVideo,
    async releaseDeleted(jobs: GenerationJob[]) {
      await ready;
      changed(); // the durable cancellation/deletion transaction already committed
      await serial(async () => { for (const job of jobs) await release(job).catch(() => {}); });
      await pump();
    },
    async boot(jobId: string, attemptId: string, sender: ExecutorSender) {
      await ready;
      const job = await getJob(jobId); authorize(sender, job, attemptId);
      const attempt = job.attempts.at(-1)!;
      if (terminal(attempt.state)) return null;
      const cues = raw.get(jobId);
      if (attempt.claimed || !cues) {
        await store.finish(jobId, attemptId, 'interrupted', 'executor-lost'); changed();
        return null;
      }
      raw.delete(jobId); // transferred only to the verified trusted task page
      return { cues };
    },
    async notification(jobId: string, attemptId: string, sender: ExecutorSender) {
      await ready;
      const job = await getJob(jobId); authorize(sender, job, attemptId);
      changed();
      if (terminal(job.attempts.at(-1)!.state)) { await release(job); await pump(); }
    },
    async removed(tabId: number) {
      await ready;
      for (const job of await store.list()) {
        const attempt = job.attempts.at(-1)!;
        if (!terminal(attempt.state) && attempt.executor?.tabId === tabId) {
          await store.finish(job.jobId, attempt.attemptId, 'interrupted', 'executor-lost'); raw.delete(job.jobId); changed();
          await releaseMedia(job.jobId, attempt.attemptId).catch(() => {});
        }
      }
      await pump();
    }
  };
}
// Negative owner IDs cannot collide with Chrome tabs or surviving legacy page
// executors. A worker restart loses this map, so recovery marks tasks interrupted
// rather than dispatching a duplicate paid request.
export function createChromeTaskHost(): TaskHost {
  let next=0;
  const running=new Map<number,{jobId:string;attemptId:string;controller:AbortController;done:Promise<void>}>();
  return {
    async create(){return --next;},
    async navigate(){throw new Error('Worker tasks do not navigate');},
    start(ownerId,jobId,attemptId,cues,changed,finished){
      const controller=new AbortController();
      // Chrome API activity keeps only active work alive; no hidden page/tab.
      const keepAlive=setInterval(()=>{void chrome.runtime.getPlatformInfo().catch(()=>{});},20000);
      const done=executeGeneration(jobId,attemptId,ownerId,cues,controller,changed).finally(()=>{clearInterval(keepAlive);running.delete(ownerId);finished();});
      running.set(ownerId,{jobId,attemptId,controller,done});void done.catch(()=>{});
    },
    async cancel(jobId,attemptId){const task=[...running.values()].find(v=>v.jobId===jobId&&v.attemptId===attemptId);if(task){task.controller.abort();await task.done;}},
    async exists(ownerId,jobId,attemptId){const task=running.get(ownerId);return task?.jobId===jobId&&task.attemptId===attemptId;},
    async close(ownerId){const task=running.get(ownerId);if(task){task.controller.abort();await task.done;}}
  };
}
