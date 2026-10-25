import {visualEvidenceNote} from './visual-evidence-note';
import type { Attachment } from '../contracts/attachment';
import { ApplicationError } from '../contracts/application';
import { imageLimits } from '../contracts/attachment';
import type { ChatRequestSnapshot, GenerationJob, Coverage } from '../contracts/generation';
import type { Cue } from '../contracts/video';
import { type EvidencePlan, type VisionStage } from '../contracts/vision';
import { IndexedGenerationStore } from '../data/generation-store';
import { IndexedAttachmentStore } from '../data/attachment-store';
import { createOriginalMedia, grantKey } from '../video/original-media';
import { ProviderError, type ProviderPort } from './provider-port';
import { prepareChatContext } from './run-chat';
import { fixedPrompt } from '../prompts/fixed-rules';
import { allocateVisualPlan, completeHistory, explorationPlan, requestTokenBound, selectedHistory, visualPolicy,evidenceDetail } from './visual-selection';
import { purposePolicy } from './purpose-policy';
import { captureEvidence } from './capture-evidence';
import { planVisualEvidence,visionPlanningInput } from './vision-planning';
import { reviewRequest, captureRefinements, canRefine } from './vision-review';
import { reviewVisualEvidence } from './vision-reviewing';
import { instructionTraces } from './instruction-trace';

const decisions = new Map<string, () => void>();
export function wakeVisionDecision(jobId: string, attemptId: string) { decisions.get(jobId + '/' + attemptId)?.(); }

export function visionPlanningTask(snapshot: ChatRequestSnapshot, images: readonly Attachment[] = []) {
  return {
    outputType: snapshot.outputType,
    ...(snapshot.input.trim() ? { request: snapshot.input.trim() } : {}),
    videoTitle: snapshot.videoTitle, videoPartTitle: snapshot.videoPartTitle,
    ...(snapshot.templateSnapshot ? { template: { name: snapshot.templateSnapshot.name, requirements: snapshot.templateSnapshot.requirements } } : {}),
    ...(snapshot.evidence ? { interpretedIntent: snapshot.evidence.plan.interpretedIntent, outputRequirements: snapshot.evidence.plan.outputRequirements, chapters: snapshot.evidence.chapters } : {}),
    relatedHistory: snapshot.historyProjection?.slice(-6).map(h => ({ role: h.role, text: h.text.slice(0, 1000), attachmentIds: h.attachmentIds })),
    historyIsExcerpt: (snapshot.historyProjection?.length ?? 0) > 6 || snapshot.historyProjection?.some(h => h.text.length > 1000),
    ...(snapshot.knowledgeContext ? { selectedKnowledge: snapshot.knowledgeContext } : {}),
    referencedNotes: snapshot.referenceSnapshots?.map(r => ({ title: r.title, content: r.content.slice(0, 1000), isExcerpt: r.content.length > 1000 })),
    existingImages: images.map(i => ({ id: i.id, time: i.time, source: i.source, width: i.width, height: i.height, bytes: i.bytes, ...(i.uploadName ? { uploadName: i.uploadName } : {}), contentNotInspected: true }))
  };
}

async function resolution(store: IndexedGenerationStore, jobId: string, attemptId: string, signal: AbortSignal) {
  return new Promise<'images' | 'subtitle'>((resolve, reject) => {
    let settled = false;
    const finish = (value?: 'images' | 'subtitle') => { if (settled) return; settled = true; decisions.delete(jobId + '/' + attemptId); chrome.runtime.onMessage.removeListener(wake); signal.removeEventListener('abort', abort); value ? resolve(value) : reject(new ProviderError('executor-lost')); };
    const read = async () => { const job = await store.get(jobId); const attempt = job?.attempts.at(-1); if (!attempt || attempt.attemptId !== attemptId || attempt.state !== 'awaiting-permission') finish(); else if (attempt.visual?.resolution) finish(attempt.visual.resolution); };
    const wake = (message: any, sender: chrome.runtime.MessageSender) => { if (sender.id === chrome.runtime.id && message?.type === 'executor.wake' && message.jobId === jobId && message.attemptId === attemptId) void read().catch(() => finish()); };
    decisions.set(jobId + '/' + attemptId, () => { void read().catch(() => finish()); });
    const abort = () => finish(); chrome.runtime.onMessage.addListener(wake); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) finish(); else void read().catch(() => finish());
  });
}

