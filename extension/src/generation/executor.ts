import { tracedTransport } from './instruction-trace';
import { providerModelId } from './provider-model-routing';
import { ApplicationError } from '../contracts/application';
import { IndexedAttachmentStore } from '../data/attachment-store';
import {IndexedWorkspaceStore} from '../data/indexed-store';
import { runSubtitle } from './run-subtitle';
import { z } from 'zod';
import { nativeDeepSeek, sameProviderConnection } from '../contracts/provider-config';
import { providerCredentialSchema } from '../contracts/provider';
import { cueSchema } from '../contracts/video';
import {subtitleInputLimits} from '../contracts/subtitle-limits';
import type { ChatRequestSnapshot, SubtitleRequestSnapshot, Coverage,GenerationFailure } from '../contracts/generation';
import { terminal } from '../contracts/generation';
import { IndexedGenerationStore } from '../data/generation-store';
import { createCredentialStore } from './credential-store';
import { createProviderPort, providerCompletionEndpoint, ProviderError } from './provider-port';
import { runChat, prepareChatContext } from './run-chat';
import { runVision } from './run-vision';
import { releaseMedia } from '../video/original-media';
import {createWebEvidencePort} from './web-evidence-port';
import {webErrors} from '../contracts/web';

export function createInvalidationThrottle(changed:()=>void,interval=80){
  let timer:ReturnType<typeof setTimeout>|undefined,last:number|null=null;
  const emit=()=>{timer=undefined;last=Date.now();changed();};
  return {
    notify(){const now=Date.now();if(last===null||now-last>=interval){if(timer)clearTimeout(timer);emit();return;}timer??=setTimeout(emit,interval-(now-last));},
    flush(){if(timer)clearTimeout(timer);timer=undefined;emit();}
  };
}

