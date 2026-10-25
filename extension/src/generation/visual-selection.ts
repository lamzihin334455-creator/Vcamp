import type { Attachment, CapturedFrame } from '../contracts/attachment';
import { imageLimits } from '../contracts/attachment';
import type { ChatRequestSnapshot } from '../contracts/generation';
import type { CaptureSlot, EvidencePlan, VisionAudit } from '../contracts/vision';
import type { Cue } from '../contracts/video';
import { purposePolicy } from './purpose-policy';
import type { ProviderMessage } from './provider-port';
import {subtitleLines} from './subtitle-context';

// Operational ceilings, not targets or a claim of optimal sampling. No price is
// inferred: UTF-8 byte counts bound text tokens conservatively; images use the
// provider's current 1024-token upper bound, even for low-detail delivery.
export const visualPolicy = { tokenCeiling: 8388608, imageTokenCeiling: 6144, maxCaptures: 18, maxMediaMs: 45000, candidateReserveMs: 11000, restoreReserveMs: 10000 } as const;
export const textTokenBound = (text: string) => new TextEncoder().encode(text).byteLength + 256;
export const requestTokenBound = (messages: readonly ProviderMessage[]) => 256 + messages.reduce((n, m) => n + 32 + (typeof m.content === 'string' ? textTokenBound(m.content) : m.content.reduce((v, p) => v + (p.type === 'text' ? textTokenBound(p.text) : 1024), 0)), 0);
export const frameBytes = (frame: CapturedFrame) => Math.max(0, Math.floor((frame.dataUrl.length - 22) * 3 / 4) - (frame.dataUrl.endsWith('==') ? 2 : frame.dataUrl.endsWith('=') ? 1 : 0));

/** Per-evidence correction only; do not upgrade a whole video from subtitle keywords. */
export function evidenceDetail(e: EvidencePlan['evidence'][number]) {
  const targets = e.readTargets ?? [];
  const noReading = /无需|不用|不必|不需要|不读|without reading|do not read/i.test(e.need);
    const explicitReading = /菜单(?:项|选项)|设置项|选项(?:名|文字|内容)|(?:勾选|选中|开关)状态|参数值|图例|刻度|(?:读[取出清懂]|辨认|核对|确认|识别).{0,16}(?:文字|文本|数字|数值|选项|标签|代码|标注)|\b(?:read|transcribe|ocr)\b|\b(?:menu items?|checkbox state|parameter values?|axis labels?)\b/i.test([e.need,...e.checkTargets??[]].join('、'));
  const fineGeometry=/(?:标签栏|控件|按钮|输入框|复选框|边框|文字|图标).{0,8}(?:高低|高度|尺寸|大小|粗细|宽度|间距|对齐|像素)|(?:高度|尺寸|粗细|边框).{0,8}(?:差异|比较)|\b(?:pixel|border thickness|checkbox size|tab height)\b/i.test([e.need,...e.checkTargets??[]].join('、'));
  const reading = e.detailNeed === 'read-text' || targets.length > 0 || explicitReading && !noReading || fineGeometry;
  return { detail: reading ? 'original' as const : 'low' as const,
    reason: (reading ? `${targets.length ? `读取目标：${targets.join('、')}` : fineGeometry?'需比较细微尺寸或边框，保留源视频清晰细节':'需求包含文字、数值或具体状态，使用读字分辨率'}${e.detailNeed === 'overview' ? '；已校正规划中的概览标记' : ''}` : '仅辨认总体结构或外观，使用概览分辨率').slice(0, 180) };
}

export function selectedHistory(snapshot: ChatRequestSnapshot, ids: readonly string[]) {
  const allowed = new Set(ids);
  return snapshot.historyProjection.map(entry => ({ ...entry, attachmentIds: entry.attachmentIds.filter(id => allowed.has(id) && !snapshot.attachmentIds.includes(id)) }));
}

