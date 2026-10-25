import {isNativeTrackId} from '../video/native-tracks';
import {DocumentExportDialog} from './DocumentExport';
import {formatTime} from '../shared/time';
import {DeleteButton,StoragePanel} from './Management';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ApplicationError} from '../contracts/application';
import {DEFAULT_LIBRARY_FOLDER_ID,type LibraryCommand,type LibraryTarget,type LibraryView} from '../contracts/library';
import type {ModuleProps} from '../app/modules';
import './library.css';
import {Check,ChevronLeft,Clock3,Folder,FolderPlus,HardDrive,MoreVertical,Plus,Search,Star,Trash2} from 'lucide-react';
import {VideoCover} from './VideoCover';

export const libraryError=(reason:unknown)=>reason instanceof ApplicationError?({'parent-deleted':'所属工作空间已删除，请选择其他资料。','plan-expired':'预览已过期或数据已变化，请重新计算。','revision-conflict':'对象已变化，请重新预览后确认。','not-found':'对象已失效或暂不可用，请重新读取。',forbidden:'此对象受保护或不属于所选空间，无法操作。','permission-denied':'请在浏览器扩展管理中恢复 B 站访问，再打开视频。','stale-binding':'视频与所选分 P 不一致，已停止定位。','read-failed':'视频加载、鉴权或定位失败，请检查网页后重试。'}[reason.code as string]??`操作未完成（${reason.code}），请重试。`):'读取失败，请重试。';

const folderColors=['#218fc2','#2fa879','#f0a33a','#e55c68','#8a4de0','#5f63da','#8a9299','#62666b'];
type Scope={kind:'recent'}|{kind:'folders'}|{kind:'folder';id:string};
type FolderForm={id?:string;revision?:number;name:string;color:string};

