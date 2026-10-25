import {DocumentExportDialog} from '../library/DocumentExport';
import {useEffect,useMemo,useRef,useState} from 'react';
import {htmlAction,type HtmlAction} from '../html/navigation';
import type {ModuleProps} from '../app/modules';
import type {KnowledgeView} from '../contracts/knowledge';
import {KnowledgeWorkbench} from './Knowledge';

export function HtmlPages(props:ModuleProps) {
  const {client,view,artifactId,onChromeChange}=props;
  const [exportOpen,setExportOpen]=useState(false);
  const [items,setItems]=useState<KnowledgeView['artifacts']>([]),[selected,setSelected]=useState(artifactId??''),[error,setError]=useState('');
  const [instance,setInstance]=useState(0),[closed,setClosed]=useState(false);
  const frame=useRef<HTMLIFrameElement>(null);
  useEffect(()=>{setSelected(artifactId??'');setClosed(false);setInstance(v=>v+1);},[artifactId,view.workspaceId]);
  useEffect(()=>{
    let alive=true,seq=0;setItems([]);setError('');
    const refresh=async()=>{if(!view.workspaceId||!client.knowledge)return;const token=++seq;
      try{const value=await client.knowledge({type:'knowledge.query',workspaceId:view.workspaceId,...(view.mode==='readonly'&&artifactId?{artifactId}:{})});if(alive&&token===seq){setItems(value.artifacts);setError('');}}
      catch{if(alive&&token===seq)setError('页面读取失败，请重新打开。');}};
    const dispose=client.subscribe(()=>void refresh(),s=>{if(s==='connected')void refresh();});void refresh();return()=>{alive=false;dispose();};
  },[client,view.workspaceId,artifactId]);
  const page=items.find(a=>a.id===selected)??(!selected?items[0]:undefined);
  const session=useMemo(()=>crypto.randomUUID(),[page?.id,page?.revisionId,instance,closed,view.workspaceId]);
  const [pending,setPending]=useState<HtmlAction|null>(null),[actionBusy,setActionBusy]=useState(false);
  const pendingSession=useRef('');
  const executing=useRef(false);
  useEffect(()=>{
    setPending(null);pendingSession.current='';let last=-Infinity;
    const receive=(event:MessageEvent)=>{
      if(closed||page?.type!=='html-page'||event.source!==frame.current?.contentWindow)return;
      const action=htmlAction(event.data,session);if(!action||performance.now()-last<1000)return;
      // Transient activation propagates from the real sandbox click to its
      // ancestors. The private bridge nonce proves which trusted adapter sent
      // it; activation alone never authorizes arbitrary postMessage payloads.
      if(!navigator.userActivation.isActive)return;
      last=performance.now();pendingSession.current=session;
      if(action.kind==='seek')void perform(action);else setPending(current=>current??action);
    };
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  },[session,page?.id,page?.revisionId,closed]);
  async function confirm(event:React.MouseEvent){
    if(!event.isTrusted||!pending||!page||closed||pendingSession.current!==session||actionBusy)return;
    await perform(pending);
  }
  async function perform(action:HtmlAction){
    if(!page||closed||pendingSession.current!==session||executing.current)return;
    executing.current=true;setPending(null);setActionBusy(true);setError('');
    try{
      if(action.kind==='external')await chrome.tabs.create({url:action.url,active:true});
      else await client.library?.({type:'library.locate',target:{workspaceId:view.workspaceId!,entityType:'html',id:page.id},time:action.time});
    }catch{setError('无法打开此来源或定位时间，页面已保留。');}finally{executing.current=false;setActionBusy(false);}
  }
  useEffect(()=>{onChromeChange?.({title:page?.title,status:page?.type==='html'?'旧版结构化知识 · 已保存':page?'HTML 页面 · 已保存':'暂无页面',items:items.map(a=>({id:a.id,title:`${a.type==='html'?'旧知识 · ':''}${a.title}`,select:()=>{setSelected(a.id);setClosed(false);setInstance(v=>v+1);}})),actions:page?.type==='html-page'?[{label:'导出',run:()=>setExportOpen(true)},{label:'初始化',run:()=>{setClosed(false);setInstance(v=>v+1);}},{label:closed?'打开页面':'退出页面',run:()=>setClosed(v=>!v)}]:[]});},[page,items,onChromeChange,closed]);
  if(page?.type==='html')return <KnowledgeWorkbench {...props} artifactId={page.id} onChromeChange={undefined}/>;
  return <section className="html-workbench" aria-label="HTML 页面">
    {exportOpen&&page&&view.workspaceId&&<DocumentExportDialog client={client} entities={[{workspaceId:view.workspaceId,entityType:'html',id:page.id,title:page.title}]} close={()=>setExportOpen(false)}/>}
    {error&&<p role="alert">{error}</p>}
    {pending?.kind==='external'&&<div className="note-actions" role="group" aria-label="页面导航确认"><span>打开外部网页 {pending.url}？</span><button disabled={actionBusy} onClick={event=>void confirm(event)}>确认打开</button><button onClick={()=>setPending(null)}>取消</button></div>}
    {!page?<div className="empty-state"><h1>暂无 HTML 页面</h1><p>在问答中选择 HTML，描述你希望阅读和操作的内容。</p></div>:<>
      {!onChromeChange&&<div className="note-actions"><strong>{page.title}</strong><button onClick={()=>setExportOpen(true)}>导出 HTML</button><button onClick={()=>{setClosed(false);setInstance(v=>v+1);}}>初始化</button><button onClick={()=>setClosed(v=>!v)}>{closed?'打开页面':'退出页面'}</button></div>}
      {closed?<p>页面已退出。<button onClick={()=>{setInstance(v=>v+1);setClosed(false);}}>打开页面</button></p>:<iframe key={`${page.id}-${page.revisionId}-${instance}`} ref={frame} className="html-page-frame" title={`HTML 页面：${page.title}`} src="sandbox.html" sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" onLoad={()=>frame.current?.contentWindow?.postMessage({type:'vcamp.html.render',source:page.source,session},'*')}/>}
    </>}
  </section>;
}