export async function runVision(job: GenerationJob, cues: Cue[], provider: ProviderPort, signal: AbortSignal, visionDeclared: boolean,
  checkpoint: (text: string, coverage: Coverage) => Promise<void>, updated: (job: GenerationJob) => Promise<void>, preparedContext?: Awaited<ReturnType<typeof prepareChatContext>>) {
  const store = new IndexedGenerationStore(), attachments = new IndexedAttachmentStore();
  const snapshot = job.snapshot as ChatRequestSnapshot, attemptId = job.attempts.at(-1)!.attemptId;
  let visual: VisionStage = structuredClone(job.attempts.at(-1)!.visual ?? { phase: 'preparing', attachmentIds: [] });
  let media: Awaited<ReturnType<typeof createOriginalMedia>> | undefined;
  const stage = async (next: VisionStage) => { const changed = await store.visual(job.jobId, attemptId, next); visual = changed.attempts.at(-1)!.visual!; await updated(changed); };
  const choose = async (issue: NonNullable<VisionStage['issue']>, failure?: VisionStage['mediaFailure']) => {
    await media?.release(); media = undefined;
    await stage({ ...visual, phase: 'permission', resolution: undefined, issue, ...(failure ? { mediaFailure: failure } : {}) });
    const choice = await resolution(store, job.jobId, attemptId, signal);
    const changed = (await store.get(job.jobId))!; visual = changed.attempts.at(-1)!.visual!; await updated(changed);
    return choice;
  };
  const mediaFailure = (error: unknown): NonNullable<VisionStage['mediaFailure']> => {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('user-or-media-changed')) return 'user-control';
    if (message.includes('source-changed') || error instanceof ApplicationError && error.code === 'stale-binding') return 'source-changed';
    if (message.includes('seek-timeout')) return 'seek-timeout';
    if (message.includes('capture-busy')) return 'capture-busy';
    if (message === 'permission' || error instanceof ApplicationError && error.code === 'permission-denied') return 'permission';
    return 'unreadable';
  };
  let images = await attachments.forSnapshot(snapshot);
  let planningReserve = visual.planningTokensUpperBound ?? 0, reviewReserve = visual.frozen ? visual.audit?.budget.reviewTokensUpperBound ?? 0 : 0;
  const checkEvidence = async (plan: EvidencePlan, audit: NonNullable<VisionStage['audit']>, duration: number) => {
    if (!snapshot.visionReview) return { plan, audit };
    const availableImages = [...images, ...await attachments.read(snapshot.target, visual.attachmentIds, true)];
    const request = reviewRequest(snapshot, plan, audit, availableImages, cues, duration, visionPlanningTask(snapshot, images));
    const bound = requestTokenBound(request.messages) + purposePolicy['vision-review'].maxTokens;
    let review = request.review;
    if (!request.targets.length || audit.budget.apiTokensUpperBound + bound > visualPolicy.tokenCeiling) {
      review = { ...review, status: 'skipped', failure: !request.targets.length ? (availableImages.length ? 'no-important-evidence' : 'no-images') : 'budget' };
      await stage({ ...visual, review, audit }); return { plan, audit };
    }
    await stage({ ...visual, phase: 'checking', resolution: 'images', review, audit });
    const checked=await reviewVisualEvidence({provider,modelId:snapshot.modelId,request,plan,audit,duration,cues,imageIds:[...snapshot.attachmentIds,...snapshot.historyProjection.flatMap(h=>[...h.attachmentIds])],signal,tokenAllowance:visualPolicy.tokenCeiling-audit.budget.apiTokensUpperBound,
      onInvalid:async output=>{try{await instructionTraces().failedReview(job.jobId,attemptId,output);}catch{/* optional session cache */}}});
    review=checked.review;reviewReserve=checked.tokenBound;
    audit.budget.reviewTokensUpperBound=reviewReserve;audit.budget.apiTokensUpperBound+=reviewReserve;
    if (review.repairs.length && !canRefine(audit)) review.repairs.forEach(r => { r.state = 'budget'; });
    await stage({ ...visual, review, audit });
    if (!review.repairs.some(r => r.state === 'pending')) return { plan, audit };
    // The original opt-in covers this bounded continuation. The suspended
    // controller has restored playback and still observes user/source changes;
    // it can resume only once, without minting a new grant after the cloud wait.
    review = { ...review, repairDecision: 'capture' };
    try {
      const starting=performance.now();
      if(!media)throw new Error('permission');
      await media.resume();
      await stage({ ...visual, review, phase: 'refining', resolution: 'images', issue: undefined });
      audit.budget.mediaMs+=Math.round(performance.now()-starting);
      const captured = await captureRefinements(plan, audit, review, availableImages, (time, detail) => media!.capture(time, detail), signal);
      const releasing = performance.now(); await media.release(); media = undefined;
      captured.audit.budget.mediaMs += Math.round(performance.now() - releasing);
      if (captured.frames.length) {
        try {
          const changed = await store.refineVisual(job.jobId, attemptId, { ...visual, audit: captured.audit }, captured.frames);
          visual = changed.attempts.at(-1)!.visual!; await updated(changed);
          plan = visual.evidencePlan!; audit = visual.audit!; review = visual.review!;
        } catch (error) {
          signal.throwIfAborted();
          // Store validation rejected the complete replacement transaction.
          // Keep every original frame, but retain spent media work and metrics.
          audit = { ...audit, candidates: captured.audit.candidates.map((c, i) => i >= audit.candidates.length ? { ...c, decision: 'incomplete-group' as const } : c), budget: { ...audit.budget, captures: captured.audit.budget.captures, mediaMs: captured.audit.budget.mediaMs } };
        }
      } else audit = { ...audit, candidates: captured.audit.candidates, budget: { ...audit.budget, captures: captured.audit.budget.captures, mediaMs: captured.audit.budget.mediaMs } };
      review.repairs.forEach(r => { if (r.state === 'pending') r.state = captured.error ? 'media' : canRefine(audit) ? 'not-adopted' : 'budget'; });
      // Candidates from rejected proposals can be outside the original window;
      // retain their cost in counters, without publishing invalid image records.
      audit.candidates = audit.candidates.filter(c => c.decision === 'superseded' || audit.slots.some(s => s.key === c.slotKey && c.time >= s.from - .1 && c.time <= s.to + .1));
      await stage({ ...visual, evidencePlan: plan, audit, review, ...(captured.error?{mediaFailure:mediaFailure(captured.error)}:{}) });
    } catch (error) {
      signal.throwIfAborted(); await media?.release(); media = undefined;
      review.repairs.forEach(r => { if (r.state === 'pending') r.state = 'media'; });
      await stage({ ...visual, review, mediaFailure: mediaFailure(error), resolution: 'images' });
    }
    return { plan, audit };
  };
  try {
    if (!visual.frozen) await stage(visual);
    const prepared = preparedContext ?? await prepareChatContext(snapshot, cues, provider, signal, checkpoint);
    if (!visual.frozen) {
      await stage({ ...visual, phase: 'planning' });
      const duration = Math.max(.001, job.basis.mediaDuration ?? snapshot.mediaDuration ?? (cues.length ? Math.max(...cues.map(c => c.to)) : 0));
      const available = Math.max(0, Math.min(6, imageLimits.count - new Set(snapshot.attachmentIds).size));
      const preauthorized = Boolean((await chrome.storage.session.get(grantKey(attemptId)))[grantKey(attemptId)]);
      const planningText = visionPlanningInput(visionPlanningTask(snapshot, images),cues);
      const planningSystem = fixedPrompt({ kind: 'vision-plan', duration, maxFrames: available, preauthorized });
      planningReserve = snapshot.visionOnly ? 0 : requestTokenBound([{ role: 'system', content: planningSystem }, { role: 'user', content: planningText }]) + purposePolicy['vision-plan'].maxTokens;
      const finalEstimate = JSON.stringify(snapshot) + prepared.context + fixedPrompt({ kind: 'answer', output: snapshot.outputType === 'html' ? (snapshot.htmlFormat === 1 ? 'html-page' : 'knowledge') : snapshot.outputType, visionOnly: !!snapshot.visionOnly, hasImages: true, web: !!snapshot.webEnabled });
      // Reserve the full final context and output before spending the planning
      // call. Images are added only if the remaining resource budget fits.
      let planningAllowance=planningReserve,additionalPlanningTokens=0;
      try {
        const preflight=allocateVisualPlan({ version: 2, scope: 'focused', needsNewFrames: false, evidence: [], unresolved: [] }, snapshot, images, planningSystem + planningText, finalEstimate);
        planningAllowance+=Math.max(0,visualPolicy.tokenCeiling-preflight.budget.apiTokensUpperBound);
      }
      catch { throw new ProviderError('context-limit'); }
      let plan: EvidencePlan | undefined;
      let samplingNotes:string[]=[];
      if (snapshot.visionOnly) plan = explorationPlan(snapshot, duration);
      else {
        const planned=await planVisualEvidence({provider,modelId:snapshot.modelId,messages:[{role:'system',content:planningSystem},{role:'user',content:planningText}],signal,duration,cues,imageIds:images.map(i=>i.id),tokenAllowance:planningAllowance,maxNewFrames:available,requireCheckTargets:snapshot.visionReview===2,
          onInvalid:async output=>{try{await instructionTraces().failedPlan(job.jobId,attemptId,output);}catch{ /* optional session cache */ }}});
        additionalPlanningTokens=planned.tokenBound-planningReserve;
        planningReserve=planned.tokenBound;
        visual={...visual,planningTokensUpperBound:planningReserve};
        if(planned.correction)visual={...visual,planningCorrection:planned.correction};
        const parsed=planned.result;
        if ('plan' in parsed) {plan = parsed.plan;samplingNotes=parsed.samplingNotes??[];if(parsed.cueGrounded)visual={...visual,cueGrounded:true};}
        else {
          visual = { ...visual, planningFailure: parsed.failure };
          // Keep prepared subtitles and the executor's retrieved web material.
          // Never capture an invalid proposal or silently waive visual evidence.
          await choose('plan');
          await stage({ ...visual, phase: 'answering', resolution: 'subtitle', frozen: true });
        }
      }
      if (plan) {
        let audit;
        try { audit = allocateVisualPlan(plan, snapshot, images, planningSystem + planningText, finalEstimate, additionalPlanningTokens); }
        catch { throw new ProviderError('context-limit'); }
        if(samplingNotes.length)audit.samplingNotes=samplingNotes;
        await stage({ ...visual, evidencePlan: plan, audit, plan: { times: audit.slots.map(s => s.anchor), reason: snapshot.visionReview?'按证据需求在候选窗口内择帧，再核验重要实际图片。':'按证据需求在候选窗口内择帧；第一阶段未作独立语义核验。' } });
        if (audit.slots.length) {
          let choice: 'images' | 'subtitle' = 'images';
          if (!visionDeclared) choice = await choose('model');
          else if (!preauthorized) choice = await choose('permission');
          if (choice === 'images') {
            try { media = await createOriginalMedia(job.jobId, attemptId, job.basis.binding, signal); }
            catch (error) { signal.throwIfAborted(); choice = await choose('media', mediaFailure(error)); }
          }
          if (choice === 'images') {
            await stage({ ...visual, phase: 'capturing', resolution: 'images', issue: undefined });
            try {
              const reserve = snapshot.visionReview ? Math.min(2, audit.slots.filter(s => plan!.evidence.some(e => s.evidenceIds.includes(e.id) && (e.priority === 'required' || evidenceDetail(e).detail==='original' || e.mode !== 'single'))).length) * 3 : 0;
              audit.budget.maxCaptures = visualPolicy.maxCaptures - reserve;
              await stage({ ...visual, audit });
              audit = await captureEvidence(plan, visual.audit!, (time, detail) => media!.capture(time, detail), async (frame, slot, audit) => {
                const changed = await store.visual(job.jobId, attemptId, { ...visual, audit }, frame, slot.key);
                visual = changed.attempts.at(-1)!.visual!; await updated(changed); return visual.audit!;
              }, async audit => { await stage({ ...visual, audit }); }, signal);
              audit.budget.maxCaptures = visualPolicy.maxCaptures;
              const releasing = performance.now();
              if(snapshot.visionReview)await media!.suspend();
              else {await media?.release();media=undefined;}
              audit.budget.mediaMs += Math.round(performance.now() - releasing);
            } catch (error) { signal.throwIfAborted(); choice = await choose(error instanceof ApplicationError && error.code === 'resource-limit' ? 'resource' : 'media', mediaFailure(error)); audit = visual.audit!; }
          }
          if (choice === 'subtitle') { audit.stopReason = 'subtitle-only'; audit.historyAttachmentIds = [...new Set(snapshot.historyProjection.flatMap(h => [...h.attachmentIds]))]; }
          else {
            const complete = completeHistory(plan, audit, snapshot.attachmentIds);
            const removed = audit.historyAttachmentIds.filter(id => !complete.includes(id));
            audit.historyAttachmentIds = complete;
            audit.budget.imageBytes -= images.filter(i => removed.includes(i.id)).reduce((n, i) => n + i.bytes, 0);
            audit.budget.imageTokensUpperBound -= removed.length * 1024; audit.budget.apiTokensUpperBound -= removed.length * 1024;
          }
          if (choice === 'images') { const checked = await checkEvidence(plan, audit, duration); plan = checked.plan; audit = checked.audit; choice = visual.resolution ?? choice; }
          await stage({ ...visual, audit, resolution: choice, phase: 'answering', frozen: true });
        } else {
          audit.stopReason = plan.needsNewFrames ? 'budget' : 'no-new-evidence';
          const checked = await checkEvidence(plan, audit, duration); plan = checked.plan; audit = checked.audit;
          await stage({ ...visual, audit, resolution: 'images', phase: 'answering', frozen: true });
        }
      }
    }
    if (visual.resolution === 'images') images = [...images, ...await attachments.read(snapshot.target, visual.attachmentIds, true)];
    const ids = visual.resolution === 'images' ? visual.attachmentIds : [];
    const audit = visual.audit;
    const note = visualEvidenceNote(visual);
    // Check actual final envelopes, web material and replayed images before the
    // final POST. The earlier reservation is conservative, not permission to
    // exceed the pipeline ceiling. Frozen retries do not re-plan or re-capture.
    return { prepared, images, ids, note, delivery: audit ? { history: selectedHistory(snapshot, audit.historyAttachmentIds), detailById: Object.fromEntries(audit.frames.map(f => [f.attachmentId, f.detail])) as Record<string, 'low' | 'original'>, tokenAllowance: visualPolicy.tokenCeiling - planningReserve - reviewReserve } : visual.planningFailure ? { history: [...snapshot.historyProjection], detailById: {}, tokenAllowance: visualPolicy.tokenCeiling - planningReserve } : undefined };
  } finally { await media?.release(); }
}
