import { HtmlPages } from '../workbench/HtmlPages';
import { useEffect, useState } from 'react';
import type { ApplicationClient, WorkspaceView } from '../contracts/application';
import type { LibraryEntity, LibraryView } from '../contracts/library';
import { useGeneration } from '../app/use-generation';
import { ChatMessages } from '../workbench/ChatMessages';
import { MarkdownWorkbench } from '../workbench/Markdown';
import { ScribbleWorkbench } from '../workbench/Scribbles';
import { SubtitleWorkbench } from '../workbench/Subtitles';
import { libraryError } from './Library';
import { DocumentExportDialog } from './DocumentExport';
import '../app/styles.css';

export function LibraryReader({ client }: { client: ApplicationClient }) {
  const [exportOpen,setExportOpen]=useState(false);
  const params = new URLSearchParams(location.search), workspaceId = params.get('workspaceId') ?? '';
  const [detail, setDetail] = useState<LibraryView>(), [selected, setSelected] = useState<LibraryEntity>(), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let initial = true, sequence = 0;
    const refresh = async () => {
      const token = ++sequence;
      try {
        const value = await client.library!({ type: 'library.read', workspaceId });
        if (!alive || token !== sequence) return;
        setDetail(value);
        if (initial) {
          initial = false;
          const explicit = [['chat', 'chatId'], ['html', 'knowledgeId'], ['markdown', 'artifactId'], ['scribble', 'scribbleId'], ['subtitle', 'subtitleVersionId']].find(([, key]) => params.has(key));
          const entity = explicit ? value.entities.find(row => row.entityType === explicit[0] && row.id === params.get(explicit[1])) : value.entities.find(row => row.entityType === 'chat' && row.id === value.recentChatId) ?? value.entities.find(row => row.entityType === 'chat');
          if (explicit && !entity) setError('所选资料已删除或不属于此空间。'); else { setSelected(entity); setError(''); }
        } else setSelected(previous => {
          const next = value.entities.find(row => row.entityType === previous?.entityType && row.id === previous.id);
          if (previous && !next) setError('此资料已删除，请返回资料库选择其他资料。');
          return next;
        });
      } catch (reason) { if (alive && token === sequence) { setDetail(undefined); setSelected(undefined); setError(libraryError(reason)); } }
    };
    const dispose = client.subscribe(() => void refresh(), () => {}); void refresh();
    return () => { alive = false; dispose(); };
  }, [client, workspaceId]);
  const chatId = selected?.entityType === 'chat' ? selected.id : null;
  const generation = useGeneration(client, chatId ? { kind: 'chat', workspaceId, chatId } : null);
  const view: WorkspaceView = { mode: 'readonly', workspaceId, chatId, title: detail?.entities.find(row => row.entityType === 'workspace')?.title ?? '只读资料', draft: null, chats: detail?.entities.filter(row => row.entityType === 'chat').map(row => ({ id: row.id, title: row.title })) };
  function choose(entityType: LibraryEntity['entityType'], id?: string) {
    const next = detail?.entities.find(row => row.entityType === entityType && (!id || row.id === id));
    if (!next && id) setError('对象已失效或来源对话已删除。'); else { setSelected(next); setError(''); }
  }
  return <div className="library-reader"><header className="titlebar"><div className="title-copy"><strong>{view.title}</strong><small>固定来源视频 · 只读资料</small></div></header>
    <nav className="library-reader-nav" aria-label="资料模块">{(['chat', 'html', 'markdown', 'scribble', 'subtitle'] as const).filter(type => type !== 'subtitle' || detail?.entities.some(row => row.entityType === 'subtitle')).map(type => <button key={type} aria-pressed={selected?.entityType === type} onClick={() => choose(type)}>{({ chat: '问答', html: 'HTML / 旧知识', markdown: '笔记', scribble: '随笔', subtitle: '已保存 AI 字幕' })[type]}</button>)}</nav>
    {selected && <label className="library-reader-picker">查看资料<select aria-label="查看资料" value={selected.id} onChange={e => choose(selected.entityType, e.target.value)}>{detail?.entities.filter(row => row.entityType === selected.entityType).map(row => <option value={row.id} key={row.id}>{row.title}</option>)}</select></label>}
    {selected?.entityType==='chat'&&<button onClick={()=>setExportOpen(true)}>导出问答</button>}
    {exportOpen&&selected&&<DocumentExportDialog client={client} entities={[selected]} close={()=>setExportOpen(false)}/>}
    {(error || generation.error) && <p role="alert">{error || generation.error}</p>}
    <main className="library-reader-body">{!detail ? <p>{error ? '资料不可用，请到资料库恢复。' : '正在读取固定资料…'}</p> : selected?.entityType === 'chat' ? generation.view?.messages.length ? <div className="chat-thread"><ChatMessages onSeek={time=>void client.library?.({type:'library.locate',target:{workspaceId,entityType:'chat',id:chatId!},time}).catch(reason=>setError(libraryError(reason)))} openKnowledge={id=>choose('html',id)} client={client} target={{workspaceId,chatId:chatId!}} messages={generation.view.messages} openNote={id => choose('markdown', id)} openScribble={id => choose('scribble', id)}/></div> : <p>暂无问答记录。</p> : selected?.entityType === 'html' ? <HtmlPages client={client} view={view} artifactId={selected.id}/> : selected?.entityType === 'markdown' ? <MarkdownWorkbench key={selected.id} client={client} view={view} artifactId={selected.id} onSourceChat={id => choose('chat', id)}/> : selected?.entityType === 'scribble' ? <ScribbleWorkbench key={selected.id} client={client} view={view} scribbleId={selected.id}/> : selected?.entityType === 'subtitle' ? <SubtitleWorkbench key={selected.id} client={client} view={view} subtitleVersionId={selected.id}/> : <p>此模块暂无已保存资料。</p>}</main>
  </div>;
}
