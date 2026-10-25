import {outputLimits} from '../contracts/output-limits';
import {DocumentExportDialog} from '../library/DocumentExport';
import {locateSaved} from '../library/locate-saved';
import {AttachmentImages} from './Attachments';
import {TimedMarkdown} from './TimedMarkdown';
import {WebSources} from './WebSources';
import Markdown from 'react-markdown';
import { useEffect, useRef, useState } from 'react';
import { ApplicationError } from '../contracts/application';
import type { MarkdownArtifact } from '../contracts/artifact';
import type { ArtifactViewerProps, ModuleProps } from '../app/modules';

export function MarkdownContent({content,seek}:{content:string;seek?:(time:number)=>void}){return <article className="markdown-body"><TimedMarkdown content={content} seek={seek}/></article>;}

// Same content renderer, separate capabilities. Readers never receive an editor.
export function ReadonlyMarkdownViewer({ note,seek }: { note: MarkdownArtifact;seek?:(time:number)=>void }) {
  return <><MarkdownContent content={note.content} seek={seek}/> <WebSources evidence={note.webEvidence}/></>;
}
export function MarkdownArtifactViewer({ client, workspaceId, artifactId, mode }: ArtifactViewerProps) {
  return <MarkdownWorkbench client={client} view={{ mode, workspaceId, chatId: null, title: 'Markdown 笔记', draft: null }} artifactId={artifactId}/>;
}