// The same frozen task pipeline runs in the trusted extension worker. No
// auxiliary tab, document or preview is created for a generation.
export async function executeGeneration(jobId:string,attemptId:string,ownerId:number,cues:unknown,controller:AbortController,changed:()=>void) {
  const store = new IndexedGenerationStore();
  let seq = 0;
  // Persist every accepted delta, but avoid turning every token into a full
  // workspace and generation query on every visible extension surface.
  const invalidation=createInvalidationThrottle(changed);
  const notify = async () => { invalidation.notify(); };
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const boot = {cues};
    const parsed = z.object({ cues: z.array(cueSchema).max(subtitleInputLimits.cueCount) }).strict().safeParse(boot);
    if (!parsed.success) return;
    const job = await store.claim(jobId, attemptId, ownerId);
    if (!job) return;
    if(job.snapshot.target.kind==='subtitle')timer=setTimeout(()=>controller.abort(),2*60*60*1000);
    if(!parsed.data.cues.length&&!(job.snapshot.target.kind==='chat'&&(job.snapshot as ChatRequestSnapshot).visionOnly))throw new ProviderError('protocol');
    seq = job.seq; await notify();
    const credential = providerCredentialSchema.parse(await createCredentialStore(chrome.storage.local).read());
    if (!sameProviderConnection(job.snapshot.providerConnection, credential)) throw new ProviderError('model-unavailable');
    if (!nativeDeepSeek(credential) && ('autoVision' in job.snapshot && job.snapshot.autoVision || 'webEnabled' in job.snapshot && job.snapshot.webEnabled)) throw new ProviderError('web-unsupported');
    if (!credential.key || !credential.models.some(model => providerModelId(credential, model.id) === providerModelId(credential, job.snapshot.modelId) && model.text !== 'unsupported')) throw new ProviderError('model-unavailable');
    if('attachmentIds' in job.snapshot && (job.snapshot.attachmentIds.length||job.snapshot.historyProjection.some(h=>h.attachmentIds.length))&&!credential.models.some(model=>model.id===job.snapshot.modelId&&model.vision==='declared'))throw new ProviderError('model-unavailable');
    const transport = tracedTransport({ traceId: attemptId, jobId, attemptId }, credential.key);
    const provider = createProviderPort(credential.key, transport, providerCompletionEndpoint(credential), async diagnostic => {
      const changed = await store.diagnostic(jobId, attemptId, diagnostic);
      // Cancellation waits for executor cleanup while holding the task queue.
      // Never await an invalidation back into that queue from this finalizer.
      seq = changed.seq; void notify();
    }, credential);
    async function checkpoint(text: string, coverage: Coverage) {
      const updated = await store.checkpoint(jobId, attemptId, seq + 1, text, coverage);
      if (terminal(updated.attempts.at(-1)!.state)) { controller.abort(); throw new ProviderError('executor-lost'); }
      seq = updated.seq; await notify();
    }
    if (job.snapshot.target.kind === 'chat') {
      const snapshot = job.snapshot as ChatRequestSnapshot;
      let web, prepared;
      if(snapshot.webEnabled){
        // A queued task or an old snapshot must not dispatch a new search after
        // the user has turned this conversation off.
        if(!(await new IndexedWorkspaceStore().read(snapshot.target.workspaceId,snapshot.target.chatId))?.draft.webEnabled)throw new ProviderError('web-disabled');
        if(!snapshot.web||!credential.models.some(m=>m.id===snapshot.web!.modelId&&m.text!=='unsupported'))throw new ProviderError('web-unsupported');
        // The boot source has already been checked against the frozen basis.
        // Reuse this full preparation for search, planning and final answer.
        // Never persist raw subtitle/search material in the request snapshot.
        prepared=await prepareChatContext(snapshot,parsed.data.cues,provider,controller.signal,checkpoint);
        const searching={version:1 as const,status:'searching' as const,retrievedAt:new Date().toISOString(),executionLinked:false,sources:[],references:[],excludedSources:0,usage:{}};
        const progress=await store.webEvidence(jobId,attemptId,searching);seq=progress.seq;await notify();
        if(terminal(progress.attempts.at(-1)!.state))throw new ProviderError('executor-lost');
        web=await createWebEvidencePort(credential.key, transport,async diagnostic=>{const updated=await store.diagnostic(jobId,attemptId,diagnostic);seq=updated.seq;void notify();},async()=>!controller.signal.aborted&&!!(await new IndexedWorkspaceStore().read(snapshot.target.workspaceId,snapshot.target.chatId))?.draft.webEnabled).retrieve({options:snapshot.web,question:(snapshot.input||snapshot.templateSnapshot?.requirements||'根据当前视频补充资料')+(snapshot.knowledgeContext?`\n选中知识：${snapshot.knowledgeContext.title} ${snapshot.knowledgeContext.entry.body}`:''),videoTitle:snapshot.videoTitle,...(prepared.coverage.total?{videoContext:{kind:'full-subtitles' as const,text:prepared.context,totalSegments:prepared.coverage.total,coveredSegments:prepared.coverage.total}}:{})},controller.signal);
        controller.signal.throwIfAborted();
        const retrieved=await store.webEvidence(jobId,attemptId,web.evidence);seq=retrieved.seq;await notify();
        if(terminal(retrieved.attempts.at(-1)!.state))throw new ProviderError('executor-lost');
      }
      const visual = snapshot.autoVision ? await runVision(job, parsed.data.cues, provider, controller.signal,
        credential.models.find(model => model.id === snapshot.modelId)?.vision === 'declared', checkpoint, async changed => { if (terminal(changed.attempts.at(-1)!.state)) { controller.abort(); throw new ProviderError('executor-lost'); } seq = changed.seq; await notify(); }, prepared) : undefined;
      await runChat(snapshot, parsed.data.cues, provider, controller.signal, checkpoint, visual?.images ?? await new IndexedAttachmentStore().forSnapshot(snapshot), visual?.prepared ?? prepared, visual?.ids, visual?.note,web,visual?.delivery);
      if(snapshot.outputType==='markdown'||snapshot.outputType==='html'){const committing=await store.committing(jobId,attemptId);seq=committing.seq;await notify();}
      await store.finish(jobId, attemptId, 'completed', null, crypto.randomUUID());
    } else {
      const snapshot=job.snapshot as SubtitleRequestSnapshot;
      const cues = await runSubtitle(snapshot, parsed.data.cues, provider, controller.signal, checkpoint,{
        async phase(phase){const updated=await store.subtitlePhase(jobId,attemptId,phase);seq=updated.seq;await notify();if(terminal(updated.attempts.at(-1)!.state)){controller.abort();throw new ProviderError('executor-lost');}},
        async lookup(question,signal){
          if(!snapshot.web||!credential.models.some(model=>model.id===snapshot.web!.modelId&&model.text!=='unsupported'))throw new ProviderError('web-unsupported');
          const progress=await store.webEvidence(jobId,attemptId,{version:1,status:'searching',retrievedAt:new Date().toISOString(),executionLinked:false,sources:[],references:[],excludedSources:0,usage:{}});seq=progress.seq;await notify();
          const web=await createWebEvidencePort(credential.key!,transport,async diagnostic=>{const updated=await store.diagnostic(jobId,attemptId,diagnostic);seq=updated.seq;void notify();}).retrieve({options:snapshot.web,question,videoTitle:snapshot.videoTitle},signal);
          const updated=await store.webEvidence(jobId,attemptId,web.evidence);seq=updated.seq;await notify();return `${web.material}\n实际检索来源：${JSON.stringify(web.evidence.sources)}`;
        }
      });
      await store.finish(jobId, attemptId, 'completed', null, crypto.randomUUID(), { kind: 'subtitle', cues });
    }
  } catch (error) {
    // The adapter reports before throwing. If that optional write failed, retry
    // the safe diagnostic before making the attempt terminal; identical rows
    // are deduplicated by the store.
    if(error instanceof ProviderError&&error.diagnostic?.purpose==='web-search')await store.diagnostic(jobId,attemptId,error.diagnostic).catch(()=>{});
    // Fixed error vocabulary, never stringify credentials/network bodies.
    await store.finish(jobId, attemptId, 'failed', error instanceof ProviderError ? error.code : controller.signal.aborted?'timeout':error instanceof ApplicationError && (error.code === 'context-limit' || error.code === 'html-format' || error.code === 'knowledge-format' || error.code === 'legacy-knowledge'||(webErrors as readonly string[]).includes(error.code)) ? error.code as GenerationFailure : 'storage').catch(() => {});
  } finally {
    clearTimeout(timer); controller.abort();
    await releaseMedia(jobId, attemptId).catch(() => {});
    invalidation.flush();
  }
}
