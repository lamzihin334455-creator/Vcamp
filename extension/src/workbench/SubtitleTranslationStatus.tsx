import {useEffect,useState} from 'react';
import {terminal,type GenerationCommand,type JobView} from '../contracts/generation';
import type {SubtitleVersion} from '../contracts/subtitles';
import {failureLabels} from '../app/use-generation';

const languageNames:Record<string,string>={en:'英语',zh:'中文',ja:'日语',ko:'韩语',fr:'法语',de:'德语'};

export function SubtitleTranslationStatus({job,version,busy,selecting,command,viewTranslation,dismiss}:{job:JobView;version?:SubtitleVersion;busy:boolean;selecting:boolean;command:(op:GenerationCommand)=>unknown;viewTranslation:()=>void;dismiss:()=>void}) {
  const correction=job.target.kind==='subtitle'&&job.target.operation==='enhance',action=correction?'修正':'翻译';
  const finished=terminal(job.state),completed=job.state==='completed';
  const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[dismissing,setDismissing]=useState(false);
  // Only current terminal feedback expires. Interaction and source writes keep
  // the action available; the parent never replays a historical completion.
  useEffect(()=>{
    if(!finished||hovered||focused||selecting||busy||dismissing)return;
    const timer=setTimeout(()=>setDismissing(true),completed?5000:8000);
    return ()=>clearTimeout(timer);
  },[finished,completed,hovered,focused,selecting,busy,dismissing]);
  useEffect(()=>{
    if(!dismissing)return;
    const timer=setTimeout(dismiss,220);
    return ()=>clearTimeout(timer);
  },[dismissing,dismiss]);
  const title=({queued:`${action}排队中`,preparing:`正在准备${action}`,running:job.subtitlePhase==='terms'?'正在检查专有名词':job.subtitlePhase==='searching'?'正在联网核对名称':job.subtitlePhase==='reconciling'?(correction?'正在核对必要修正':'正在统一全文术语'):`正在${action}字幕`,committing:`正在保存${correction?'修正版':'译文'}`,completed:`${action}完成`,stopped:`${action}已停止`,failed:`${action}未完成`,interrupted:`${action}已中断`,'awaiting-permission':`${action}等待继续`})[job.state];
  const detail=completed?version?`${languageNames[version.language]??version.language} · ${version.cues.length} 条字幕`:'保存版已不可用，请在字幕设置中重新选择或生成。':job.error?failureLabels[job.error]:job.state==='queued'?'将在前面的字幕任务结束后开始':job.state==='stopped'?'已停止，可手动重试':job.state==='interrupted'?'处理已中断，可手动重试':job.coverage.total?`已完成 ${job.coverage.covered} / ${job.coverage.total} 批`:`正在读取待${action}的字幕`;
  return <div className="subtitle-translation-notice" data-dismissing={dismissing} onPointerEnter={()=>setHovered(true)} onPointerLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}><div className="subtitle-translation-clip"><section className="subtitle-translation-status" aria-label={`AI ${action}进度`} data-state={job.state} data-translation-job-id={job.jobId}>
    <div className="subtitle-translation-copy" role="status" aria-atomic="true"><strong><i className={finished?'translation-state-mark':'translation-spinner'} aria-hidden="true">{completed?'✓':finished?'!':''}</i>{title}</strong><span>{detail}</span></div>
    {!finished&&<progress aria-label={`${action}批次进度`} max={job.coverage.total||1} value={job.coverage.total?job.coverage.covered:undefined} aria-valuenow={job.coverage.total?job.coverage.covered:undefined} aria-valuemax={job.coverage.total||undefined}/>}
    <div className="subtitle-translation-actions">
      {completed?version&&<button className="translation-view" disabled={selecting} onClick={viewTranslation}>{selecting?'正在切换…':correction?'查看修正版':'查看译文'}</button>:finished?<button disabled={busy} onClick={()=>command({type:'generation.retry',jobId:job.jobId})}>重试{action}</button>:<button disabled={busy||job.state==='committing'} onClick={()=>command({type:'generation.stop',jobId:job.jobId})}>停止{action}</button>}
    </div>
  </section></div></div>;
}
