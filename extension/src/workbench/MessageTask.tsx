import type { GenerationCommand, JobView } from '../contracts/generation';
import { terminal } from '../contracts/generation';
import { failureLabels, taskLabels } from '../app/use-generation';
import {useState} from 'react';
import {failureFeedback,installedVersion} from './failure-feedback';
import {visionPlanFailureText} from './vision-plan-failure';

export function taskFailureMessage(job:JobView){
  const web=job.diagnostics?.filter(d=>d.purpose==='web-search').at(-1);
  if(web&&job.error){
    if(web.webFailure==='query-plan'||web.webFailure==='invalid-query')return '检索关键词生成未完成，可重试或复制完整诊断反馈。';
    if(web.webFailure==='request-rejected'&&web.httpStatus)return `搜索服务拒绝请求（HTTP ${web.httpStatus}），可复制完整诊断反馈。`;
    if(web.webFailure==='missing-execution')return '服务未执行搜索工具，可重试或复制完整诊断反馈。';
    if(web.webFailure==='empty-material')return '搜索结果未返回可用摘录，可重试或复制完整诊断反馈。';
    if(web.webFailure==='tool-error'&&web.webToolError==='too_many_requests')return '搜索服务限流，请稍后重试。';
    if(web.webFailure==='tool-error'&&web.webToolError==='unavailable')return '搜索服务暂不可用，请稍后重试。';
  }
  const rejected=job.diagnostics?.filter(d=>d.purpose!=='web-search'&&d.cause==='transport'&&d.httpStatus&&d.httpStatus>=400).at(-1);
  if(rejected&&job.error){
    const code=rejected.serviceErrorCode;
    if(code==='AccessDenied.Unpurchased')return '服务或模型尚未开通，请在服务商控制台开通后重试。';
    if(code==='AllocationQuota.FreeTierOnly')return '免费额度已耗尽且设置了用完即停，请检查百炼控制台。';
    if(code==='FREE_QUOTA_EXHAUSTED')return '服务商免费额度已耗尽，请等待额度恢复或检查套餐。';
    if(code&&['Arrearage','InsufficientBalance','insufficient_balance','insufficient_quota','QuotaExceeded'].includes(code))return '账户余额、额度或计费状态不满足调用要求，请检查服务商账户。';
    if(code&&['Workspace.AccessDenied','App.AccessDenied'].includes(code))return '当前 Key 没有此业务空间的调用权限，请检查授权。';
    if(code==='Model.AccessDenied'||code==='AccessDenied'||code==='access_denied')return '当前 Key 没有此模型的调用权限，请检查服务商授权。';
    if(rejected.httpStatus===429)return rejected.retryAfterSeconds?`服务限流（HTTP 429）。本次建议等待 ${rejected.retryAfterSeconds} 秒后重试。`:'服务限流或额度受限（HTTP 429），请稍后重试或检查服务商额度。';
    if(job.error==='auth')return `API Key 未通过验证，请检查 Key 与服务地址是否匹配（HTTP ${rejected.httpStatus}）。`;
    if(job.error==='model-unavailable')return '服务未找到此模型或当前 Key 无权调用，请核对模型 ID。';
    if(rejected.httpStatus===403)return '服务拒绝访问（HTTP 403），请检查模型授权、服务地址和账号限制。';
    if(job.error==='request-rejected')return `服务拒绝请求（HTTP ${rejected.httpStatus}），可在诊断中查看错误码。`;
  }
  const diagnostic=job.diagnostics?.filter(d=>d.purpose==='html-page').at(-1);
  if(diagnostic&&job.error){
    if(diagnostic.cause==='service-length')return '模型输出被服务端截断，HTML 未完成，未保存。可手动重试或切换模型。';
    const reason=diagnostic.cause==='local-characters'?'HTML 超过本地字符上限':diagnostic.cause==='response-bytes'||diagnostic.cause==='event-buffer'?'响应超过传输缓冲上限':job.error==='html-format'?'HTML 结构不完整':job.error==='timeout'?'HTML 请求超时':diagnostic.cause==='protocol'?'HTML 响应传输不完整':null;
    if(reason)return `${reason}，未保存。可简化要求后发送，或手动重试。`;
  }
  return job.error?failureLabels[job.error]:'';
}

