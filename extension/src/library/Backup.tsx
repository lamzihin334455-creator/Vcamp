import { useEffect, useRef, useState } from 'react';
import { ApplicationError, type ApplicationClient } from '../contracts/application';
import { type BackupPlan } from '../contracts/backup';
import { libraryError } from './Library';
import { createBackupFile, previewBackupFile } from './backup-file';

const labels: Record<string, string> = { attachments:'截图附件（含图像）', workspaces: '视频 / 分 P', chats: '对话及完整草稿', jobs: '请求与任务历史', artifacts: '笔记与交互知识', noteRevisions: '成果历史版本', subtitleVersions: 'AI 字幕保存版', scribbles: '随笔', roles: '角色', roleRevisions: '角色版本', templates: '模板', templateRevisions: '模板版本', styles:'HTML 风格',styleRevisions:'风格版本',preferences:'界面与输出偏好',folders: '收藏文件夹', favorites: '收藏关系', deletedEntries: '历史删除标记', deletionConflicts: '空间或对话删除状态不同' };
const backupError = (reason: unknown) => reason instanceof ApplicationError && reason.code === 'invalid-message' ? '备份格式、版本、校验或来源依赖不完整，无法导入。请使用完整的 Vcamp 备份文件。' : reason instanceof ApplicationError && reason.code === 'unsupported-capability' ? '此备份包含不支持的产物版本，导入已停止，资料未改变。' : reason instanceof ApplicationError && reason.code === 'resource-limit' ? '备份超过容量、资料数量或同时处理数量限制。新格式支持 512 MiB，旧版 JSON 支持 64 MiB；资料不会被截断或删除。' : libraryError(reason);
export function BackupTools({ client }: { client: ApplicationClient }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState(''), [filename, setFilename] = useState(''), [plan, setPlan] = useState<BackupPlan>();
  const selectedFile = useRef<File | undefined>(undefined), sequence = useRef(0), controller = useRef(new AbortController());
  const [progress, setProgress] = useState('');
  useEffect(() => { controller.current = new AbortController(); return () => { controller.current.abort(); }; }, []);
  const fileInput=useRef<HTMLInputElement>(null);
  async function download() {
    setBusy(true); setError(''); setStatus(''); setProgress('正在准备资料备份…');
    try {
      const file = await createBackupFile(client.library!, setProgress, controller.current.signal);
      const url = URL.createObjectURL(file), a = document.createElement('a');
      a.href = url; a.download = `vcamp-backup-${new Date().toISOString().slice(0, 10)}.vcamp`; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); setStatus('备份已交给浏览器下载，请保存文件。');
    } catch (reason) { setError(backupError(reason)); } finally { setBusy(false); }
  }
  async function preview(file = selectedFile.current) {
    if (!file) return;
    const token = ++sequence.current; setBusy(true); setError(''); setStatus(''); setPlan(undefined); setProgress('正在读取备份…');
    try { const plan = await previewBackupFile(file, client.library!, setProgress, controller.current.signal); if (token === sequence.current) setPlan(plan); }
    catch (reason) { if (token === sequence.current) setError(backupError(reason)); }
    finally { if (token === sequence.current) setBusy(false); }
  }
  async function select(file: File | undefined) {
    sequence.current++; setPlan(undefined); selectedFile.current = file; setStatus(''); setError(''); setFilename(file?.name ?? '');
    if (!file) return;
    await preview(file);
  }
  async function execute() {
    if (!plan) return; setBusy(true); setError(''); setProgress('正在恢复资料…');
    try {
      const result = (await client.library!({ type: 'library.backup.execute', planId: plan.planId, checksum: plan.checksum })).backup?.result;
      setStatus(`备份恢复完成：新增 ${result?.added ?? 0} 条资料或关系，跳过 ${result?.skipped ?? 0} 条。冲突保留各自关联。${result?.preferencesRestored===false?'资料已恢复，但偏好未能写入，请重新导入重试。':result?.preferencesRestored?'界面与输出偏好已恢复。':''}`); setPlan(undefined);
    } catch (reason) { setError(backupError(reason)); setPlan(undefined); }
    finally { setBusy(false); }
  }
  return <section className="backup-tools" aria-label="备份与恢复"><h3>备份与恢复</h3>
    <div className="backup-actions"><button disabled={busy} onClick={() => void download()}>下载资料备份</button><button disabled={busy} onClick={()=>fileInput.current?.click()}>导入备份</button></div>
    <input ref={fileInput} hidden aria-label="选择备份文件" type="file" accept=".vcamp,.json,application/json,application/octet-stream" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void select(file); }}/>
    {filename && <p className="backup-filename">{filename}</p>}{busy && <p role="status">{progress || '正在处理，请稍候…'}</p>}
    {plan && <div className="storage-preview" aria-label="导入概览"><h4>恢复概览</h4><details className="backup-details"><summary>资料明细</summary><ul>{Object.entries(plan.counts).filter(([, count]) => count).map(([key, count]) => <li key={key}>{labels[key] ?? key}：{count}</li>)}</ul></details>
      <p>新增 {plan.added} 条 · 相同 {plan.skipped} 条跳过 · 冲突来源组 {plan.conflicts} 个（已有相同副本跳过）。</p>
      {!!plan.counts.preferences&&<p>界面与输出设置将使用备份中的配置。</p>}<div className="backup-actions"><button disabled={busy} onClick={() => void execute()}>确认恢复备份</button><button disabled={busy} onClick={() => { sequence.current++; setPlan(undefined); }}>取消导入</button></div>
    </div>}{error && <p role="alert">{error}</p>}{!plan && selectedFile.current && <button disabled={busy} onClick={() => void preview()}>重新计算导入预览</button>}{status && <p role="status">{status}</p>}
  </section>;
}
