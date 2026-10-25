import type { JobView } from '../contracts/generation';
import { formatTime } from '../shared/time';
import {visionPlanFailureText} from './vision-plan-failure';
import {FailureDetails} from './MessageTask';

const decisions = { selected: '采用', alternative: '备用候选', duplicate: '外观重复', 'low-quality': '画质不足', budget: '预算不足', 'incomplete-group': '证据组未完整取得', superseded: '补帧前候选（已替换）' };
const reviewStatuses={sufficient:'模型判断足够',partial:'部分满足',missing:'目标未出现',unreadable:'所需内容读不清',uncertain:'无法确定'};
const checkStatuses={confirmed:'已确认',unreadable:'看不清','not-visible':'未出现',uncertain:'无法确定'};
const stops = { planned: '待取帧', 'local-selection-complete': '本地择帧结束', 'no-new-evidence': '无需新画面', budget: '预算边界', media: '媒体读取中止', 'subtitle-only': '仅用字幕继续' };
export function VisualEvidence({ job }: { job?: JobView }) {
  const audit = job?.visual?.audit, plan = job?.visual?.evidencePlan, review=job?.visual?.review;
  const correction=job?.visual?.planningCorrection;
  const replaced=new Set(review?.repairs.filter(r=>r.state==='captured-unverified').flatMap(r=>audit?.slots.find(s=>s.key===r.slotKey)?.evidenceIds??[]));
  const correctionNote=correction&&<p>规划校正：{correction.outcome==='succeeded'?'一次校正后通过协议校验；这不代表已核验画面内容。':correction.outcome==='budget'?'剩余综合预算不足，未追加校正调用。':'已校正一次，仍未取得合格规划。'}</p>;
  if(job?.visual?.planningFailure)return <details className="message-evidence visual-evidence"><summary>画面依据（规划未通过）</summary>
    {correctionNote}
    <p>{visionPlanFailureText(job.visual.planningFailure)}。</p>
    <p>{job.visual.resolution==='subtitle'?'已选择仅用字幕与已有附件继续；本次没有新增截图，自主画面未作为回答依据。':'尚未取得新截图。'}</p>
    {job.state==='completed'&&<details><summary>规划诊断</summary><FailureDetails job={job}/></details>}
  </details>;
  if (!audit || !plan) return null;
  const actualUsage = job.diagnostics;
  const knownUsage = actualUsage?.filter(d => d.usage.totalTokens !== undefined);
  return <details className="message-evidence visual-evidence"><summary>画面依据（{audit.frames.length} 张新增）</summary>
    {correctionNote}
    <p>{review?'按问题需求提取关键帧，核验情况见下方。以下展示当前采用的截图；未确认内容仍以字幕或作者表述为准。':'字幕定位＋本地择帧。未作独立视觉语义核验；清晰度指标不能证明文字已读对。'}</p>
    {job.visual?.cueGrounded&&<p>字幕定位：模型选择字幕编号，本地按原字幕精确时间计算窗口与锚点；这不是画面内容已确认。</p>}
    {!!audit.samplingNotes?.length&&<><p><strong>画面取样说明</strong></p><ul>{audit.samplingNotes.map((text,index)=><li key={index}>{text}</li>)}</ul></>}
    {review?.status==='checking'&&<p>{job.visual?.phase==='retired'?'核验已中止，未形成核验结论。':'正在核验实际截图，播放器已恢复。'}</p>}
    {review?.status==='failed'&&<p>独立核验未完成（{review.failure==='transport'?'请求未完成':review.failure==='limit'?'响应达到上限':'核验响应未通过校验'}）；保留实际画面与未确认状态。</p>}
    {review?.correction&&<p>核验校正：{review.correction.outcome==='succeeded'?'一次校正后通过协议校验；具体缺口仍见各项核验结果。':review.correction.outcome==='budget'?'综合预算不足，未追加校正调用。':'已校正一次，仍未形成合格核验结论。'}</p>}
    {review?.status==='failed'&&job.state==='completed'&&<details><summary>核验诊断（回答已完成）</summary><FailureDetails job={job}/></details>}
    {review?.status==='skipped'&&<p>{review.failure==='budget'?'综合预算不足，跳过独立核验；实际画面仍由最终回答判断。':'本次没有需要独立核验的重要图片。'}</p>}
    {job.visual?.resolution === 'subtitle' && <p>本次仅用字幕及已有附件继续；新取得的候选没有送入最终回答。</p>}
    {plan.evidence.map(e => <section key={e.id}><p><strong>{e.need}</strong> · {e.priority === 'required' ? '必要' : '补充'}{e.mode !== 'single' ? ' · 关联状态组' : ''}</p>
      <p>{e.reason}</p>
      {!!e.checkTargets?.length&&<p>核验目标：{e.checkTargets.join('、')}。</p>}
      {!!e.readTargets?.length && <p>待读目标：{e.readTargets.join('、')}（{review?'定位需求，核验状态见下方':'定位需求，尚未核验内容'}）。</p>}
      {[...new Set(audit.slots.filter(s => s.evidenceIds.includes(e.id)).map(s => replaced.has(e.id)?'按所需内容保留原始帧细节':s.detailReason).filter(Boolean))].map(reason => <p key={reason}>分辨率依据：{reason}。</p>)}
      {e.windows.map((w, i) => <p key={i}>计划窗口 {formatTime(w.from)}—{formatTime(w.to)}，锚点 {formatTime(w.anchor)}</p>)}
      {audit.frames.filter(f => audit.slots.find(s => s.key === f.slotKey)?.evidenceIds.includes(e.id)).map(f => <p key={f.attachmentId}>实际 {formatTime(f.time)}（{f.time.toFixed(3)}秒） · {f.detail === 'original' ? '清晰细节' : '概览'}</p>)}
      {review?.results.filter(r=>r.evidenceId===e.id).map(r=>replaced.has(e.id)?<div key={r.evidenceId}><p>当前画面由回答模型结合字幕判断。</p>{r.missing&&<p>待确认：{r.missing}。</p>}</div>:<div key={r.evidenceId}><p>画面核验：{reviewStatuses[r.status]}。</p>{r.checks?<ul>{r.checks.map(c=><li key={c.checkId}>{c.target}：{checkStatuses[c.status]}。{c.observation}</li>)}</ul>:r.observations.map((text,i)=><p key={i}>观察：{text}</p>)}{r.missing&&<p>缺口：{r.missing}</p>}</div>)}
      {!!e.reuseAttachmentIds.length && <p>计划复用 {e.reuseAttachmentIds.length} 张冻结图片；元数据未核验其内容。</p>}
    </section>)}
    {!!audit.unresolved.length && <><p><strong>未解决或待确认</strong></p><ul>{audit.unresolved.map((text, index) => <li key={index}>{text}</li>)}</ul></>}
    <p>停止原因：{audit.stopReason ? stops[audit.stopReason] : '执行中'}。本地取帧 {audit.budget.captures}/{audit.budget.maxCaptures} 次，媒体处理 {(audit.budget.mediaMs / 1000).toFixed(1)} 秒，上限 {audit.budget.maxMediaMs / 1000} 秒（含恢复预留）。</p>
    <p>图像 token 保守上界 {audit.budget.imageTokensUpperBound}；本阶段规划{review?'、核验':''}与回答 token 预留估计 {audit.budget.apiTokensUpperBound}，包含最终输出预留 {audit.budget.finalOutputReserved}。{audit.budget.reviewTokensUpperBound?`其中核验请求与输出预留 ${audit.budget.reviewTokensUpperBound}，已包含再次发送图片的开销。`:''}发送前按实际请求再检查；其他阶段用量以服务 usage 为准。</p>
    <p>已采用图片合计 {(audit.budget.imageBytes / 1024).toFixed(0)} KiB；费用金额未配置，无法提供精确金额。</p>
    {knownUsage?.length ? <p>已有 usage 记录：{knownUsage.reduce((n, d) => n + (d.usage.totalTokens ?? 0), 0)} token{knownUsage.length !== actualUsage?.length ? '（部分调用未返回用量）' : ''}。</p> : <p>服务未返回 token 用量。</p>}
    {!!audit.candidates.length && <details><summary>查看候选取舍</summary><p>{audit.qualityVersion === 'local-v2' ? '本地择帧分用于同一窗口候选比较，不是文字识别置信度；边缘与对比度仍可能受壁纸、字幕或人像影响。' : '旧版画质指标可能封顶，不能与新版择帧分直接比较。'}</p><ul>{audit.candidates.filter(c=>c.decision!=='superseded').map((c, i) => <li key={i}>{formatTime(c.time)}（{c.time.toFixed(3)}秒） · {c.width}×{c.height} · {decisions[c.decision]} · {audit.qualityVersion === 'local-v2' ? c.metrics ? `本地择帧分 ${c.quality.toFixed(3)}，边缘 ${c.metrics.sharpness.toFixed(2)}，对比 ${c.metrics.contrast.toFixed(2)}` : '本地指标未测得' : `旧版画质指标 ${c.quality.toFixed(2)}`}</li>)}</ul></details>}
  </details>;
}
