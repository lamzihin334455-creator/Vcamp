import type { CapturedFrame } from '../contracts/attachment';
import { imageLimits } from '../contracts/attachment';
import type { CaptureSlot, EvidencePlan, VisionAudit } from '../contracts/vision';
import { candidateTimes, frameBytes, nearDuplicate, qualityScore, type PixelSample, visualPolicy } from './visual-selection';

export type SampledFrame = CapturedFrame & { sample?: PixelSample };
export async function captureEvidence(plan: EvidencePlan, audit: VisionAudit,
  capture: (time: number, detail: 'low' | 'original') => Promise<SampledFrame>,
  accept: (frame: CapturedFrame, slot: CaptureSlot, audit: VisionAudit) => Promise<VisionAudit>,
  progress: (audit: VisionAudit) => Promise<void>, signal: AbortSignal, now = () => performance.now()) {
  const started = now(), adopted: SampledFrame[] = [];
  const groups = [...new Set(audit.slots.map(s => s.group))];
  let stopped = false;
  for (const [groupIndex,group] of groups.entries()) {
    const slots = audit.slots.filter(s => s.group === group).sort((a, b) => a.anchor - b.anchor), e = plan.evidence.find(e => e.id === group)!;
    const pending: { frame: SampledFrame; slot: CaptureSlot; index: number }[] = [];
    for (const slot of slots) {
      let best: { frame: SampledFrame; score: number; index: number } | undefined;
      const groupRemaining = slots.length - pending.length;
      // Reserve one candidate for each later slot before spending additional
      // attempts here. A repair reserve must not erase initial task coverage.
      const laterSlots=audit.slots.filter(s=>groups.indexOf(s.group)>groupIndex).length;
      const attempts = Math.max(0, audit.budget.maxCaptures - audit.budget.captures - Math.max(0, groupRemaining + laterSlots - 1));
      if (!attempts) { stopped = true; break; }
      for (const time of candidateTimes(slot, attempts)) {
        signal.throwIfAborted();
        if (now() - started + visualPolicy.candidateReserveMs + visualPolicy.restoreReserveMs >= audit.budget.maxMediaMs) { stopped = true; break; }
        audit.budget.captures++;
        const frame = await capture(time, slot.detail);
        signal.throwIfAborted();
        const score = qualityScore(frame.sample), duplicate = adopted.some(prior => frame.dataUrl === prior.dataUrl || slot.detail === 'low' && e.priority === 'optional' && nearDuplicate(prior.sample, frame.sample));
        const index = audit.candidates.length;
        const metrics = frame.sample && Number.isFinite(frame.sample.sharpness) && Number.isFinite(frame.sample.contrast) ? { sharpness: Math.max(0, frame.sample.sharpness), contrast: Math.max(0, frame.sample.contrast) } : undefined;
        audit.candidates.push({ slotKey: slot.key, time: frame.time, width: frame.width, height: frame.height, bytes: frameBytes(frame), quality: score, ...(metrics ? { metrics } : {}), decision: duplicate && e.mode === 'single' ? 'duplicate' : 'alternative' });
        const ordered = !pending.length || frame.time > pending.at(-1)!.frame.time;
        const repeated = best && best.frame.dataUrl === frame.dataUrl && best.score === score;
        if (ordered && !(duplicate && e.mode === 'single') && (!best || score > best.score)) best = { frame, score, index };
        // A large score never proves sufficient text detail. Only an exact
        // repeated candidate can stop local comparison before its bounded end.
        if (ordered && repeated && score >= .08) break;
      }
      if (best) pending.push({ frame: best.frame, slot, index: best.index });
      else if (!stopped) audit.unresolved.push(`${e.need}：候选重复或无法保持状态时间顺序，未增加图片；未作语义充分性确认。`);
      if (stopped) break;
    }
    if (pending.length !== slots.length) {
      for (const c of pending) audit.candidates[c.index].decision = 'incomplete-group';
      audit.unresolved.push(`${e.need}：未取得完整证据组${stopped ? '（总媒体时间或候选预算）' : ''}，未发送半组画面。`);
    } else {
      const bytes = pending.reduce((n, c) => n + frameBytes(c.frame), 0);
      if (audit.budget.imageBytes + bytes > imageLimits.totalBytes) {
        for (const c of pending) audit.candidates[c.index].decision = 'budget';
        audit.unresolved.push(`${e.need}：实际图片字节超预算，整组未发送。`);
      } else {
        for (const c of pending) {
          audit.candidates[c.index].decision = 'selected';
          if (!audit.candidates[c.index].metrics) audit.unresolved.push(`${e.need}：未取得本地像素指标，无法本地评价画质；保留合法画面供最终模型判断。`);
          else if (audit.candidates[c.index].quality < .08) audit.unresolved.push(`${e.need}：画面低纹理或对比度不足；未能本地确认文字可读，保留合法画面供最终模型判断。`);
          const { sample: _sample, ...frame } = c.frame;
          audit.budget.imageBytes += frameBytes(frame);
          audit.budget.mediaMs = Math.round(now() - started);
          audit = await accept(frame, c.slot, audit); adopted.push(c.frame);
        }
      }
    }
    audit.budget.mediaMs = Math.round(now() - started);
    audit.unresolved = [...new Set(audit.unresolved)].map(text => text.slice(0, 220)).slice(0, 16);
    await progress(audit);
    // Hitting the last candidate exactly after the final group is completion,
    // not evidence that another window went unchecked.
    if (stopped || audit.budget.captures >= audit.budget.maxCaptures && groupIndex < groups.length - 1) { stopped = true; break; }
  }
  audit.stopReason = stopped ? 'budget' : 'local-selection-complete';
  if (stopped) audit.unresolved = [...audit.unresolved, '媒体总时间或候选预算已到边界，剩余窗口未检查。'].slice(0, 16);
  const released = (audit.slots.length - audit.frames.length) * 1024;
  audit.budget.apiTokensUpperBound -= released; audit.budget.imageTokensUpperBound -= released;
  return audit;
}
