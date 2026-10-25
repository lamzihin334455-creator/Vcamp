import {DocumentExportDialog} from '../library/DocumentExport';
import {locateSaved} from '../library/locate-saved';
import { useEffect, useRef, useState } from 'react';
import { ApplicationError } from '../contracts/application';
import type { Scribble } from '../contracts/scribble';
import type { ModuleProps } from '../app/modules';
import {formatTime} from '../shared/time';

export function ScribbleWorkbench({ client, view, scribbleId, registerLeaveGuard, onChromeChange }: ModuleProps) {
  const [exportOpen,setExportOpen]=useState(false);
  const [workspaceId, setWorkspaceId] = useState(view.workspaceId);
  const [notes, setNotes] = useState<Scribble[]>([]), [selected, setSelected] = useState<string | undefined>(scribbleId);
  const [edit, setEdit] = useState<{ note: Scribble; text: string } | null>(null);
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState<((allowed: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = (!!edit && edit.text !== edit.note.text) || !!newText;
  const retained = workspaceId !== view.workspaceId;
  const note = selected ? notes.find(note => note.id === selected) : notes[0];
  async function save() {
    if (!client.scribbles || busy || (!edit && (!newText.trim() || !workspaceId))) return false;
    setBusy(true); setError('');
    try {
      if (!edit) {
        const result = await client.scribbles({ type: 'scribble.create', workspaceId: workspaceId!, text: newText, time: null });
        setNotes(result.scribbles); setNewText(''); return true;
      }
      const saved = (await client.scribbles({ type: 'scribble.save', workspaceId: edit.note.workspaceId, scribbleId: edit.note.id, expectedRevision: edit.note.revision, text: edit.text })).scribbles.find(row => row.id === edit.note.id)!;
      setNotes(rows => rows.map(row => row.id === saved.id ? saved : row)); setEdit(null); return true;
    } catch (error) { setError(error instanceof ApplicationError && error.code === 'revision-conflict' ? '另一窗口已保存新版本，请保留当前文字，取消编辑后重新打开。' : '随笔保存失败，当前修改仍保留。'); return false; }
    finally { setBusy(false); }
  }
  async function leave() {
    if (busy) return false;
    if (!dirty) { setEdit(null); setNewText(''); return true; }
    return new Promise<boolean>(resolve => { setPending(() => resolve); });
  }
  useEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [dirty, busy, edit, newText, workspaceId]);
  useEffect(() => { if (pending) dialog.current?.showModal(); }, [pending]);
  function resolveLeave(allowed: boolean) { if (allowed) { setEdit(null); setNewText(''); } pending?.(allowed); setPending(null); }
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
    if (!workspaceId || !client.scribbles) { setNotes([]); return; }
    let disposed = false, sequence = 0;
    const refresh = async () => {
      const token = ++sequence;
      try {
        const result = await client.scribbles!({ type: 'scribble.query', workspaceId, ...(view.mode === 'readonly' && scribbleId ? { scribbleId } : {}) });
        if (!disposed && token === sequence) setNotes(result.scribbles);
      } catch { if (!disposed) { setNotes([]); setError('随笔读取失败，请重新打开。'); } }
    };
    const dispose = client.subscribe(() => void refresh(), state => { if (state === 'connected') void refresh(); });
    void refresh();
    return () => { disposed = true; dispose(); };
  }, [client, workspaceId, view.mode, scribbleId]);
  useEffect(() => {
    if (scribbleId && scribbleId !== selected) void leave().then(allowed => { if (allowed) setSelected(scribbleId); });
  }, [scribbleId]);
  useEffect(() => {
    onChromeChange?.({
      title: note?.text.slice(0, 60),
      status: busy ? '正在保存' : edit ? '编辑中' : '已保存',
      items: notes.map(item => ({ id: item.id, title: item.text.slice(0, 60), select: () => { void leave().then(allowed => { if (allowed) {setSelected(item.id);document.getElementById(`scribble-${item.id}`)?.scrollIntoView({block:'center'});} }); } })),
      actions: [{label:'导出',disabled:!notes.length,run:()=>setExportOpen(true)}]
    });
  }, [onChromeChange, note, notes, edit, busy, view.mode]);
  return <section className="markdown-workbench" aria-label="随笔">{!onChromeChange&&<button disabled={!notes.length} onClick={()=>setExportOpen(true)}>导出随笔</button>}
    {exportOpen&&workspaceId&&<DocumentExportDialog client={client} entities={[{workspaceId,entityType:'scribble',id:'*',title:`随笔汇总（${notes.length} 条，按时间顺序）`}]} close={()=>setExportOpen(false)}/>}
    {retained && <p className="note-meta">已保留原视频的随笔编辑。<button onClick={() => void leave().then(allowed => { if (allowed) { setWorkspaceId(view.workspaceId); setSelected(undefined); } })}>转到当前视频随笔</button></p>}
    {view.mode === 'interactive' && !view.chatId && workspaceId && <form onSubmit={event => { event.preventDefault(); void save(); }}><label>空间随笔（无对话）<textarea aria-label="新建空间随笔" value={newText} onChange={e => setNewText(e.target.value)} maxLength={100000} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void save(); } }}/></label><button disabled={busy || !newText.trim()}>保存空间随笔</button></form>}
    {notes.length ? <>
      {!onChromeChange && view.mode !== 'readonly' && <label className="note-picker">已保存随笔<select aria-label="已保存随笔" value={note?.id ?? ''} disabled={busy} onChange={event => { const id = event.target.value; void leave().then(allowed => { if (allowed) setSelected(id); }); }}>{notes.map(note => <option value={note.id} key={note.id}>{note.text.slice(0, 60)}</option>)}</select></label>}
      {selected && !note && <p role="status">所选随笔已不可用，请明确选择其他资料。</p>}
      {notes.map(item=><article className="scribble-block" id={`scribble-${item.id}`} key={item.id}>
        <div className="note-actions">{item.time!==null&&<button onClick={()=>void locateSaved(client,{workspaceId:item.workspaceId,entityType:'scribble',id:item.id},item.time!,setError)}>{formatTime(item.time)}</button>}{item.time===null&&<small>无时间点</small>}
        {view.mode!=='readonly'&&<button disabled={busy} onClick={()=>void leave().then(ok=>{if(ok){setSelected(item.id);setEdit({note:item,text:item.text});}})}>编辑随笔</button>}</div>
        {edit?.note.id===item.id?<><textarea aria-label="编辑随笔" className="note-editor" value={edit.text} disabled={busy} maxLength={100000} onChange={event=>setEdit({...edit,text:event.target.value})}/><button disabled={busy} onClick={()=>void save()}>保存随笔</button><button disabled={busy} onClick={()=>setEdit(null)}>取消编辑</button></>:<p className="scribble-body">{item.text}</p>}
      </article>)}
    </> : <div className="empty-state"><h1>暂无随笔</h1><p>在问答的 @ 菜单选择「写随笔」。无需字幕或模型。</p></div>}
    {error && <p role="alert">{error}</p>}
    {pending && <dialog ref={dialog} onCancel={event => { event.preventDefault(); resolveLeave(false); }}><h2>随笔尚未保存</h2><p>离开前保存修改，或放弃此次编辑。</p><button disabled={busy} onClick={() => void save().then(saved => { if (saved) resolveLeave(true); })}>保存并离开</button><button disabled={busy} onClick={() => resolveLeave(true)}>放弃修改</button><button disabled={busy} onClick={() => resolveLeave(false)}>取消离开</button></dialog>}
  </section>;
}