export function LibraryWorkbench({client,onVideoOpen,view:workspace}:ModuleProps){
  const [exportOpen,setExportOpen]=useState(false),[view,setView]=useState<LibraryView>(),[search,setSearch]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [selectedParts,setSelectedParts]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[detail,setDetail]=useState<LibraryView>(),[detailSpace,setDetailSpace]=useState<string>();
  const [scope,setScope]=useState<Scope>({kind:'recent'}),[favoriteTarget,setFavoriteTarget]=useState<LibraryTarget>(),[folderForm,setFolderForm]=useState<FolderForm>();
  const [management,setManagement]=useState<'storage'>(),[menuVideo,setMenuVideo]=useState<string>(),[menuFolder,setMenuFolder]=useState<string>();
  const [pendingPart,setPendingPart]=useState<{videoId:string;action:'video'|'contents'|'favorite'|'default-favorite'}>(),[detailError,setDetailError]=useState('');
  const sequence=useRef(0),detailSequence=useRef(0),partSelectors=useRef<Record<string,HTMLSelectElement|null>>({});
  const [uiReady,setUiReady]=useState(false);
  useEffect(()=>{let alive=true;void (client.libraryUiPreferences?.read()??Promise.resolve(undefined)).then(value=>{if(alive){if(value){setScope(value.scope);setSelectedParts(value.selectedParts);}setUiReady(true);}},()=>{if(alive)setUiReady(true);});return()=>{alive=false;};},[client]);
  useEffect(()=>{let alive=true;const dispose=client.subscribePreferences?.(keys=>{if(keys.includes('vcamp.libraryState'))void client.libraryUiPreferences?.read().then(value=>{if(alive&&value){setScope(current=>JSON.stringify(current)===JSON.stringify(value.scope)?current:value.scope);setSelectedParts(current=>JSON.stringify(current)===JSON.stringify(value.selectedParts)?current:value.selectedParts);}}).catch(()=>{});});return()=>{alive=false;dispose?.();};},[client]);
  useEffect(()=>{if(uiReady)void client.libraryUiPreferences?.write({scope,selectedParts}).catch(()=>{});},[client,uiReady,scope,selectedParts]);
  const folderId=scope.kind==='folder'?scope.id:undefined;
  async function refresh(requestedFolder=folderId){
    if(!client.library){setError('资料库接口尚不可用。');setLoading(false);return;}
    const token=++sequence.current;setLoading(true);
    try{const value=await client.library({type:'library.query',search,...(requestedFolder?{folderId:requestedFolder}:{})});if(token===sequence.current){setView(value);setError('');}}
    catch(reason){if(token===sequence.current)setError(libraryError(reason));}
    finally{if(token===sequence.current)setLoading(false);}
  }
  useEffect(()=>{const dispose=client.subscribe(()=>void refresh(),()=>{});void refresh();return()=>{sequence.current++;dispose();};},[client,search,folderId]);
  useEffect(()=>{const close=()=>{setMenuVideo(undefined);setMenuFolder(undefined);};window.addEventListener('blur',close);return()=>window.removeEventListener('blur',close);},[]);
  async function mutate(op:LibraryCommand){
    if(!client.library||busy)return false;setBusy(true);setError('');
    try{await client.library(op);await refresh(op.type==='library.folder.delete'?undefined:folderId);return true;}
    catch(reason){setError(libraryError(reason));return false;}finally{setBusy(false);}
  }
  async function open(target:LibraryTarget,action:'reader'|'video',time?:number){
    if(!client.library||busy)return;setBusy(true);setError('');
    try{await client.library({type:'library.open',target,action,...(time===undefined?{}:{time})});if(action==='video')onVideoOpen?.();}
    catch(reason){setError(libraryError(reason));}finally{setBusy(false);}
  }
  async function showContents(workspaceId:string){
    const token=++detailSequence.current;setExportOpen(false);setDetailSpace(workspaceId);setDetail(undefined);setDetailError('');
    try{const value=await client.library!({type:'library.read',workspaceId});if(token===detailSequence.current)setDetail(value);}
    catch(reason){if(token===detailSequence.current)setDetailError(libraryError(reason));}
  }
  const targetFor=(workspaceId:string):LibraryTarget=>({workspaceId,entityType:'workspace',id:workspaceId});
  function chosenPart(video:LibraryView['videos'][number]){return video.parts.find(part=>part.workspaceId===selectedParts[video.videoId])??video.parts.find(part=>part.workspaceId===workspace.workspaceId)??video.parts[0];}
  function requirePart(video:LibraryView['videos'][number],action:NonNullable<typeof pendingPart>['action']){
    const selected=chosenPart(video);
    if(!selected){setPendingPart({videoId:video.videoId,action});partSelectors.current[video.videoId]?.focus();return;}
    setPendingPart(undefined);setMenuVideo(undefined);
    const target=targetFor(selected.workspaceId);
    if(action==='video')void open(target,'video');
    else if(action==='contents')void showContents(selected.workspaceId);
    else if(action==='favorite')setFavoriteTarget(target);
    else{
      const added=view?.favorites?.some(row=>row.folderId===DEFAULT_LIBRARY_FOLDER_ID&&sameTarget(row.target,target));
      void mutate({type:added?'library.favorite.remove':'library.favorite.add',folderId:DEFAULT_LIBRARY_FOLDER_ID,target});
    }
  }
  const closeDetail=()=>{detailSequence.current++;setDetailSpace(undefined);setDetail(undefined);setDetailError('');};
  if(management==='storage')return <StoragePanel client={client} onClose={()=>setManagement(undefined)}/>;
  const selectedFolder=scope.kind==='folder'?view?.folders?.find(folder=>folder.id===scope.id):undefined;
  return <section className="library-view" aria-label="资料库内容">
    <header className="library-heading"><h1>资料库</h1><button className="library-storage-button" onClick={()=>setManagement('storage')}><HardDrive/>存储管理</button></header>
    {!detailSpace&&<>
      <div className="library-commandbar"><label className="library-search"><Search aria-hidden="true"/><span className="sr-only">搜索视频标题、笔记内容</span><input aria-label="搜索视频标题、笔记内容" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索视频标题、笔记内容…"/></label><nav className="library-mode-tabs" aria-label="资料库视图"><button aria-label="最近" title="最近" aria-current={scope.kind==='recent'?'page':undefined} onClick={()=>setScope({kind:'recent'})}><Clock3/></button><button aria-label="收藏夹" title="收藏夹" aria-current={scope.kind!=='recent'?'page':undefined} onClick={()=>setScope({kind:'folders'})}><Star/></button></nav></div>
      {loading&&<p className={view?'sr-only':undefined} role="status">正在读取资料库…</p>}{error&&<p className="library-alert" role="alert">{error}<button onClick={()=>void refresh()}>重新读取</button></p>}
      {scope.kind==='folders'&&<FolderOverview view={view} busy={busy} menuFolder={menuFolder} setMenuFolder={setMenuFolder} openFolder={id=>setScope({kind:'folder',id})} createFolder={()=>setFolderForm({name:'',color:folderColors[1]})} renameFolder={folder=>setFolderForm({id:folder.id,revision:folder.revision,name:folder.name,color:folder.color??folderColors[1]})} deleteFolder={(id,revision)=>void mutate({type:'library.folder.delete',folderId:id,expectedRevision:revision})}/>}
      {(scope.kind==='recent'||scope.kind==='folder')&&<><div className="library-section-heading">{scope.kind==='folder'?<><button className="library-back" aria-label="返回收藏夹" onClick={()=>setScope({kind:'folders'})}><ChevronLeft/></button><div><h2>{selectedFolder?.name??'收藏夹'}</h2><small>{view?.favorites?.length??0} 条收藏</small></div></>:<><h2>最近</h2><small>{view?.videos.length??0} 个视频</small></>}</div>
        {!loading&&!view?.videos.length&&<p className="library-empty">{search?'没有匹配的资料。':scope.kind==='folder'?'这个文件夹还是空的。':'尚无已保存资料。生成问答、笔记、交互页面、增强或翻译字幕，或写下随笔后，视频会显示在这里。'}</p>}
        <div className="library-video-grid">{view?.videos.map(video=>{
          const selected=chosenPart(video),target=selected&&targetFor(selected.workspaceId),favorite=target&&view.favorites?.some(row=>row.folderId===DEFAULT_LIBRARY_FOLDER_ID&&sameTarget(row.target,target)),multiple=video.parts.length>1||(video.parts[0]?.partCount??1)>1;
          return <article className="library-video-card" key={`${video.platform}:${video.videoId}`}><VideoCover imageUrl={video.coverUrl} title={video.title} disabled={busy||!selected} open={()=>requirePart(video,'video')}/><div className="library-video-copy"><div className="library-video-title"><h3 title={video.title}>{video.title}</h3><button className="library-more" aria-label={`${video.title} 更多操作`} aria-expanded={menuVideo===video.videoId} onClick={event=>{event.stopPropagation();setMenuVideo(value=>value===video.videoId?undefined:video.videoId);setMenuFolder(undefined);}}><MoreVertical/></button>{menuVideo===video.videoId&&<div className="library-popover library-video-menu" role="menu" onClick={event=>event.stopPropagation()}><button role="menuitem" onClick={()=>requirePart(video,'default-favorite')}><Star fill={favorite?'currentColor':'none'}/>{favorite?'取消收藏':'收藏'}</button><button role="menuitem" onClick={()=>requirePart(video,'favorite')}><FolderPlus/>添加到文件夹</button>{selected?<DeleteButton client={client} target={targetFor(selected.workspaceId)} label="删除" onDeleted={()=>{setMenuVideo(undefined);void refresh();}}/>:<button disabled><Trash2/>删除</button>}</div>}</div>{multiple?<label className="library-part-choice"><span className="sr-only">{video.title} 选择分 P</span><select ref={element=>{partSelectors.current[video.videoId]=element;}} aria-label={`${video.title} 选择分 P`} value={selected?.workspaceId??''} onChange={event=>setSelectedParts(value=>({...value,[video.videoId]:event.target.value}))}>{video.parts.map(part=><option key={part.workspaceId} value={part.workspaceId}>{part.pageNumber?`P${part.pageNumber} · `:''}{part.title}</option>)}</select></label>:<p className="library-video-meta">B站 · {recentLabel(selected?.recentAt)}</p>}{pendingPart?.videoId===video.videoId&&<small role="status">请先选择一个已保存分 P</small>}</div>
          </article>;
        })}</div></>}
    </>}
    {favoriteTarget&&<FavoritePicker view={view} target={favoriteTarget} busy={busy} close={()=>setFavoriteTarget(undefined)} toggle={(id,added)=>void mutate({type:added?'library.favorite.remove':'library.favorite.add',folderId:id,target:favoriteTarget})} create={()=>setFolderForm({name:'',color:folderColors[1]})}/>}
    {folderForm&&<FolderDialog form={folderForm} busy={busy} change={setFolderForm} close={()=>setFolderForm(undefined)} save={()=>void mutate(folderForm.id?{type:'library.folder.rename',folderId:folderForm.id,expectedRevision:folderForm.revision!,name:folderForm.name}:{type:'library.folder.create',name:folderForm.name,color:folderForm.color}).then(saved=>{if(saved)setFolderForm(undefined);})}/>}
    {detailSpace&&<section className="library-detail" aria-label="空间资料"><header className="library-heading"><h2>资料列表</h2><button onClick={closeDetail}>返回资料库</button></header>{detail&&<button onClick={()=>setExportOpen(true)}>导出资料</button>}{detail&&exportOpen&&<DocumentExportDialog close={()=>setExportOpen(false)} client={client} workspaceId={detailSpace}/>} {detailError?<p role="alert">{detailError}<button onClick={()=>void showContents(detailSpace)}>重新读取资料</button></p>:!detail?<p role="status">正在读取…</p>:<>{!detail.entities.some(row=>row.entityType!=='workspace')&&<p>暂无已保存资料。</p>}{detail.entities.filter(row=>row.entityType!=='workspace').map(entity=>{const target:LibraryTarget={workspaceId:entity.workspaceId,entityType:entity.entityType,id:entity.id};return <div className="library-object" key={`${entity.entityType}:${entity.id}`}><span>{({chat:'问答',markdown:'笔记',html:'HTML',scribble:'随笔',subtitle:'字幕',workspace:'空间'})[entity.entityType]} · {entity.title}</span><div className="library-actions"><button disabled={busy||isNativeTrackId(entity.id)} onClick={()=>void open(target,'reader')}>打开</button>{!isNativeTrackId(entity.id)&&<><button onClick={()=>setFavoriteTarget(target)}>收藏资料</button><DeleteButton client={client} target={target} onDeleted={()=>void showContents(entity.workspaceId)}/></>}{entity.time!==undefined&&<button disabled={busy} onClick={()=>void open(target,'video',entity.time)}>从 {formatTime(entity.time)} 打开视频</button>}</div></div>;})}</>}</section>}
  </section>;
}