export function FailureDetails({job}:{job:JobView}){
  const [status,setStatus]=useState(''),[manual,setManual]=useState(false);
  const text=failureFeedback(job,installedVersion());
  async function copy(){
    try{await navigator.clipboard.writeText(text);setStatus('完整诊断已复制');}
    catch{setManual(true);setStatus('复制未获允许，可下载诊断文件或在文本框中全选复制。');}
  }
  function download(){
    const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`vcamp-error-${job.attemptId}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);setStatus('已下载诊断文件');
  }
  return <div className="failure-feedback">
    {!!job.visual?.planningFailure?.fields.length&&<p>校验位置：<code>{job.visual.planningFailure.fields.join('、')}</code></p>}
    {job.visual?.planningFailure?.syntax?.offset!==undefined&&<p>JSON 解析位置：第 {job.visual.planningFailure.syntax.line} 行，第 {job.visual.planningFailure.syntax.column} 列；位置按去除唯一外层围栏后的正文计算。</p>}
    {job.visual?.planningFailure&&<p>可从消息旁的“AI 指令”选择“取帧规划”，查看并单独复制失败规划响应。旧版响应或已过期记录无法补回。</p>}
    {job.visual?.review?.status==='failed'&&<p>回答已完成，独立核验未完成。可从“AI 指令”选择“视觉核验”，查看失败核验响应；旧版或已过期记录无法补回。</p>}
    <div className="failure-feedback-actions"><button onClick={()=>void copy()}>复制完整诊断</button><button onClick={download}>下载诊断文件</button></div>
    <small role="status">{status}</small>
    <p>诊断包含故障阶段和用量，不含密钥、视频正文或图片。</p>
    {!job.diagnostics?.length&&<p>此任务未记录详细阶段；旧记录无法补回，更新后重试会记录新诊断。</p>}
    <details><summary>失败详情（用于反馈）</summary><textarea aria-label="完整诊断文本" readOnly value={text} onFocus={event=>event.currentTarget.select()}/></details>
    {manual&&<textarea aria-label="手动复制诊断文本" readOnly value={text} autoFocus onFocus={event=>event.currentTarget.select()}/>}
  </div>;
}

/** Only a message's current attempt owns controls. Successful history has none. */
export function MessageTask({ job, readonly = true, busy = false, active = false, command }: { job?: JobView; readonly?: boolean; busy?: boolean; active?: boolean; command?: (op: GenerationCommand) => unknown }) {
  if (!job || job.state === 'completed') return null;
  const running = !terminal(job.state), committing=job.state==='committing', permission = job.state === 'awaiting-permission' && job.visual && !job.visual.resolution;
  const planFailure=job.visual?.planningFailure;
  const repairPending=job.visual?.review?.repairDecision==='pending';
  const visualProgress=job.visual?.phase==='planning'?'正在判断所需画面…':['capturing','refining'].includes(job.visual?.phase??'')?'正在读取原视频画面…':job.visual?.phase==='checking'?'正在核验重要画面…':job.visual?.phase==='answering'&&job.visual.attachmentIds.length?`正在结合 ${job.visual.attachmentIds.length} 张画面生成…`:null;
  return <div className="message-task" data-job-id={job.jobId}>
    {running && <div className="message-progress" role="status"><span>{committing?'正在保存产物…':job.webEvidence?.status === 'searching' ? '正在检索网页…' : permission&&job.visual?.issue==='plan'?'等待选择继续方式':visualProgress??taskLabels[job.state]}</span>{!readonly && <button disabled={busy||committing} onClick={() => command?.({type:'generation.stop',jobId:job.jobId})}>停止生成</button>}</div>}
    {permission && <div className="message-permission"><p>{repairPending ? '播放器已恢复。核验发现部分重要画面仍不足；可重新授权一次相关补帧，或保留现有画面继续。补帧完成后恢复你授权时的播放状态；你操作播放器或切页后会停止取帧。' : job.visual!.issue === 'plan' ? `画面规划未通过校验：${planFailure?visionPlanFailureText(planFailure):'规划格式不符合要求'}。尚未开始截图；${job.webEvidence?'已取得的检索资料保留；':''}可仅用字幕与已有附件继续或停止。` : job.visual!.issue === 'permission' ? '本次尚未授权取帧。只在原视频页短暂暂停并跳转；完成后恢复原播放状态。你操作播放器或切页后会停止取帧，保留你的操作。' : job.visual!.issue === 'model' ? '当前模型未声明支持视觉。' : job.visual!.issue === 'resource' ? '图片数量或字节预算不足，未完整取得画面。' : '原视频取帧未完成；仅用字幕继续不会使用计划画面。'}</p>{!readonly && <>{job.visual!.issue === 'permission' && <button disabled={busy} onClick={() => command?.({type:'generation.vision.decide',jobId:job.jobId,choice:'images'})}>{repairPending?'授权补充画面':'授权原视频取帧'}</button>}<button disabled={busy} onClick={() => command?.({type:'generation.vision.decide',jobId:job.jobId,choice:repairPending?'keep':'subtitle'})}>{repairPending?'保留现有画面继续':'仅用字幕继续'}</button></>}</div>}
    {permission&&planFailure&&<details><summary>规划诊断</summary><FailureDetails job={job}/></details>}
    {job.error && <p role="alert">{taskFailureMessage(job)}</p>}
    {!running && <details className="message-recovery"><summary>{job.error || job.state === 'failed' || job.state === 'interrupted' ? '失败详情 / 重试' : '更多操作'}</summary>
      {(job.error || job.diagnostics?.length || job.visual) && <FailureDetails key={job.attemptId} job={job}/>}
      {!readonly && <button disabled={busy || active} onClick={() => command?.({type:'generation.retry',jobId:job.jobId})}>重试原请求</button>}
    </details>}
  </div>;
}
