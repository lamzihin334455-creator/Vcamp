import { z } from 'zod';

export const visionPlanSchema = z.object({
  times: z.array(z.number().finite().nonnegative()).max(6),
  reason: z.string().trim().min(1).max(500)
}).strict();
export type VisionPlan = z.infer<typeof visionPlanSchema>;
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/);
const slotKey = z.string().regex(/^[a-zA-Z0-9_-]{1,52}$/);
const seconds = z.number().finite().nonnegative();
export const evidenceWindowSchema = z.object({ from: seconds, to: seconds, anchor: seconds,
  cueIds: z.array(z.number().int().nonnegative()).max(8), basis: z.enum(['subtitle', 'user-time', 'chapter', 'explore']) }).strict();
export const evidenceItemSchema = z.object({ id: key, need: z.string().trim().min(1).max(180),
  priority: z.enum(['required', 'optional']), mode: z.enum(['single', 'pair', 'sequence']),
  reuseAttachmentIds: z.array(z.string().uuid()).max(10), windows: z.array(evidenceWindowSchema).max(3),
  detailNeed: z.enum(['overview', 'read-text']), readTargets: z.array(z.string().trim().min(1).max(60)).max(4).optional(),
  checkTargets: z.array(z.string().trim().min(1).max(60)).min(1).max(4).optional(),
  reason: z.string().trim().min(1).max(180) }).strict();
export const evidencePlanSchema = z.object({ version: z.literal(2), scope: z.enum(['focused', 'whole-video', 'process']),
  needsNewFrames: z.boolean(), evidence: z.array(evidenceItemSchema).max(8), unresolved: z.array(z.string().max(180)).max(8) }).strict();
export type EvidencePlan = z.infer<typeof evidencePlanSchema>;
export type EvidenceWindow = z.infer<typeof evidenceWindowSchema>;
// Fixed vocabulary and schema paths only. Never persist model values, unknown
// property names, Zod messages or response excerpts in failure feedback.
export const visionPlanFailureSchema = z.object({
  code: z.enum(['invalid-json', 'invalid-schema', 'unsupported-version', 'invalid-duration', 'duplicate-id', 'invalid-reuse', 'invalid-group', 'invalid-window', 'invalid-cue', 'inconsistent-flags', 'over-budget']),
  fields: z.array(z.string().max(120).regex(/^(?:version|scope|needsNewFrames|evidence|unresolved|id|need|priority|mode|reuseAttachmentIds|windows|from|to|anchor|cueIds|basis|detailNeed|readTargets|checkTargets|reason|times)(?:\.(?:version|scope|needsNewFrames|evidence|unresolved|id|need|priority|mode|reuseAttachmentIds|windows|from|to|anchor|cueIds|basis|detailNeed|readTargets|checkTargets|reason|times|\d{1,2}))*$/)).max(8),
  syntax: z.object({kind:z.enum(['syntax','unexpected-end']),offset:z.number().int().nonnegative().max(1000000000).optional(),line:z.number().int().positive().max(1000000000).optional(),column:z.number().int().positive().max(1000000000).optional()}).strict().optional()
}).strict();
export type VisionPlanFailure = z.infer<typeof visionPlanFailureSchema>;
export class VisionPlanValidationError extends Error {
  readonly failure: VisionPlanFailure;
  constructor(code: VisionPlanFailure['code'], fields: string[]) {
    super(code); this.failure = visionPlanFailureSchema.parse({ code, fields });
  }
}
export const captureSlotSchema = z.object({ key: slotKey, evidenceIds: z.array(key).min(1).max(8), group: key,
  from: seconds, to: seconds, anchor: seconds, detail: z.enum(['low', 'original']), detailReason: z.string().max(180).optional() }).strict();
