import {useEffect,useRef,useState} from 'react';
import type {ApplicationClient} from '../contracts/application';
import type {LibraryEntity,LibraryView} from '../contracts/library';
import {formatsFor,type DocumentFormat} from '../contracts/documents';
import {formatTime} from '../shared/time';
import {downloadDocument,exportBytes,zipDocuments} from './document-download';
import './document-export.css';

const categories=[['markdown','笔记'],['scribble','随笔'],['chat','问答'],['subtitle','字幕'],['html','HTML']] as const;
type Category=typeof categories[number][0];
const keyFor=(e:LibraryEntity)=>JSON.stringify([e.workspaceId,e.entityType,e.id]);
function languageLabel(code?:string){
  if(!code)return '语言未知';
  try{return `${new Intl.DisplayNames(['zh-CN'],{type:'language'}).of(code.replace(/^ai-/,''))??'语言未知'} / ${code}`;}
  catch{return `语言未知 / ${code}`;}
}
type Props={client:ApplicationClient;entities?:LibraryEntity[];workspaceId?:string;videoScope?:boolean;close?:()=>void};

// Selection and formats live for the whole panel, independently of its filters.
export function DocumentExport({client,entities,workspaceId,videoScope=true,close}:Props){
  const [catalog,setCatalog]=useState<LibraryView>({videos:[],entities:entities??[]}),[loading,setLoading]=useState(!!workspaceId),[error,setError]=useState('');
  const [selected,setSelected]=useState<Record<string,boolean>>({}),[formats,setFormats]=useState<Record<Category,DocumentFormat>>({markdown:'md',scribble:'md',chat:'md',subtitle:'srt',html:'html'});
  const [subtitleFormats,setSubtitleFormats]=useState<DocumentFormat[]>(['srt']),[sourceFilter,setSourceFilter]=useState('all');
  const [category,setCategory]=useState<Category>('markdown'),[part,setPart]=useState(workspaceId??entities?.[0]?.workspaceId??''),[filter,setFilter]=useState('all');
  const [status,setStatus]=useState<string[]>([]),[busy,setBusy]=useState(false),[mode,setMode]=useState<'zip'|'files'>('zip');
  const running=useRef(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{
    let live=true;if(!workspaceId||!client.library)return;setLoading(true);
    void client.library({type:'library.read',workspaceId,...(videoScope?{scope:'video' as const}:{})}).then(view=>{if(live){setCatalog(view);setError('');}}).catch(()=>{if(live)setError('资料读取失败，请关闭后重新打开导出。');}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[client,workspaceId,videoScope]);
  const baseRows=catalog.entities.filter(e=>e.entityType!=='workspace'),scribbleRows=baseRows.filter(e=>e.entityType==='scribble');
  const rows=[...baseRows.filter(e=>e.entityType!=='scribble'),...[...new Set(scribbleRows.map(e=>e.workspaceId))].map(workspaceId=>{const group=scribbleRows.filter(e=>e.workspaceId===workspaceId);return {...group[0],id:'*',title:`随笔汇总（${group.length} 条）`,summary:group.map(e=>e.title).join(' · '),time:undefined};})];
  const picks=rows.filter(e=>selected[keyFor(e)]),parts=catalog.videos[0]?.parts??[];
  const single=parts.length>0&&parts.every(p=>p.partCount===1);
  const partLabel=(id:string)=>{const p=parts.find(p=>p.workspaceId===id);return single?'本视频':p?`${p.pageNumber?`P${p.pageNumber}`:'来源分段'} · ${p.title}`:'当前来源';};
  const current=rows.filter(e=>e.entityType===category),choices=category==='subtitle'?[...new Set(current.map(e=>e.language).filter((v):v is string=>!!v))]:[];
  const visible=current.filter(e=>(part==='all'||e.workspaceId===part)&&(filter==='all'||category==='subtitle'&&e.language===filter||category==='scribble'&&(filter==='timed'?e.time!==undefined:e.time===undefined))&&(category!=='subtitle'||sourceFilter==='all'||e.sourceType===sourceFilter));
  const selection=picks.flatMap(e=>(e.entityType==='subtitle'?subtitleFormats:[formats[e.entityType as Category]]).filter(f=>f!=='bili-json'||e.rawAvailable).map(format=>({target:{workspaceId:e.workspaceId,entityType:e.entityType,id:e.id},format})));
  const unavailable=subtitleFormats.includes('bili-json')?picks.filter(e=>e.entityType==='subtitle'&&!e.rawAvailable):[];
  const expectedFiles=selection.reduce((n,p)=>{const e=picks.find(e=>keyFor(e)===keyFor({...p.target,title:''}))!;return n+1+(p.format==='srt'?1:0)+(p.format==='md'?(e.attachmentCount??0):0);},0);
  const rawDisabled=picks.some(e=>e.entityType==='subtitle')&&!picks.some(e=>e.entityType==='subtitle'&&e.rawAvailable);
  function selectRows(checked:boolean){setSelected(old=>{const next={...old};for(const row of visible)if(!row.exportUnavailable){if(checked)next[keyFor(row)]=true;else delete next[keyFor(row)];}return next;});}
  async function start(){
    if(running.current||!client.library||!selection.length)return;running.current=true;setBusy(true);setStatus([]);const cancel=new AbortController();controller.current=cancel;
    let completed=0,attempted=0,total=0;
    try{
      const result=(await client.library({type:'library.export',selection})).documents;
      if(!result)throw new Error('导出服务未返回结果');setStatus(result.errors.map(e=>`${e.file}：${e.reason}`));
      const files=exportBytes(result.files),downloads=mode==='zip'&&files.length>1?[{name:'Vcamp-所选资料.zip',bytes:zipDocuments(files)}]:files;total=downloads.length;
      for(const file of downloads){if(cancel.signal.aborted)break;attempted++;try{await downloadDocument(file.name,file.bytes,cancel.signal);completed++;setStatus(s=>[...s,`${file.name}：下载完成`]);}catch(e){setStatus(s=>[...s,`${file.name}：${e instanceof Error?e.message:'下载失败'}`]);}}
      if(cancel.signal.aborted)setStatus(s=>[...s,`已取消：完成 ${completed}/${total} 个下载，${attempted-completed} 个未完成，${total-attempted} 个未开始。已完成文件保留。`]);
      else if(!files.length&&!result.errors.length)setStatus(['没有可导出的文件。']);
    }catch(e){setStatus(s=>[...s,e instanceof Error?e.message:'导出失败']);}finally{running.current=false;setBusy(false);}
  }
  return <section className="document-export" aria-label="导出所选资料">
    <div className="export-toolbar">
    <div className="export-tabs" role="tablist" aria-label="资料分类">{categories.map(([type,label])=>{const available=rows.filter(e=>e.entityType===type&&!e.exportUnavailable);return <button key={type} role="tab" id={`export-tab-${type}`} aria-selected={category===type} aria-controls="export-list" onClick={()=>{setCategory(type);setFilter('all');setSourceFilter('all');}}>{label} <small>{available.filter(e=>selected[keyFor(e)]).length}/{available.length}</small></button>;})}</div>
    <div className="export-selection"><button disabled={busy||loading||!visible.some(e=>!e.exportUnavailable)} onClick={()=>selectRows(true)}>全选</button><button disabled={busy||!picks.length} onClick={()=>setSelected({})}>清空</button></div></div>
    <div className="export-body"><div className="export-filters">
      {!single&&!!parts.length&&<label>分 P<select aria-label="导出分 P" value={part} disabled={busy} onChange={e=>setPart(e.target.value)}><option value="all">本视频所有已保存分 P</option>{parts.map(p=><option key={p.workspaceId} value={p.workspaceId}>{partLabel(p.workspaceId)}{p.workspaceId===workspaceId?'（当前）':''}</option>)}</select></label>}
      {(category==='subtitle'||category==='scribble')&&<label>{category==='subtitle'?'语言':'时间'}<select aria-label="类别筛选" value={filter} disabled={busy} onChange={e=>setFilter(e.target.value)}><option value="all">全部</option>{category==='subtitle'?choices.map(v=><option key={v}>{v}</option>):<><option value="timed">有时间点</option><option value="untimed">无时间点</option></>}</select></label>}
      {category==='subtitle'&&<label>来源<select aria-label="字幕来源筛选" disabled={busy} value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}><option value="all">全部来源</option><option value="native">站点原始字幕</option><option value="translate">插件 AI 翻译</option><option value="enhance">插件 AI 字幕修正</option></select></label>}
    </div>
    <div id="export-list" role="tabpanel" aria-labelledby={`export-tab-${category}`} className="export-list">{loading?<p role="status">正在读取本视频资料…</p>:error?<p role="alert">{error}</p>:!visible.length?<p className="export-empty">没有符合筛选的已保存资料</p>:visible.map(e=><label className="export-row" key={keyFor(e)}><input type="checkbox" checked={!!selected[keyFor(e)]} disabled={busy||!!e.exportUnavailable} onChange={event=>setSelected(s=>{const next={...s};if(event.target.checked)next[keyFor(e)]=true;else delete next[keyFor(e)];return next;})}/><span><strong>{e.title}</strong><small>{partLabel(e.workspaceId)}{e.entityType==='subtitle'?` · ${languageLabel(e.language)} · ${e.cueCount??'未知'} 条字幕`:''}{e.time!==undefined?` · ${formatTime(e.time)}`:''}</small>{e.summary&&e.summary!==e.title&&<span className="export-summary">{e.summary}</span>}{e.provenance&&<small>{e.provenance}</small>}{e.attachmentCount!==undefined&&<small>含 {e.attachmentCount} 张来源截图（Markdown 保留）</small>}{e.exportUnavailable&&<small>{e.exportUnavailable}</small>}</span></label>)}</div>
    <div className="export-options">{(picks.length>0||category==='subtitle')&&<fieldset disabled={busy} className="export-settings" aria-label="导出格式">{categories.filter(([type])=>type!=='subtitle'&&picks.some(e=>e.entityType===type)).map(([type,label])=><label key={type}>{label}{type==='html'?<span>HTML（.html）</span>:<select aria-label={`${label}格式`} value={formats[type]} onChange={e=>setFormats(s=>({...s,[type]:e.target.value as DocumentFormat}))}>{formatsFor(type).map(f=><option key={f} value={f}>{f==='md'?'Markdown · 保留图片与附件':f.toUpperCase()}（.{f}）</option>)}</select>}</label>)}
      {(category==='subtitle'||picks.some(e=>e.entityType==='subtitle'))&&<fieldset className="subtitle-export-formats"><legend>字幕格式（可多选）</legend>{formatsFor('subtitle').map(f=><label key={f}><input type="checkbox" aria-label={f==='bili-json'?'B站原始JSON':f.toUpperCase()} checked={subtitleFormats.includes(f)} disabled={busy||f==='bili-json'&&rawDisabled&&!subtitleFormats.includes(f)} onChange={e=>setSubtitleFormats(old=>e.target.checked?[...old,f]:old.filter(v=>v!==f))}/>{f==='bili-json'?'B站原始 JSON':f.toUpperCase()}</label>)}</fieldset>}
    </fieldset>}
    {!!unavailable.length&&<p role="alert" className="export-unavailable">以下轨道不支持 B站原始 JSON，将不导出该组合：{unavailable.map(e=>e.title).join('、')}。其他已选有效格式仍会导出。</p>}
    {selection.length>100&&<p role="alert">每次最多导出 100 个资料与格式组合，请减少选择。</p>}
    </div></div><footer className="export-footer"><div className="export-download-options"><strong>已选 {picks.length} 项</strong><fieldset disabled={busy} className="export-modes" aria-label="下载方式"><label className={mode==='files'?'chosen':''}><input type="radio" name="export-mode" aria-label="分别下载" checked={mode==='files'} onChange={()=>setMode('files')}/>分别下载</label><label className={mode==='zip'?'chosen':''}><input type="radio" name="export-mode" aria-label="合并打包" checked={mode==='zip'} onChange={()=>setMode('zip')}/>合并打包</label></fieldset></div>
    <div className="export-actions"><small>{!!picks.length&&`预计 ${expectedFiles} 个文件${mode==='zip'&&expectedFiles>1?' · 1 个 ZIP':''}`}</small>{busy?<button data-export-cancel onClick={()=>controller.current?.abort()}>取消后续下载</button>:close&&<button onClick={close}>关闭导出</button>}<button className="export-primary" disabled={busy||loading||!selection.length||selection.length>100} onClick={()=>void start()}>{busy?'正在导出…':'开始导出'}</button></div>
    {!!status.length&&<ul role="status" className="export-results">{status.map((s,i)=><li key={i}>{s}</li>)}</ul>}</footer>
  </section>;
}
export function DocumentExportDialog(props:Props&{close:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog aria-label="导出资料" className="document-export-dialog" ref={ref} onCancel={e=>{e.preventDefault();const cancel=ref.current?.querySelector<HTMLButtonElement>('[data-export-cancel]');if(cancel)cancel.click();else props.close();}}><DocumentExport {...props}/></dialog>;
}