export function allocateVisualPlan(plan: EvidencePlan, snapshot: ChatRequestSnapshot, images: readonly Attachment[], planningText: string, finalText: string, additionalPlanningTokens=0): VisionAudit {
  const output = purposePolicy[snapshot.outputType === 'html' ? 'html-page' : snapshot.outputType === 'markdown' ? 'markdown' : 'answer'].maxTokens;
  // Include envelope/manifest/evidence-note allowance; final messages are
  // checked exactly again before POST. This is not a currency estimate.
  if(!Number.isSafeInteger(additionalPlanningTokens)||additionalPlanningTokens<0)throw new Error('visual-token-budget');
  const baseTokens = textTokenBound(finalText) + 16384 + output + (snapshot.visionOnly ? 0 : textTokenBound(planningText) + purposePolicy['vision-plan'].maxTokens) + additionalPlanningTokens;
  const audit: VisionAudit = { version: 1, qualityVersion: 'local-v2', historyAttachmentIds: [], slots: [], frames: [], candidates: [], unresolved: [...plan.unresolved],
    budget: { imageTokensUpperBound: 0, apiTokensUpperBound: baseTokens, imageBytes: 0, captures: 0, mediaMs: 0,
      maxCaptures: visualPolicy.maxCaptures, maxMediaMs: visualPolicy.maxMediaMs, tokenCeiling: visualPolicy.tokenCeiling, finalOutputReserved: output }, stopReason: 'planned' };
  const pinned = images.filter(i => snapshot.attachmentIds.includes(i.id));
  let ids = new Set(pinned.map(i => i.id)), reservedBytes = pinned.reduce((n, i) => n + i.bytes, 0);
  const historyIds = new Set(snapshot.historyProjection.flatMap(h => [...h.attachmentIds]));
  const evidence = [...plan.evidence];
  const details = new Map(evidence.map(e => [e.id, evidenceDetail(e)]));
  // Select whole evidence groups. An exact same window/detail may serve more
  // than one single-frame requirement; different state roles never collapse.
  while (evidence.length) {
    // Greedy marginal coverage: shared requirements increase value, already
    // selected images have no new image cost. Required groups take precedence;
    // broad tasks favour uncovered temporal regions when costs are comparable.
    const rank = (e: EvidencePlan['evidence'][number]) => {
      const same = (other: typeof e) => e.mode === 'single' && other.mode === 'single' && e.windows.length === 1 && JSON.stringify(other.windows) === JSON.stringify(e.windows) && details.get(other.id)!.detail === details.get(e.id)!.detail;
      const shares = evidence.filter(same).length || 1;
      const count = e.windows.length + e.reuseAttachmentIds.filter(id => !ids.has(id)).length;
      const distance = audit.slots.length && e.windows.length ? Math.min(...audit.slots.flatMap(s => e.windows.map(w => Math.abs(s.anchor - w.anchor)))) / Math.max(1, snapshot.mediaDuration ?? 1) : 1;
      return shares * (plan.scope === 'whole-video' ? 1 + Math.min(1, distance) : 1) / Math.max(.25, count);
    };
    evidence.sort((a, b) => Number(b.priority === 'required') - Number(a.priority === 'required') || rank(b) - rank(a));
    const e = evidence.shift()!;
    const detail = details.get(e.id)!;
    const reuse = e.reuseAttachmentIds.filter(id => historyIds.has(id) && !ids.has(id));
    const shared = e.mode === 'single' ? audit.slots.find(s => s.from === e.windows[0]?.from && s.to === e.windows[0]?.to && s.anchor === e.windows[0]?.anchor && s.detail === detail.detail && plan.evidence.find(p => p.id === s.group)?.mode === 'single') : undefined;
    const newSlots = shared ? 0 : e.windows.length;
    const nextIds = new Set([...ids, ...reuse]);
    const count = nextIds.size + audit.slots.length + newSlots;
    // Predicted PNG bytes guide allocation; real bytes enforce the hard limit.
    // Reserving every frame's maximum would discard affordable evidence early.
    const bytes = reservedBytes + reuse.reduce((n, id) => n + (images.find(i => i.id === id)?.bytes ?? imageLimits.totalBytes), 0) + newSlots * (detail.detail === 'original' ? 1.5 : .6) * 1024 * 1024;
    const imageTokens = count * 1024;
    if (count > imageLimits.count || audit.slots.length + newSlots > 6 || bytes > imageLimits.totalBytes || imageTokens > Math.max(visualPolicy.imageTokenCeiling, pinned.length * 1024) || baseTokens + imageTokens > visualPolicy.tokenCeiling) {
      audit.unresolved.push(`${e.need}：整组证据超出本次图片、token或字节预算，未安排。`); continue;
    }
    ids = nextIds; reservedBytes = bytes;
    audit.historyAttachmentIds.push(...reuse);
    if (shared) shared.evidenceIds.push(e.id);
    else for (const [index, w] of e.windows.entries()) audit.slots.push({ key: `${e.id}_${index}`, evidenceIds: [e.id], group: e.id, from: w.from, to: w.to, anchor: w.anchor, detail: detail.detail, detailReason: detail.reason });
  }
  audit.historyAttachmentIds = [...new Set(audit.historyAttachmentIds)];
  audit.budget.imageBytes = pinned.reduce((n, i) => n + i.bytes, 0) + images.filter(i => audit.historyAttachmentIds.includes(i.id)).reduce((n, i) => n + i.bytes, 0);
  audit.budget.imageTokensUpperBound = (ids.size + audit.slots.length) * 1024;
  audit.budget.apiTokensUpperBound = baseTokens + audit.budget.imageTokensUpperBound;
  audit.unresolved = audit.unresolved.map(text => text.slice(0, 220)).slice(0, 16);
  if (baseTokens + pinned.length * 1024 > visualPolicy.tokenCeiling) throw new Error('visual-token-budget');
  return audit;
}

