import { useCallback, useEffect, useRef, useState } from 'react';
import { ApplicationError, type ApplicationClient, type Draft, type WorkspaceView } from '../contracts/application';
import {createSnapshotRefresh} from './snapshot-refresh';

type LocalDraft = { draft: Draft; revision: number; pending: number; failed: boolean; error: string; queue: Promise<void> };
const draftKey = (view: WorkspaceView | null) => view?.workspaceId && view.chatId ? JSON.stringify([view.workspaceId, view.chatId]) : null;
export function useWorkspace(client: ApplicationClient) {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState('正在连接…');
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const composing = useRef(false);
  const generation = useRef(0);
  const reads=useRef(0),appliedRead=useRef(0);
  const requestRefresh=useRef<(()=>void)|null>(null);
  const current = useRef<WorkspaceView | null>(null);
  const drafts = useRef(new Map<string, LocalDraft>());
  const mounted = useRef(true);
  const display = useCallback((entry?: LocalDraft) => {
    if (!mounted.current) return;
    setDraft(entry?.draft ?? null); setError(entry?.error ?? '');
    setStatus(entry ? entry.pending ? '正在保存…' : entry.failed ? '未保存' : '草稿已保存' : '');
  }, []);
  const accept = useCallback((value: WorkspaceView) => {
    current.current = value; setView(value);
    const key = draftKey(value);
    let entry = key ? drafts.current.get(key) : undefined;
    if (value.draft && key && !entry?.pending && !entry?.failed&&(!entry||value.draft.revision>=entry.revision)) {
      entry = { draft: value.draft, revision: value.draft.revision, pending: 0, failed: false, error: '', queue: Promise.resolve() };
      drafts.current.set(key, entry);
    }
    display(entry);
  }, [display]);
  const refresh = useCallback(async () => {
    if (switchingRef.current || composing.current) return;
    const token = generation.current,read=++reads.current;
    try {
      const value = await client.query();
      if (!mounted.current || token !== generation.current||read<appliedRead.current) return;
      // External navigation cannot wait for an outgoing save acknowledgement.
      // Each write already owns its exact target and cached draft; its late
      // completion only updates the UI if that same target is still displayed.
      // A slow but valid read may apply until a newer read has actually applied.
      // Otherwise periodic recovery would starve all reads slower than its tick.
      appliedRead.current=read;
      accept(value);
    } catch (reason) {
      if (token !== generation.current || !mounted.current||read<appliedRead.current) return;
      if (reason instanceof ApplicationError && reason.code === 'stale-binding') { requestRefresh.current?.();return; }
      setError('暂时无法读取资料，正在重新核对。');
    }
  }, [client, accept]);
  useEffect(() => {
    mounted.current = true;
    const snapshots=createSnapshotRefresh(refresh);
    requestRefresh.current=snapshots.request;
    const dispose = client.subscribe(snapshots.request, state => { if (mounted.current && state !== 'connected') setStatus('连接恢复中…'); });
    return () => { mounted.current = false; generation.current++;requestRefresh.current=null;snapshots.dispose();dispose(); };
  }, [client, refresh]);
  function change(next: Draft) {
    const targetView = current.current;
    if (!targetView?.workspaceId || !targetView.chatId) return;
    const id = draftKey(targetView)!;
    const entry = drafts.current.get(id);
    if (!entry) return;
    entry.draft = next; generation.current++; display(entry);
    if (entry.failed) return;
    entry.pending++; display(entry);
    entry.queue = entry.queue.then(async () => {
      if (entry.failed) return;
      try {
        const saved = await client.command({ type: 'draft.save', target: { workspaceId: targetView.workspaceId!, chatId: targetView.chatId! }, expectedRevision: entry.revision, draft: next });
        entry.revision = saved.draft!.revision;
        if (mounted.current && draftKey(current.current) === id) {
          current.current = { ...saved, video: current.current?.video }; setView(current.current);
        }
      } catch (reason) {
        entry.failed = true;
        entry.error = reason instanceof ApplicationError && reason.code === 'revision-conflict'
          ? '另一窗口已保存新草稿。当前输入仍保留，请复制后重新载入。'
          : '草稿未保存，当前输入仍保留。请重试。';
      }
    }).finally(() => {
      entry.pending--;
      if (mounted.current && draftKey(current.current) === id) display(entry);
      if (!entry.pending && !entry.failed && mounted.current && !switchingRef.current) void refresh();
    });
  }
  async function flush() {
    const key = draftKey(current.current);
    const entry = key ? drafts.current.get(key) : undefined;
    await entry?.queue; return !entry?.failed;
  }
  async function setWebPreference(enabled:boolean, preferences:NonNullable<ApplicationClient['webPreferences']>) {
    if(switchingRef.current)throw new ApplicationError('revision-conflict');
    switchingRef.current=true;setSwitching(true);generation.current++;
    let previous:boolean|undefined;
    try {
      if(!await flush())throw new ApplicationError('revision-conflict');
      previous=await preferences.read();
      await preferences.write(enabled);
      const target=current.current,id=draftKey(target),entry=id?drafts.current.get(id):undefined;
      if(target?.workspaceId&&target.chatId&&entry&&id){
        const saved=await client.command({type:'draft.save',target:{workspaceId:target.workspaceId,chatId:target.chatId},expectedRevision:entry.revision,draft:{...entry.draft,webEnabled:enabled}});
        drafts.current.delete(id);accept(saved);
      }
    } catch(reason) {
      if(previous!==undefined)await preferences.write(previous).catch(()=>{});
      throw reason;
    } finally {switchingRef.current=false;setSwitching(false);void refresh();}
  }
  function retry() {
    const key = draftKey(current.current);
    const entry = key ? drafts.current.get(key) : undefined;
    if (!entry) { void refresh(); return; }
    if (entry.error.includes('另一窗口')) return;
    entry.failed = false; entry.error = ''; change(entry.draft);
  }
  async function reload() {
    const id = draftKey(current.current);
    if (id) { await drafts.current.get(id)?.queue; drafts.current.delete(id); }
    await refresh();
  }
  // Submission briefly locks this composer, not the generation lifetime. Clear
  // the cache only after S2 accepted/cleared the exact saved draft revision.
  async function submit(send: (view: WorkspaceView) => Promise<boolean>, mode: 'generation' | 'scribble' = 'generation') {
    const target = current.current;
    if (!target?.workspaceId || !target.chatId || switchingRef.current) return false;
    const id = draftKey(target)!;
    switchingRef.current = true; setSwitching(true); generation.current++;
    try {
      if (!await flush()) return false;
      const saved = current.current;
      if (!saved || draftKey(saved) !== id || !await send(saved)) return false;
      drafts.current.delete(id);
      if (saved.draft) {
        const { scribble: _overlay, knowledgeFollowup: _followup, ...original } = saved.draft;
        accept({ ...saved, draft: mode === 'scribble' || saved.draft.knowledgeFollowup ? { ...original, revision: original.revision + 1 } : { ...original, revision: original.revision + 1, text: '', outputType: 'chat', template: null, referenceIds: [], attachmentIds: [], references: [], attachments: [] } });
      }
      // The send acknowledgement already confirms the exact draft was consumed.
      // Release the composer before reading live video state: a slow read must
      // not keep pendingSend alive or suppress incoming workspace invalidations.
      // The refresh in finally reconciles this accepted projection after unlock.
      return true;
    } finally {
      switchingRef.current = false; setSwitching(false); void refresh();
    }
  }
  async function selectChat(chatId?: string) {
    const target = current.current;
    if (!target?.workspaceId || switchingRef.current) return false;
    switchingRef.current = true; setSwitching(true); generation.current++;
    let refreshAfter = false;
    try {
      if (!await flush()) return false;
      const value = await client.command(chatId
        ? { type: 'chat.select', workspaceId: target.workspaceId, chatId }
        : { type: 'chat.create', workspaceId: target.workspaceId });
      if (!mounted.current) return false;
      generation.current++; accept(value);
      refreshAfter = true;
      return true;
    } catch (reason) {
      refreshAfter = reason instanceof ApplicationError && reason.code === 'stale-binding';
      if (mounted.current) setError(reason instanceof ApplicationError && reason.code === 'stale-binding'
        ? '视频已切换，请重新读取当前空间后再选对话。' : '暂时无法切换对话，当前输入仍保留。请重试。');
      return false;
    } finally {
      switchingRef.current = false;
      if (mounted.current) { setSwitching(false); if (refreshAfter) void refresh(); }
    }
  }
  function downloadRecovery() {
    const entries = [...drafts.current].filter(([, entry]) => entry.failed || entry.pending);
    const blob = new Blob([JSON.stringify(entries.map(([key, entry]) => {
      const [workspaceId, chatId] = JSON.parse(key) as [string, string];
      return { target: { workspaceId, chatId }, expectedRevision: entry.revision, draft: { ...entry.draft, revision: entry.revision } };
    }), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'vcamp-unsaved-drafts.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const hasRecovery = [...drafts.current.values()].some(entry => entry.failed);
  function composition(active: boolean) {
    composing.current = active; generation.current++;
    if (!active) void refresh();
  }
  return { refresh, view, draft, change, status, error, flush, retry, reload, selectChat, switching, downloadRecovery, hasRecovery, composition, submit, setWebPreference };
}
