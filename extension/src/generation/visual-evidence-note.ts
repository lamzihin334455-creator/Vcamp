import type {VisionStage} from '../contracts/vision';

/** The final answer sees provenance and gaps, not a second copy of the
 * reviewer's transcription. A valid review is still fallible image reading. */
export function visualEvidenceNote(visual:VisionStage){
  if(visual.resolution==='subtitle')return '用户选择仅用字幕与已有附件；自主画面未作为回答依据。';
  const audit=visual.audit;
  if(!audit)return '沿用原请求已冻结的实际图片依据。';
  const review=visual.review;
  const reviewNote=review?`第二阶段核验是模型对补帧前图片的有限判断，不是正确性保证；最终仍以实际提供的图片为准。补帧没有再次独立核验，不能把旧图观察当成新图已确认内容。逐项目标未确认时，不把整项需要或字幕表述升级为画面已经证实；如需引用这些内容，应明确来自字幕/作者主张或注明不确定。静态截图中的目视相似、测量结果文字，不等于独立实测证明像素完全一致；方向键、焦点移动、动画等行为不能用单张状态图确认。不向用户叙述内部取图轮次和替换过程，只呈现内容结论及影响结论的必要不确定性。核验状态与缺口：${JSON.stringify({status:review.status,failure:review.failure,results:review.results.map(r=>({evidenceId:r.evidenceId,status:r.status,missing:r.missing,...(r.checks?{checks:r.checks.map(c=>({target:c.target,status:c.status}))}:{})})),repairs:review.repairs,refinementNotes:review.refinementNotes})}`:'';
  return `视觉证据采集记录（${review?'已安排第二阶段，实际核验状态见后文':'只是定位和本地可用性检查，未进行独立视觉语义核验'}；本次依据是字幕与离散关键帧，不表示完整观看；请根据实际图片判断，待读目标不表示已读到对应内容；概览图用于相应外观或结构，不附带转录无关的精确数字）：${JSON.stringify({evidence:visual.evidencePlan?.evidence.map(e=>({id:e.id,need:e.need,mode:e.mode,detailNeed:e.detailNeed,...(e.checkTargets?.length?{checkTargets:e.checkTargets}:{}),...(e.readTargets?.length?{readTargets:e.readTargets}:{})})),samplingNotes:audit.samplingNotes,actual:audit.frames,reusedIds:audit.historyAttachmentIds,unresolved:audit.unresolved,stopReason:audit.stopReason})}\n${reviewNote}`;
}