/** Bounded options inside the declared window; never apply a universal offset. */
export function candidateTimes(slot: CaptureSlot, remaining: number) {
  const reach = Math.min(1.5, (slot.to - slot.from) / 3);
  return [...new Set([slot.anchor, Math.min(slot.to, slot.anchor + reach), Math.max(slot.from, slot.anchor - reach)])]
    .filter(t => t >= slot.from && t <= slot.to).slice(0, Math.min(3, remaining));
}

/** Do not replay the old half of an incomplete old+new state comparison. */
export function completeHistory(plan: EvidencePlan, audit: VisionAudit, pinned: readonly string[]) {
  const selected = new Set(audit.historyAttachmentIds);
  return [...new Set(plan.evidence.filter(e => e.reuseAttachmentIds.every(id => selected.has(id) || pinned.includes(id)) && e.windows.every(w => audit.slots.some(s => s.evidenceIds.includes(e.id) && s.anchor === w.anchor && audit.frames.some(f => f.slotKey === s.key))))
    .flatMap(e => e.reuseAttachmentIds).filter(id => selected.has(id)))];
}

export interface PixelSample { luma: readonly number[]; sharpness: number; contrast: number; }
export function qualityScore(sample?: PixelSample) {
  if (!sample || !Number.isFinite(sample.sharpness) || !Number.isFinite(sample.contrast)) return 0;
  const edge = Math.max(0, sample.sharpness), contrast = Math.max(0, sample.contrast);
  // Continuous ranking, never a readability probability. Strong contrast alone
  // cannot saturate the score; finite inputs remain below 1 without clipping.
  return .8 * (1 - 20 / (edge + 20)) + .2 * (1 - 48 / (contrast + 48));
}
export function nearDuplicate(a?: PixelSample, b?: PixelSample) {
  // Any changed thumbnail cell protects small local state changes. This is a
  // conservative appearance test; never used to drop required pair/sequence.
  return !!a && !!b && a.luma.length === b.luma.length && a.luma.length > 0 && a.luma.every((v, i) => Math.abs(v - b.luma[i]) <= 1);
}

export function explorationPlan(snapshot: ChatRequestSnapshot, duration: number): EvidencePlan {
  const times = [...snapshot.input.matchAll(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\b/g)].map(m => Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4] ?? 0}`));
  times.push(...[...snapshot.input.matchAll(/(\d{1,3})分(?:(\d{1,2}(?:\.\d+)?)秒)?/g)].map(m => Number(m[1]) * 60 + Number(m[2] ?? 0)));
  const validTimes = times.filter(t => t < duration);
  const chapters = snapshot.evidence?.chapters?.slice(0, 6).map(c => c.from).filter(t => t < duration) ?? [];
  const anchors = validTimes.length ? validTimes.slice(0, 6) : chapters.length ? chapters : [.2, .5, .8].map(r => duration * r);
  return { version: 2, scope: validTimes.length ? 'focused' : 'whole-video', needsNewFrames: true, unresolved: ['无字幕：有限探查不能证明已覆盖全片，也不能以未发现判断事件不存在。'],
    evidence: [...new Set(anchors)].map((t, index) => ({ id: `explore_${index}`, need: validTimes.length ? '检查用户指定时间附近的可见内容' : '探查一个不同位置的代表画面', priority: 'required', mode: 'single', reuseAttachmentIds: [], detailNeed: 'read-text', reason: '无字幕，仅作有限视觉探查，不预设画面内容。',
      windows: [{ from: Math.max(0, t - .5), to: Math.min(duration - .001, t + 1), anchor: Math.min(duration - .001, t), cueIds: [], basis: validTimes.length ? 'user-time' : chapters.length ? 'chapter' : 'explore' }] })) };
}

export function planningSubtitle(cues: readonly Cue[]) {
  const serialized=subtitleLines(cues,true);
  return serialized.header+serialized.lines.join('\n');
}
