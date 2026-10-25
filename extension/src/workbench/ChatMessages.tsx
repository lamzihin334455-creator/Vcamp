import { RequestInstructionButton } from './Instructions';
import {TimedMarkdown} from './TimedMarkdown';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { WebSources } from './WebSources';
import type { ApplicationClient } from '../contracts/application';
import { AttachmentImages } from './Attachments';
import { terminal, type GenerationView, type GenerationCommand } from '../contracts/generation';
import { createTrailingRefresh, taskLabels } from '../app/use-generation';
import { Icon } from '../app/Icons';
import { MessageTask } from './MessageTask';
import { VisualEvidence } from './VisualEvidence';

export function ChatMessages({ messages, pending, jobs = [], mediaDuration, taskCommand, readonly, busy, active, onSeek, openNote, openKnowledge, openScribble, client, target }: { pending?:string; mediaDuration?:number; jobs?: GenerationView['jobs']; taskCommand?: (op: GenerationCommand) => unknown; readonly?: boolean; busy?: boolean; active?: boolean; onSeek?: (time: number) => void; client?: ApplicationClient; target?: { workspaceId: string; chatId: string }; messages: GenerationView['messages']; openNote: (id: string) => void; openKnowledge?: (id: string) => void; openScribble: (id: string) => void }) {
  const owners = new Map<string, typeof messages[number]>();
  for (const message of messages) if (message.role === 'assistant') owners.set(message.jobId, message);
  const taskById = new Map(jobs.map(job => [job.jobId, job]));
  const readyArtifacts=useReadyArtifacts(messages,client,target);
  return <>{messages.map(message => { const job=taskById.get(message.jobId),completedArtifact=message.role==='assistant'&&message.state==='completed'&&!!message.artifactId&&(message.outputType==='markdown'||message.outputType==='html'),artifactReady=!!message.artifactId&&readyArtifacts.has(message.artifactId); return <article key={message.messageId} className={`chat-turn ${message.role}`}>
    {message.role === 'assistant' && <div className="ai-mark"><Icon name="chat"/></div>}
    <div className="answer-body"><small className="sr-only">{message.kind === 'scribble-operation' ? '随笔记录' : message.role === 'user' ? '你' : `Vcamp · ${taskLabels[message.state]}`}</small>
      {message.role==='user'?<p>{requestDisplay(message)}</p>:completedArtifact?(artifactReady?null:<p role="status">{message.outputType==='html'?'页面':'笔记'}已保存，正在准备打开…</p>):message.outputType === 'html' ? <p>{`HTML · ${taskLabels[message.state]}（完整验证前不入库）`}</p> : message.outputType === 'markdown' ? <p>{`Markdown 笔记 · ${taskLabels[message.state]}（未入库）`}</p> : <AnswerText text={message.text || (message.state === 'running' ? '等待回答…' : '')} seek={onSeek} duration={job?.mediaDuration??mediaDuration}/>}
      {!completedArtifact&&message.role === 'assistant' && <WebSources evidence={message.webEvidence}/>}
      {!completedArtifact&&client && target && !!message.attachmentIds.length && <AttachmentImages client={client} target={target} ids={message.attachmentIds} historyOnly/>}
      {message.scribbleId && <button onClick={() => openScribble(message.scribbleId!)}>打开随笔</button>}
      {message.artifactId&&artifactReady && <button onClick={() => message.outputType === 'html' ? openKnowledge?.(message.artifactId!) : openNote(message.artifactId!)}>{message.outputType === 'html' ? '打开页面' : '打开笔记'}</button>}
      {message.role === 'assistant' && (message.text||terminal(message.state)||job?.visual?.planningFailure) && <AnswerActions text={message.text} state={message.state} evidence={job?.evidence} client={!readonly?client:undefined} target={target} jobId={message.jobId}/>}
      {message === owners.get(message.jobId) && <><VisualEvidence job={job}/><MessageTask job={job} command={taskCommand} readonly={readonly} busy={busy} active={active}/></>}
    </div>
  </article>})}{jobs.filter(job => job.state !== 'completed' && !messages.some(message => message.role === 'assistant' && message.jobId === job.jobId)).map(job => <article className="chat-turn assistant" key={job.jobId}><div className="ai-mark"><Icon name="chat"/></div><div className="answer-body">{job.visual?.planningFailure&&!readonly&&client&&target&&<RequestInstructionButton compact client={client} jobId={job.jobId} target={target}/>}<MessageTask job={job} command={taskCommand} readonly={readonly} busy={busy} active={active}/></div></article>)}{pending!==undefined&&<><article className="chat-turn user"><div className="answer-body"><small className="sr-only">你</small><p>{pending}</p></div></article><article className="chat-turn assistant"><div className="ai-mark"><Icon name="chat"/></div><div className="answer-body"><p role="status" className="pending-generation">正在生成…</p></div></article></>}</>;
}
const outputNames={chat:'Chat 问答',markdown:'Markdown 笔记',html:'HTML 页面'} as const;
export function requestDisplay(message:GenerationView['messages'][number]){
  if(message.text.trim())return message.text;
  if(message.templateSnapshot)return `使用模板「${message.templateSnapshot.name}」生成 ${outputNames[message.templateSnapshot.outputType]}`;
  if(message.attachmentIds.length)return `使用 ${message.attachmentIds.length} 个附件发起请求`;
  return '已发送请求';
}
function useReadyArtifacts(messages:GenerationView['messages'],client?:ApplicationClient,target?:{workspaceId:string;chatId:string}){
  const candidates=messages.filter(message=>message.role==='assistant'&&message.state==='completed'&&message.artifactId&&(message.outputType==='markdown'||message.outputType==='html')).map(message=>({id:message.artifactId!,type:message.outputType!}));
  const key=candidates.map(candidate=>`${candidate.type}:${candidate.id}`).join('|');
  const [ready,setReady]=useState<Set<string>>(()=>new Set());
  useEffect(()=>{
    let alive=true,sequence=0,retries=0,timer:ReturnType<typeof setTimeout>|undefined;
    const candidateIds=new Set(candidates.map(candidate=>candidate.id));
    setReady(current=>new Set([...current].filter(id=>candidateIds.has(id))));
    if(!client||!target||!candidates.length)return()=>{alive=false;};
    const refresh=async()=>{
      const token=++sequence;
      const noteIds=new Set(candidates.filter(candidate=>candidate.type==='markdown').map(candidate=>candidate.id));
      const pageIds=new Set(candidates.filter(candidate=>candidate.type==='html').map(candidate=>candidate.id));
      const found:string[]=[];let notesRead=false,pagesRead=false;
      try{
        const [notes,pages]=await Promise.all([
          noteIds.size?client.artifacts?.({type:'artifact.query',workspaceId:target.workspaceId,sourceChatId:target.chatId}):undefined,
          pageIds.size?client.knowledge?.({type:'knowledge.query',workspaceId:target.workspaceId}):undefined
        ]);
        notesRead=!noteIds.size||!!notes;pagesRead=!pageIds.size||!!pages;
        for(const artifact of notes?.artifacts??[])if(noteIds.has(artifact.id))found.push(artifact.id);
        for(const artifact of pages?.artifacts??[])if(pageIds.has(artifact.id))found.push(artifact.id);
      }catch{}
      if(!alive||token!==sequence)return;
      setReady(current=>{
        const next=new Set([...current].filter(id=>candidateIds.has(id)));
        if(notesRead)for(const id of noteIds)next.delete(id);
        if(pagesRead)for(const id of pageIds)next.delete(id);
        for(const id of found)next.add(id);
        return next;
      });
      if(found.length<candidates.length&&retries++<40)timer=setTimeout(()=>void refresh(),120);
    };
    const requestRefresh=createTrailingRefresh(refresh);
    const dispose=client.subscribe(()=>void requestRefresh(),state=>{if(state==='connected')void requestRefresh();});
    void requestRefresh();
    return()=>{alive=false;clearTimeout(timer);dispose();};
  },[client,target?.workspaceId,target?.chatId,key]);
  return ready;
}
const evidenceLabels={full_subtitles:'完整主字幕',video_chapters:'视频章节',video_description:'视频简介',hot_comments:'热门评论',video_frames:'视频画面',conversation_history:'对话历史',web:'网页补充'} as const;
function EvidenceSummary({evidence}:{evidence:NonNullable<GenerationView['jobs'][number]['evidence']>}){
  const included=evidence.includedSources.map(source=>evidenceLabels[source]);
  const unavailable=evidence.unavailableSources.map(source=>evidenceLabels[source]);
  return <details className="message-evidence"><summary>本次资料</summary><p>已提供：视频标题{included.length?`、${included.join('、')}`:''}</p><p>{evidence.plan.interpretedIntent}</p>{evidence.plan.outputRequirements.length>0&&<p>输出要求：{evidence.plan.outputRequirements.join('；')}</p>}{unavailable.length>0&&<p>未取得：{unavailable.join('、')}</p>}{evidence.planningMode==='fallback'&&<p>资料规划未完成，已使用稳定回退方案。</p>}</details>;
}
function AnswerActions({ text, state, evidence, client, target, jobId }: { text: string; state: string; evidence?:GenerationView['jobs'][number]['evidence']; client?:ApplicationClient; target?:{workspaceId:string;chatId:string};jobId:string }) {
  const [feedback, setFeedback] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(text); setFeedback('已复制'); }
    catch { setFeedback('复制失败，请选择正文手动复制。'); }
  }
  return <div className="answer-completion"><span>{terminal(state as keyof typeof taskLabels) && <><i/>{taskLabels[state as keyof typeof taskLabels]}</>}</span>{evidence&&<EvidenceSummary evidence={evidence}/>} {client&&target&&<RequestInstructionButton compact client={client} jobId={jobId} target={target}/>} {text&&<button aria-label="复制回答" title="复制回答" onClick={() => void copy()}><Icon name="copy"/></button>}{feedback && <small role="status">{feedback}</small>}</div>;
}
function AnswerText({text,seek,duration}:{text:string;seek?:(time:number)=>void;duration?:number}){return <div className="answer-content"><TimedMarkdown content={text} seek={seek} duration={duration}/></div>;}