export type CaptureSlot = z.infer<typeof captureSlotSchema>;
export const visionCheckSchema=z.object({checkId:key,target:z.string().trim().min(1).max(180),status:z.enum(['confirmed','unreadable','not-visible','uncertain']),imageRefs:z.array(key).min(1).max(10),observation:z.string().trim().min(1).max(180)}).strict();
/** A narrow contradiction guard, not an image-reading confidence score. */
export function observationDisclaimsConfirmation(text:string){
  return /(?:不能|无法|难以|未能|不足以).{0,10}(?:证明|确认|判断|比较|辨认|核实|读出|确定)|(?:需|需要).{0,4}(?:结合|依靠|参考).{0,6}字幕|\b(?:cannot|can't|unable to|insufficient to)\s+(?:\w+\s+){0,3}(?:confirm|prove|determine|verify|read)\b/i.test(text);
}
export function evidenceChecks(e:EvidencePlan['evidence'][number]){
  // Explicit checks are authoritative. Reading hints may describe the same
  // fact differently; they must not create a second, competing checklist.
  // Legacy plans without checks retain their original reading targets.
  const targets=[...new Set(e.checkTargets??e.readTargets??[])];
  return (targets.length?targets:[e.need]).map((need,i)=>({checkId:`c${i}`,need}));
}
export function checkedStatus(checks:readonly z.infer<typeof visionCheckSchema>[]){
  return checks.every(c=>c.status==='confirmed')?'sufficient' as const:checks.some(c=>c.status==='confirmed')?'partial' as const:checks.every(c=>c.status==='not-visible')?'missing' as const:checks.some(c=>c.status==='unreadable')?'unreadable' as const:'uncertain' as const;
}
export const visionReviewResultSchema = z.object({ evidenceId: key,
  status: z.enum(['sufficient', 'partial', 'missing', 'unreadable', 'uncertain']),
  imageRefs: z.array(key).min(1).max(10), observations: z.array(z.string().trim().min(1).max(180)).max(2),
  missing: z.string().max(180), checks:z.array(visionCheckSchema).min(1).max(4).optional(), refinements: z.array(z.object({ slotKey, window: evidenceWindowSchema }).strict()).max(2)
}).strict();
export const visionReviewReplySchema = z.object({ version: z.literal(1), results: z.array(visionReviewResultSchema).min(1).max(8) }).strict();
export type VisionReviewReply = z.infer<typeof visionReviewReplySchema>;
export const visionReviewSchema = z.object({ version: z.literal(1),
  checksVersion:z.literal(1).optional(),refinementNotes:z.array(z.string().max(180)).max(2).optional(),
  status: z.enum(['checking', 'complete', 'failed', 'skipped']),
  failure: z.enum(['json', 'schema', 'references', 'transport', 'limit', 'budget', 'no-images', 'no-important-evidence']).optional(),
  correction: z.object({firstFailure:z.enum(['json','schema','references']),outcome:z.enum(['succeeded','failed','budget'])}).strict().optional(),
  images: z.array(z.object({ ref: key, evidenceIds: z.array(key).min(1).max(8), time: seconds,
    slotKey: slotKey.optional(), attachmentId: z.string().uuid().optional() }).strict()).max(10),
  results: z.array(visionReviewResultSchema).max(8),
  repairs: z.array(z.object({ slotKey, window: evidenceWindowSchema, originalWindow: evidenceWindowSchema, originalTime: seconds.optional(),
    actualTime: seconds.optional(), reason:z.string().max(120).optional(), state: z.enum(['pending', 'captured-unverified', 'declined', 'budget', 'media', 'not-adopted']) }).strict()).max(2),
  repairDecision: z.enum(['pending', 'capture', 'keep']).optional()
}).strict();
export type VisionReview = z.infer<typeof visionReviewSchema>;
export const visionAuditSchema = z.object({ version: z.literal(1), qualityVersion: z.literal('local-v2').optional(),
  historyAttachmentIds: z.array(z.string().uuid()).max(10),
  slots: z.array(captureSlotSchema).max(6),
  frames: z.array(z.object({ slotKey, attachmentId: z.string().uuid(), time: seconds, detail: z.enum(['low', 'original']) }).strict()).max(6),
  candidates: z.array(z.object({ slotKey, time: seconds, width: z.number().int().positive(), height: z.number().int().positive(),
    bytes: z.number().int().nonnegative(), quality: z.number().finite().min(0).max(1),
    metrics: z.object({ sharpness: z.number().finite().nonnegative(), contrast: z.number().finite().nonnegative() }).strict().optional(),
    decision: z.enum(['selected', 'alternative', 'duplicate', 'low-quality', 'budget', 'incomplete-group', 'superseded']) }).strict()).max(18),
  samplingNotes: z.array(z.string().max(220)).max(8).optional(),
  unresolved: z.array(z.string().max(220)).max(16),
  budget: z.object({ imageTokensUpperBound: z.number().int().nonnegative(), apiTokensUpperBound: z.number().int().nonnegative(),
    imageBytes: z.number().int().nonnegative(), captures: z.number().int().nonnegative().max(18), mediaMs: seconds,
    maxCaptures: z.number().int().nonnegative().max(18), maxMediaMs: seconds,
    tokenCeiling: z.number().int().nonnegative(), finalOutputReserved: z.number().int().nonnegative(),
    reviewTokensUpperBound: z.number().int().nonnegative().optional() }).strict(),
  stopReason: z.enum(['planned', 'local-selection-complete', 'no-new-evidence', 'budget', 'media', 'subtitle-only']).optional()
}).strict();
export type VisionAudit = z.infer<typeof visionAuditSchema>;
// Durable evidence, never a permission or a media-host capability.
export const visionStageSchema = z.object({
  phase: z.enum(['preparing', 'planning', 'permission', 'capturing', 'checking', 'refining', 'answering', 'retired']),
  plan: visionPlanSchema.optional(), attachmentIds: z.array(z.string().uuid()).max(6),
  resolution: z.enum(['images', 'subtitle']).optional(),
  issue: z.enum(['permission', 'media', 'model', 'resource', 'plan']).optional(),
  planningFailure: visionPlanFailureSchema.optional(),
  planningCorrection: z.object({firstFailure:visionPlanFailureSchema,outcome:z.enum(['succeeded','failed','budget'])}).strict().optional(),
  planningTokensUpperBound:z.number().int().nonnegative().optional(),
  cueGrounded:z.literal(true).optional(),
  mediaFailure: z.enum(['permission','source-changed','user-control','seek-timeout','capture-busy','unreadable']).optional(),
  frozen: z.boolean().optional(),
  evidencePlan: evidencePlanSchema.optional(), audit: visionAuditSchema.optional(), review: visionReviewSchema.optional()
}).strict().refine(v=>!v.review||!!v.audit&&!!v.evidencePlan,{message:'review-requires-evidence'});
export type VisionStage = z.infer<typeof visionStageSchema>;

export function validateVisionPlan(value: unknown, duration: number, available: number): VisionPlan {
  const plan = visionPlanSchema.parse(value);
  if (!Number.isFinite(duration) || duration <= 0 || plan.times.length > available
    || plan.times.some((t, i) => t >= duration || plan.times.some((other, j) => j < i && Math.abs(t - other) < 0.2))) throw new Error('invalid-plan');
  return plan;
}

export function parseVisionPlan(text: string, duration: number, available: number): VisionPlan {
  const trimmed=text.trim();
  const fenced=/^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return validateVisionPlan(JSON.parse(fenced?.[1]??trimmed),duration,available);
}

/** New plans are proposals, never proof that a visual fact was observed. */
export function validateEvidencePlan(value: unknown, duration: number, cues: readonly { from: number; to: number }[], imageIds: readonly string[]): EvidencePlan {
  if (!Number.isFinite(duration)) throw new VisionPlanValidationError('invalid-duration', []);
  const plan = validateEvidenceStructure(value, duration, imageIds, cues.length);
  for (const [i, e] of plan.evidence.entries()) for (const [j, w] of e.windows.entries()) {
    if (w.cueIds.some(id => cues[id].from > w.to || cues[id].to < w.from)) throw new VisionPlanValidationError('invalid-cue', [`evidence.${i}.windows.${j}.cueIds`]);
  }
  return plan;
}

/** Import/store validation uses frozen cue count without persisting raw cues. */
export function validateEvidenceStructure(value: unknown, duration: number, imageIds: readonly string[], cueCount: number): EvidencePlan {
  const plan = evidencePlanSchema.parse(value), allowed = new Set(imageIds);
  if (!(duration > 0)) throw new VisionPlanValidationError('invalid-duration', []);
  if (new Set(plan.evidence.map(e => e.id)).size !== plan.evidence.length) throw new VisionPlanValidationError('duplicate-id', ['evidence']);
  for (const [i, e] of plan.evidence.entries()) {
    if(evidenceChecks(e).length>4)throw new VisionPlanValidationError('invalid-schema',[`evidence.${i}.checkTargets`,`evidence.${i}.readTargets`]);
    if (new Set(e.reuseAttachmentIds).size !== e.reuseAttachmentIds.length || e.reuseAttachmentIds.some(id => !allowed.has(id))) throw new VisionPlanValidationError('invalid-reuse', [`evidence.${i}.reuseAttachmentIds`]);
    const count = e.windows.length + e.reuseAttachmentIds.length;
    if (!count || (e.mode === 'pair' && count !== 2) || (e.mode === 'sequence' && (count < 2 || count > 3)) || (e.mode === 'single' && count !== 1)) throw new VisionPlanValidationError('invalid-group', [`evidence.${i}.mode`, `evidence.${i}.windows`, `evidence.${i}.reuseAttachmentIds`]);
    if (!plan.needsNewFrames && e.windows.length) throw new VisionPlanValidationError('inconsistent-flags', ['needsNewFrames', `evidence.${i}.windows`]);
    let previous = -1;
    for (const [j, w] of e.windows.entries()) {
      if (w.from > w.anchor || w.anchor > w.to || w.to >= duration || w.anchor <= previous) throw new VisionPlanValidationError('invalid-window', [`evidence.${i}.windows.${j}`]);
      previous = w.anchor;
      if (new Set(w.cueIds).size !== w.cueIds.length || w.cueIds.some(id => id >= cueCount) || (w.basis === 'subtitle' && !w.cueIds.length) || (w.basis !== 'subtitle' && w.cueIds.length)) throw new VisionPlanValidationError('invalid-cue', [`evidence.${i}.windows.${j}.cueIds`]);
    }
  }
  if (plan.needsNewFrames !== plan.evidence.some(e => e.windows.length > 0)) throw new VisionPlanValidationError('inconsistent-flags', ['needsNewFrames', 'evidence']);
  return plan;
}

export function validateVisionAudit(audit: VisionAudit, plan: EvidencePlan, attachmentIds: readonly string[], duration: number, allowedHistory: readonly string[], review?: VisionReview) {
  const keys = new Set(audit.slots.map(s => s.key)), images = new Set(attachmentIds);
  if (keys.size !== audit.slots.length || new Set(audit.historyAttachmentIds).size !== audit.historyAttachmentIds.length || audit.historyAttachmentIds.some(id => !allowedHistory.includes(id))
    || audit.frames.length !== attachmentIds.length || new Set(audit.frames.map(f => f.slotKey)).size !== audit.frames.length || new Set(audit.frames.map(f => f.attachmentId)).size !== images.size) throw new Error('invalid-audit');
  for (const slot of audit.slots) {
    if (slot.to >= duration || slot.from > slot.anchor || slot.anchor > slot.to || slot.evidenceIds.some(id => !plan.evidence.some(e => e.id === id && e.windows.some(w => w.from <= slot.from && w.to >= slot.to && w.anchor === slot.anchor)))
      || !slot.evidenceIds.includes(slot.group)) throw new Error('invalid-slot');
  }
  for (const f of audit.frames) {
    const slot = audit.slots.find(s => s.key === f.slotKey);
    if (!slot || !images.has(f.attachmentId) || f.time >= duration || f.time < slot.from - .1 || f.time > slot.to + .1 || f.detail !== slot.detail) throw new Error('invalid-frame');
  }
  for (const group of new Set(audit.slots.map(s => s.group))) {
    const frames = audit.slots.filter(s => s.group === group).sort((a, b) => a.anchor - b.anchor).flatMap(s => audit.frames.filter(f => f.slotKey === s.key));
    if (frames.some((f, i) => i > 0 && f.time <= frames[i - 1].time)) throw new Error('invalid-state-order');
  }
  if (audit.candidates.some(c => { const s = c.decision === 'superseded' ? review?.repairs.find(r => r.slotKey === c.slotKey)?.originalWindow : audit.slots.find(s => s.key === c.slotKey); return !s || c.time >= duration || c.time < s.from - .1 || c.time > s.to + .1; })) throw new Error('invalid-candidate');
}

export function refinementWindows(plan: EvidencePlan, audit: VisionAudit, repairs: VisionReview['repairs']) {
  const p = structuredClone(plan), a = structuredClone(audit);
  for (const repair of repairs) {
    const slot = a.slots.find(s => s.key === repair.slotKey); if (!slot) throw new Error('invalid-refinement');
    for (const id of slot.evidenceIds) {
      const e = p.evidence.find(e => e.id === id)!;
      const index = e.windows.findIndex(w => w.from === slot.from && w.to === slot.to && w.anchor === slot.anchor);
      if (index < 0) throw new Error('invalid-refinement'); e.windows[index] = structuredClone(repair.window);
    }
    Object.assign(slot, { from: repair.window.from, to: repair.window.to, anchor: repair.window.anchor, detail: 'original', detailReason: '第二阶段按明确缺口补帧，保留清晰细节；补后未再次独立核验' });
  }
  return { plan: p, audit: a };
}

export function validateVisionReview(review: VisionReview, plan: EvidencePlan, audit: VisionAudit, duration: number, allowedImages: readonly string[], cueCount: number) {
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  const bad = () => { throw new Error('invalid-vision-review'); };
  if (!unique(review.images.map(i => i.ref)) || !unique(review.results.map(r => r.evidenceId)) || !unique(review.repairs.map(r => r.slotKey))) bad();
  if(review.status!=='complete'&&(review.results.length||review.repairs.length||review.repairDecision)||review.status==='complete'&&review.failure)bad();
  if(!unique(review.images.map(i=>i.slotKey??i.attachmentId!)))bad();
  for (const image of review.images) {
    const slot = audit.slots.find(s => s.key === image.slotKey);
    if (image.time >= duration || !unique(image.evidenceIds) || (!!image.slotKey === !!image.attachmentId)
      || image.attachmentId && !allowedImages.includes(image.attachmentId)
      || image.slotKey && (!slot || image.evidenceIds.some(id => !slot.evidenceIds.includes(id)))
      || image.evidenceIds.some(id => !plan.evidence.some(e => e.id === id && (!image.attachmentId||e.reuseAttachmentIds.includes(image.attachmentId))))) bad();
    if(image.slotKey){const repair=review.repairs.find(r=>r.slotKey===image.slotKey&&r.state==='captured-unverified');
      if(repair?image.time!==repair.originalTime:!audit.frames.some(f=>f.slotKey===image.slotKey&&f.time===image.time))bad();}
  }
  if (review.status === 'complete' && (review.results.length !== new Set(review.images.flatMap(i => i.evidenceIds)).size)) bad();
  let proposals = 0;
  for (const result of review.results) {
    const e = plan.evidence.find(e => e.id === result.evidenceId), refs = review.images.filter(i => i.evidenceIds.includes(result.evidenceId)).map(i => i.ref);
    if (!e || !refs.length || !unique(result.imageRefs) || result.imageRefs.some(ref => !refs.includes(ref))) bad();
    if (result.status === 'sufficient' && (!result.observations.length || result.missing || result.refinements.length || !refs.length
      || result.imageRefs.length !== refs.length || refs.length !== e!.windows.length + e!.reuseAttachmentIds.length)) bad();
    if (result.status !== 'sufficient' && !result.missing.trim()) bad();
    if(review.checksVersion&&!result.checks?.length)bad();
    if(result.checks){
      const checks=result.checks,targets=evidenceChecks(e!);
      if(!unique(checks.map(c=>c.checkId))||checks.length!==targets.length||checks.some(c=>!targets.some(t=>t.checkId===c.checkId&&t.need===c.target)||!unique(c.imageRefs)||c.imageRefs.some(ref=>!result.imageRefs.includes(ref))||review.checksVersion&&c.status==='confirmed'&&observationDisclaimsConfirmation(c.observation))||checkedStatus(checks)!==result.status)bad();
      if(e!.mode!=='single'&&checks.some(c=>c.status==='confirmed'&&c.imageRefs.length!==refs.length))bad();
      if(checks.some(c=>c.status!=='confirmed')&&!result.missing.trim())bad();
    }
    for (const refinement of result.refinements) {
      proposals++;
      const slot = audit.slots.find(s => s.key === refinement.slotKey), w = refinement.window;
      if (!slot?.evidenceIds.includes(result.evidenceId) || w.from > w.anchor || w.anchor > w.to || w.to >= duration
        || new Set(w.cueIds).size !== w.cueIds.length || w.cueIds.some(id => id >= cueCount)
        || (w.basis === 'subtitle' ? !w.cueIds.length : !!w.cueIds.length)) bad();
    }
  }
  if (proposals > 2 || proposals!==review.repairs.length) bad();
  for (const repair of review.repairs) {
    const original=repair.originalWindow,slot=audit.slots.find(s=>s.key===repair.slotKey),w=repair.window;
    if(original.from>original.anchor||original.anchor>original.to||original.to>=duration||!slot
      ||new Set(original.cueIds).size!==original.cueIds.length||original.cueIds.some(id=>id>=cueCount)
      ||(original.basis==='subtitle'?!original.cueIds.length:!!original.cueIds.length)
      ||w.from<Math.max(0,original.from-Math.max(3,original.to-original.from))||w.to>Math.min(duration-.001,original.to+Math.max(3,original.to-original.from)))bad();
    const current=repair.state==='captured-unverified'?w:original;
    if(slot!.from!==current.from||slot!.to!==current.to||slot!.anchor!==current.anchor)bad();
    if(repair.originalTime!==undefined&&(repair.originalTime<original.from-.1||repair.originalTime>original.to+.1))bad();
    if (!review.results.some(r => r.refinements.some(f => f.slotKey === repair.slotKey && JSON.stringify(f.window) === JSON.stringify(repair.window)))) bad();
    if (repair.actualTime !== undefined && (repair.state !== 'captured-unverified' || repair.actualTime < repair.window.from - .1 || repair.actualTime > repair.window.to + .1)) bad();
    if (repair.state === 'captured-unverified' && !audit.frames.some(f => f.slotKey === repair.slotKey && f.time === repair.actualTime)) bad();
  }
}