function sameTarget(a:LibraryTarget,b:LibraryTarget){return a.workspaceId===b.workspaceId&&a.entityType===b.entityType&&a.id===b.id;}
function recentLabel(value?:number){
  if(!value)return '最近使用';
  const date=new Date(value),today=new Date();
  const time=`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  if(date.toDateString()===today.toDateString())return `今天 ${time}`;
  return `${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${time}`;
}

function FolderOverview({view,busy,menuFolder,setMenuFolder,openFolder,createFolder,renameFolder,deleteFolder}:{view?:LibraryView;busy:boolean;menuFolder?:string;setMenuFolder:(id?:string)=>void;openFolder:(id:string)=>void;createFolder:()=>void;renameFolder:(folder:NonNullable<LibraryView['folders']>[number])=>void;deleteFolder:(id:string,revision:number)=>void}){
  return <><div className="library-section-heading"><h2>收藏夹</h2><small>{view?.folders?.length??0} 个文件夹</small></div><div className="library-folder-grid">{view?.folders?.map(folder=>{const count=view.favorites?.filter(row=>row.folderId===folder.id).length??0,isDefault=folder.id===DEFAULT_LIBRARY_FOLDER_ID;return <article className="library-folder-card" key={folder.id} style={{'--folder-color':folder.color??'var(--accent)'} as CSSProperties}><button className="library-folder-open" disabled={busy} onClick={()=>openFolder(folder.id)}><Folder fill="currentColor"/><strong>{folder.name}</strong><small>{count} 条</small></button><button className="library-more" aria-label={`${folder.name} 更多操作`} aria-expanded={menuFolder===folder.id} onClick={()=>setMenuFolder(menuFolder===folder.id?undefined:folder.id)}><MoreVertical/></button>{menuFolder===folder.id&&<div className="library-popover library-folder-menu">{isDefault?<p>默认文件夹不可重命名或删除</p>:<><button onClick={()=>{setMenuFolder(undefined);renameFolder(folder);}}>重命名</button><button className="danger" onClick={()=>{setMenuFolder(undefined);deleteFolder(folder.id,folder.revision);}}><Trash2/>删除文件夹</button></>}</div>}</article>;})}<button className="library-folder-create" onClick={createFolder}><span><Plus/></span><strong>新建文件夹</strong></button></div></>;
}

function FavoritePicker({view,target,busy,close,toggle,create}:{view?:LibraryView;target:LibraryTarget;busy:boolean;close:()=>void;toggle:(folderId:string,added:boolean)=>void;create:()=>void}){
  const [search,setSearch]=useState(''),folders=view?.folders?.filter(folder=>folder.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="library-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}><section className="library-picker" role="dialog" aria-modal="true" aria-label="添加到文件夹"><header><h2>添加到文件夹</h2><button aria-label="关闭" onClick={close}>×</button></header><label><Search/><input aria-label="搜索文件夹" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索或新建文件夹…"/></label><div>{folders?.map(folder=>{const added=Boolean(view?.favorites?.some(row=>row.folderId===folder.id&&sameTarget(row.target,target)));return <button key={folder.id} aria-pressed={added} disabled={busy} onClick={()=>toggle(folder.id,added)}><Folder/><span>{folder.name}</span>{added&&<Check/>}</button>;})}{!folders?.length&&<p>没有匹配的文件夹</p>}</div><button className="library-create-inline" onClick={create}><Plus/>新建文件夹</button></section></div>;
}

function FolderDialog({form,busy,change,close,save}:{form:FolderForm;busy:boolean;change:(value:FolderForm)=>void;close:()=>void;save:()=>void}){
  return <div className="library-overlay" role="presentation"><form className="library-folder-dialog" role="dialog" aria-modal="true" aria-label={form.id?'重命名文件夹':'新建文件夹'} onSubmit={event=>{event.preventDefault();save();}}><header><h2>{form.id?'重命名文件夹':'新建文件夹'}</h2><button type="button" aria-label="关闭" onClick={close}>×</button></header><div className="library-folder-fields"><Folder style={{color:form.color}} fill="currentColor"/><label><span className="sr-only">文件夹名称</span><input autoFocus aria-label="文件夹名称" maxLength={20} value={form.name} onChange={event=>change({...form,name:event.target.value})} placeholder="输入文件夹名称"/><small>{form.name.length}/20</small></label></div>{!form.id&&<div className="library-color-options" aria-label="文件夹颜色">{folderColors.map(color=><button key={color} type="button" aria-label={`选择颜色 ${color}`} aria-pressed={form.color===color} style={{background:color}} onClick={()=>change({...form,color})}/>)}</div>}<footer><button type="submit" className="primary" disabled={busy||!form.name.trim()}>{form.id?'保存':'创建'}</button><button type="button" disabled={busy} onClick={close}>取消</button></footer></form></div>;
}