export function MarkdownWorkbench({ client, view, artifactId, registerLeaveGuard, onSourceChat, onChromeChange }: ModuleProps) {
  const [exportOpen,setExportOpen]=useState(false);
  const [workspaceId, setWorkspaceId] = useState(view.workspaceId);
  const [notes, setNotes] = useState<MarkdownArtifact[]>([]), [selected, setSelected] = useState<string | undefined>(artifactId);
  const [edit, setEdit] = useState<{ note: MarkdownArtifact; text: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState<((allowed: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = !!edit && edit.text !== edit.note.content;
  const retained = workspaceId !== view.workspaceId;
  const note = selected ? notes.find(note => note.id === selected) : notes[0];
  const seek=(time:number)=>{if(note)void locateSaved(client,{workspaceId:note.workspaceId,entityType:'markdown',id:note.id},time,setError);};
  async function save() {
    if (!edit || !client.artifacts || busy) return false;
    setBusy(true); setError('');
    try {
      const saved = (await client.artifacts({ type: 'artifact.save', workspaceId: edit.note.workspaceId, artifactId: edit.note.id, expectedRevision: edit.note.revision, content: edit.text })).artifacts[0];
      setNotes(rows => rows.map(row => row.id === saved.id ? saved : row)); setEdit(null); return true;
    } catch (error) { setError(error instanceof ApplicationError && error.code === 'revision-conflict' ? '另一窗口已保存新版本，请保留当前文字，取消编辑后重新打开。' : '笔记保存失败，当前修改仍保留。'); return false; }
    finally { setBusy(false); }
  }
  async function leave() {
    if (busy) return false;
    if (!dirty) { setEdit(null); return true; }
    return new Promise<boolean>(resolve => { setPending(() => resolve); });
  }
  useEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [dirty, busy, edit]);
  useEffect(() => { if (pending) dialog.current?.showModal(); }, [pending]);
  function resolveLeave(allowed: boolean) { if (allowed) setEdit(null); pending?.(allowed); setPending(null); }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (view.workspaceId === workspaceId) return;
    let disposed = false;
    void leave().then(allowed => { if (!disposed && allowed) { setWorkspaceId(view.workspaceId); setSelected(undefined); } });
    return () => { disposed = true; };
  }, [view.workspaceId]);
  useEffect(() => {
    if (!workspaceId || !client.artifacts) { setNotes([]); return; }
    let disposed = false, sequence = 0;
    const refresh = async () => {
      const token = ++sequence;
      try {
        const result = await client.artifacts!({ type: 'artifact.query', workspaceId, ...(view.mode === 'readonly' && artifactId ? { artifactId } : {}) });
        if (!disposed && token === sequence) setNotes(result.artifacts);
      } catch { if (!disposed) { setNotes([]); setError('笔记读取失败，请重新打开。'); } }
    };
    const dispose = client.subscribe(() => void refresh(), state => { if (state === 'connected') void refresh(); });
    void refresh();
    return () => { disposed = true; dispose(); };
  }, [client, workspaceId, view.mode, artifactId]);
  useEffect(() => {
    if (artifactId && artifactId !== selected) void leave().then(allowed => { if (allowed) setSelected(artifactId); });
  }, [artifactId]);
  useEffect(() => {
    onChromeChange?.({
      title: note?.title,
      status: busy ? '正在保存' : edit ? '编辑中' : '已保存',
      items: notes.map(item => ({ id: item.id, title: item.title, select: () => { void leave().then(allowed => { if (allowed) setSelected(item.id); }); } })),
      actions: [...(view.mode === 'readonly' ? [] : [{ label: edit ? '完成编辑' : '编辑', disabled: busy || !note || note.sourceDeleted, active: !!edit, run: () => { if (edit) void save(); else if (note) { setEdit({ note, text: note.content }); setError(''); } } }]),{label:'导出',disabled:!note,run:()=>setExportOpen(true)}]
    });
  }, [onChromeChange, note, notes, edit, busy, view.mode]);
  return <section className="markdown-workbench" aria-label="Markdown 笔记">
    {exportOpen&&note&&<DocumentExportDialog client={client} entities={[{workspaceId:note.workspaceId,entityType:'markdown',id:note.id,title:note.title}]} close={()=>setExportOpen(false)}/>}
    {retained && <p className="note-meta">已保留原视频的笔记编辑。<button onClick={() => void leave().then(allowed => { if (allowed) { setWorkspaceId(view.workspaceId); setSelected(undefined); } })}>转到当前视频笔记</button></p>}
    {notes.length ? <>
      {!onChromeChange && view.mode !== 'readonly' && <label className="note-picker">已保存笔记<select aria-label="已保存笔记" value={note?.id ?? ''} disabled={busy} onChange={event => { const id = event.target.value; void leave().then(allowed => { if (allowed) setSelected(id); }); }}>{notes.map(note => <option value={note.id} key={note.id}>{note.title}</option>)}</select></label>}
      {selected && !note && <p role="status">所选笔记已不可用，请明确选择其他资料。</p>}
      {note && <><div className="note-actions">{onChromeChange && edit && <button disabled={busy} onClick={() => setEdit(null)}>取消编辑</button>}<strong hidden={!!onChromeChange}>{note.title}</strong>{!onChromeChange&&<button onClick={()=>setExportOpen(true)}>导出笔记</button>}{!onChromeChange && view.mode !== 'readonly' && (edit ? <><button disabled={busy || note.sourceDeleted} onClick={() => void save()}>保存笔记</button><button disabled={busy} onClick={() => setEdit(null)}>取消编辑</button></> : !note.sourceDeleted && <button onClick={() => { setEdit({ note, text: note.content }); setError(''); }}>编辑笔记</button>)}</div>
        {view.mode === 'readonly' ? <ReadonlyMarkdownViewer note={note} seek={seek}/> : <>{edit && edit.note.id === note.id && !note.sourceDeleted ? <textarea aria-label="编辑 Markdown" className="note-editor" value={edit.text} disabled={busy} maxLength={outputLimits.markdownChars} onChange={event => setEdit({ ...edit, text: event.target.value })}/> : <><MarkdownContent content={note.content} seek={seek}/><WebSources evidence={note.webEvidence}/></>}</>}
      </>}
    </> : <div className="empty-state"><h1>暂无笔记</h1><p>在问答中选择「笔记」生成，完成后主动打开。</p></div>}
    {note?.attachmentIds?.length?<section aria-label="笔记来源截图"><p className="note-meta">本笔记请求的来源截图</p><AttachmentImages client={client} target={{workspaceId:note.workspaceId,chatId:note.sourceChatId}} ids={note.attachmentIds} historyOnly/></section>:null}
    {error && <p role="alert">{error}</p>}
    {pending && <dialog ref={dialog} onCancel={event => { event.preventDefault(); resolveLeave(false); }}><h2>笔记尚未保存</h2><p>离开前保存修改，或放弃此次编辑。</p><button disabled={busy} onClick={() => void save().then(saved => { if (saved) resolveLeave(true); })}>保存并离开</button><button disabled={busy} onClick={() => resolveLeave(true)}>放弃修改</button><button disabled={busy} onClick={() => resolveLeave(false)}>取消离开</button></dialog>}
  </section>;
}
