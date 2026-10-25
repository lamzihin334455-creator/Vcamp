import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {formatTime,parseTime,validTime,timeLinkLabel,videoTimeParts} from '../shared/time';
// View-only compatibility for an entire model-wrapped Markdown document. Never
// unwrap a normal code sample or rewrite a saved revision.
export function markdownBody(content:string){
  const match=/^\s*(`{3,}|~{3,})(?:markdown|md)[\t ]*\r?\n([\s\S]*?)\r?\n\1[\t ]*\s*$/i.exec(content);
  if(!match||new RegExp(`^${match[1]}[\\t ]*$`,'m').test(match[2]))return content;
  return match[2];
}
// mdast plugin transforms text nodes only, never code/inlineCode/URLs or source.
export function remarkVideoTimes(){return(tree:any)=>{
  const walk=(node:any)=>{if(['code','inlineCode','link','image','html'].includes(node.type))return;
    if(node.children)node.children=node.children.flatMap((child:any)=>{
      if(child.type!=='text'){walk(child);return [child];}
      return videoTimeParts(child.value).map(part=>part.time===undefined?{type:'text',value:part.text}:{type:'link',url:`vcamp-time:${part.time}`,children:[{type:'text',value:part.text}]});
    });
  };walk(tree);
};}
export function TimedMarkdown({content,seek,duration}:{content:string;seek?:(time:number)=>void;duration?:number}){
  return <Markdown skipHtml remarkPlugins={[remarkGfm,remarkVideoTimes]} urlTransform={url=>/^(https?:\/\/|mailto:|#)/i.test(url)||parseTime(url)!==null?url:''} components={{
    a:({href,children})=>{const time=href?parseTime(href):null;return time!==null&&!validTime(time,duration)?<span className="invalid-answer-time" title={`引用时间 ${formatTime(time)} 超出当前视频时长 ${formatTime(duration!)}，无法定位`}>[时间超出视频时长]</span>:time!==null?<button className="answer-time" disabled={!seek} onClick={()=>seek?.(time)}>{typeof children==='string'?timeLinkLabel(children,time):children??formatTime(time)}</button>:href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>;},
    table:({children})=><div className="markdown-table" tabIndex={0} aria-label="表格（可横向滚动）"><table>{children}</table></div>,
    img:({alt})=><span>{alt?`[图片：${alt}]`:'[图片]'}</span>
  }}>{markdownBody(content)}</Markdown>;
}
