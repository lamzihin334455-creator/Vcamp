import { useEffect, useRef, useState } from 'react';
import { ApplicationError, type ApplicationClient } from '../contracts/application';
import type { LibraryTarget, LibraryView } from '../contracts/library';
import { libraryError } from './Library';
import type { CacheKind } from '../contracts/cache';
import { BackupTools } from './Backup';
import { Trash2 } from 'lucide-react';

export function DeleteButton({ client, target, label = '删除', iconOnly = false, onDeleted, beforeDelete }: { client: ApplicationClient; target: LibraryTarget; label?: string; iconOnly?: boolean; onDeleted?: () => void; beforeDelete?: () => Promise<boolean> }) {
  const [preview, setPreview] = useState<LibraryView['deletePreview']>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (preview) dialog.current?.showModal(); }, [preview]);
  async function prepare() {
    if (!client.library || busy || beforeDelete && !await beforeDelete()) return;
    setBusy(true); setError('');
    try { setPreview((await client.library({ type: 'library.trash.preview', target })).deletePreview); }
    catch (reason) { setError(libraryError(reason)); } finally { setBusy(false); }
  }
  async function commit() {
    if (!preview || !client.library || busy) return;
    setBusy(true); setError('');
    try { await client.library({ type: 'library.trash.move', target: preview.target, expectedRevision: preview.revision }); setPreview(undefined); onDeleted?.(); }
    catch (reason) { setError(libraryError(reason)); } finally { setBusy(false); }
  }
  const impact = target.entityType === 'chat' ? '将停止此对话的运行和排队任务。同空间字幕任务继续。保留草稿、消息和已有成果；成果显示来源对话已删除，并只读保留。' : target.entityType === 'workspace' ? '此分 P 的对话和资料将隐藏，停止所有所属对话、字幕任务及排队项。已有成果的历史引用仍保留。' : target.entityType === 'subtitle' ? '此保存版将从查看和主字幕选项中移除。若它是当前主字幕，保留原 ID 并提示失效，请重新选择主字幕。' : '此资料将从列表和引用中移除，旧消息与历史快照保持。';
  return <><button className={iconOnly ? 'library-icon danger' : undefined} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined} disabled={busy || !client.library} onClick={() => void prepare()}>{iconOnly ? <Trash2 aria-hidden="true"/> : label}</button>{error && !preview && <p role="alert">{error}</p>}{preview && <dialog ref={dialog} onCancel={() => setPreview(undefined)} className="management-dialog"><h2>删除</h2><p>{preview.title}</p><p>{impact}</p><p>当前将停止 {preview.activeJobs} 个任务。删除后无法在界面中撤销。</p>{error && <p role="alert">{error}</p>}<div className="library-actions"><button disabled={busy} onClick={() => void commit()}>确认删除</button><button disabled={busy} onClick={() => setPreview(undefined)}>取消</button></div></dialog>}</>;
}

export function StoragePanel({ client, onClose }: { client: ApplicationClient; onClose: () => void }) {
  const [storage, setStorage] = useState<LibraryView['storage']>(), [days, setDays] = useState(30), [types, setTypes] = useState<CacheKind[]>(['video-metadata', 'derived-preview']);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), [confirm, setConfirm] = useState(false);
  useEffect(() => { void client.library!({ type: 'library.storage.query' }).then(value => setStorage(value.storage)).catch(reason => setError(libraryError(reason))); }, [client]);
  useEffect(() => { if (confirm) dialog.current?.showModal(); }, [confirm]);
  function changeSelection() { setStorage(previous => previous && { inventory: previous.inventory }); setError(''); }
  async function preview() {
    setBusy(true); setError('');
    try { setStorage((await client.library!({ type: 'library.storage.preview', selection: { olderThanDays: days, types } })).storage); }
    catch (reason) { setError(libraryError(reason)); } finally { setBusy(false); }
  }
  async function execute() {
    if (!storage?.plan) return;
    setBusy(true); setError('');
    try { setStorage((await client.library!({ type: 'library.storage.execute', planId: storage.plan.planId })).storage); setConfirm(false); }
    catch (reason) { setError(libraryError(reason)); if (reason instanceof ApplicationError && reason.code === 'plan-expired') setStorage(previous => previous && { inventory: previous.inventory }); setConfirm(false); } finally { setBusy(false); }
  }
  const labels: Record<CacheKind, string> = { 'video-metadata': '视频元数据缓存', 'derived-preview': '可重建的派生预览' };
  return <section className="management-panel" aria-label="存储管理"><header className="library-heading"><h2>存储管理</h2><button onClick={onClose}>返回资料库</button></header>
    <section className="storage-tools" aria-label="清理缓存"><div className="storage-section-heading"><h3>清理缓存</h3>{storage && <span>当前 {storage.inventory.count} 项 · {storage.inventory.bytes} 字节</span>}</div>
    <label className="storage-range">未浏览时间<select aria-label="未浏览时间" value={days} disabled={busy} onChange={event => { setDays(Number(event.target.value)); changeSelection(); }}>{[7, 30, 90, 180].map(day => <option value={day} key={day}>超过 {day} 天</option>)}</select></label>
    <fieldset disabled={busy}><legend>缓存类型</legend>{(['video-metadata', 'derived-preview'] as const).map(type => <label className="storage-type" key={type}><input type="checkbox" checked={types.includes(type)} onChange={event => { setTypes(previous => event.target.checked ? [...previous, type] : previous.filter(value => value !== type)); changeSelection(); }}/>{labels[type]}</label>)}</fieldset>
    <button disabled={busy || !types.length} onClick={() => void preview()}>计算清理预览</button>
    {storage?.plan && <div className="storage-preview" role="status"><p>预计释放 {storage.plan.bytes} 字节 · {storage.plan.count} 项 · {storage.plan.videoCount} 个视频</p><button disabled={busy || !storage.plan.count} onClick={() => setConfirm(true)}>清理这些缓存</button></div>}
    {storage?.result && <p role="status">实际释放 {storage.result.bytes} 字节 · 已清理 {storage.result.count} 项 · {storage.result.videoCount} 个视频。学习资料保留。</p>}
    {error && <p role="alert">{error}{storage?.plan && <button disabled={busy} onClick={() => void execute()}>重试原计划</button>}<button disabled={busy || !types.length} onClick={() => void preview()}>重新计算预览</button></p>}
    </section>
    <BackupTools client={client}/>
    {confirm && storage?.plan && <dialog ref={dialog} className="management-dialog" onCancel={() => setConfirm(false)}><h2>确认清理缓存</h2><p>将清理 {storage.plan.count} 项可重建缓存，预计释放 {storage.plan.bytes} 字节，影响 {storage.plan.videoCount} 个视频。</p><p>执行前再次校验收藏、访问和缓存版本；学习资料及历史快照保留。</p><div className="library-actions"><button disabled={busy} onClick={() => void execute()}>确认清理</button><button disabled={busy} onClick={() => setConfirm(false)}>取消</button></div></dialog>}
  </section>;
}
