import { useCallback, useEffect, useRef, useState } from 'react';
import { ApplicationError, type ApplicationClient } from '../contracts/application';
import { terminal, type GenerationCommand, type GenerationView, type JobView, type RequestTarget } from '../contracts/generation';
import {createSnapshotRefresh} from './snapshot-refresh';

// Every invalidation reads an atomic text/state/seq snapshot. Thus duplicates,
// skipped events and completion in the ack/query window all reconcile through
// the same path, without needing an event log or replaying deltas twice.
export function reconcileGeneration(previous: GenerationView | null, next: GenerationView): GenerationView {
  if (!previous || JSON.stringify(previous.target) !== JSON.stringify(next.target)) return next;
  const jobs = new Map(previous.jobs.map(job => [job.jobId, job]));
  const stale = new Set<string>();
  for (const job of next.jobs) {
    const old = jobs.get(job.jobId);
    if (old && (old.seq > job.seq || (old.seq === job.seq && terminal(old.state) && !terminal(job.state)))) stale.add(job.jobId);
    else jobs.set(job.jobId, job);
  }
  const oldMessages = new Map(previous.messages.map(message => [message.messageId, message]));
  const messages = next.messages.map(message => stale.has(message.jobId) ? oldMessages.get(message.messageId) ?? message : message);
  for (const message of previous.messages) if (stale.has(message.jobId) && !messages.some(item => item.messageId === message.messageId)) messages.push(message);
  return { ...next, jobs: [...jobs.values()], messages };
}
// Streaming can invalidate the same conversation many times per second. Keep
// one atomic snapshot read in flight and collapse the burst into one trailing
// read, otherwise old queries can crowd out the partial answer until stopping.
export function createTrailingRefresh(refresh: () => Promise<void>) {
  let running = false, pending = false;
  return async function requestRefresh() {
    pending = true;
    if (running) return;
    running = true;
    try {
      while (pending) { pending = false; await refresh(); }
    } finally {
      running = false;
      if (pending) void requestRefresh();
    }
  };
}
const errorText: Record<string, string> = {
  'web-disabled':'当前对话已关闭联网。重试这条联网请求前请主动开启顶部联网开关，或关闭联网后重新发送问题。',
  'web-unsupported':'联网需要当前 DeepSeek 服务中的 deepseek-flash 检索能力。请检查配置，或关闭联网后重新发送。',
  'web-tool':'搜索工具未完整执行，未切换为离线回答。', 'web-no-sources':'没有取得可用网页来源，未继续生成。', 'web-protocol':'检索或来源格式不受支持，未冒称联网成功。',
  'html-format':'HTML 页面不完整，请调整需求后重新发送', 'knowledge-format':'交互知识格式无效或不完整，未保存成果。请修改要求或手动重试。', 'legacy-knowledge':'旧自由 HTML 请求不支持执行，请退出旧模板并新建 HTML 页面请求。',
  'task-busy': '此对话已有任务，可以继续写下一份草稿。', 'context-limit': '输入或历史超过本轮处理上限，未截断或发送。请新建对话或缩短输入。',
  'forbidden': '所选笔记已失效或不属于当前对话，请移除该引用后重试。', 'resource-limit': '任务队列已满，请等任务结束后再发送。', 'unsupported-capability': '所选组合能力不可用，请检查模型与图片设置。不会自动更换模型或丢弃图片。',
  'model-unavailable': '原模型或密钥不可用，请检查服务配置。不会自动替换模型。', 'source-changed': '字幕来源已变化，或字幕时间轴与当前视频时长不一致。请重新读取或选择对应的主字幕后发送；重试仍需原来源。',
  'stale-binding': '视频绑定已变化，请重新读取后发送。', 'revision-conflict': '草稿已变化，保留输入并重新读取后发送。',
  'storage-failed': '任务未成功保存，请保留草稿并重试。', disconnected: '连接中断，请等待恢复后查看任务状态。'
};
export const taskLabels: Record<JobView['state'], string> = { queued: '排队中', preparing: '准备中', 'awaiting-permission': '等待权限', running: '生成中', committing: '正在保存', completed: '已完成', stopped: '已停止', failed: '生成失败', interrupted: '任务已中断' };
export const failureLabels: Record<NonNullable<JobView['error']>, string> = { 'web-disabled':'当前对话已关闭联网', 'web-unsupported':'联网检索模型不可用', 'web-tool':'搜索工具未完整执行', 'web-no-sources':'无可用网页来源', 'web-protocol':'检索／来源格式错误', 'html-format':'HTML 页面不完整，请调整需求后重新发送', 'knowledge-format':'交互知识格式无效或不完整，未保存；可修改要求或手动重试', 'legacy-knowledge':'旧 HTML 请求请新建', network: '网络或服务失败', auth: '认证失败', 'request-rejected': '服务拒绝请求', 'rate-limit': '服务限流', 'context-limit': '服务拒绝当前输入长度', protocol: '响应协议不完整', timeout: '请求超时', 'output-limit': '输出达到本轮上限，未标完成', 'executor-lost': '后台执行已中断，请手动重试', 'source-changed': '原字幕已变化', storage: '持久保存失败', 'model-unavailable': '原模型或密钥不可用' };
export function useGeneration(client: ApplicationClient, target: RequestTarget | null, beforeRetry?: () => Promise<boolean>) {
  const [view, setView] = useState<GenerationView | null>(null), [error, setError] = useState('');
  const commandError = useRef(false);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(target), epoch = useRef(0), current = useRef<GenerationView | null>(null);
  const accept = useCallback((value: GenerationView) => { current.current = reconcileGeneration(current.current, value); setView(current.current); }, []);
  useEffect(() => {
    const token = ++epoch.current;
    let sequence=0,applied=0;
    current.current = null; setView(null); commandError.current = false; setError('');
    if (!target || !client.generation) return;
    async function refresh() {
      const read=++sequence;
      try { const value = await client.generation!({ type: 'generation.query', target: target! }); if (epoch.current === token&&read>=applied) { applied=read;accept(value); if (!commandError.current) setError(''); } }
      catch (reason) { if (epoch.current === token&&read===sequence) { if (reason instanceof ApplicationError && reason.code === 'not-found') { current.current = null; setView(null); } if (!commandError.current) setError('任务状态读取失败，正在重新核对。'); } }
    }
    // No pre-ack query. Registration/ack comes from the application client.
    const snapshots = createSnapshotRefresh(refresh,()=>!current.current||current.current.jobs.some(job=>!terminal(job.state)));
    const dispose = client.subscribe(snapshots.request, state => { if (state !== 'connected' && epoch.current === token && !commandError.current) setError('连接恢复中，正在核对后台任务状态。'); });
    return () => { epoch.current++; snapshots.dispose();dispose(); };
  }, [client, key, accept]);
  async function command(op: GenerationCommand) {
    if (!client.generation || busy) return false;
    const token = epoch.current; setBusy(true); commandError.current = false; setError('');
    try {
      if (op.type === 'generation.retry' && beforeRetry && !await beforeRetry()) return false;
      const value = await client.generation(op); if (epoch.current === token) accept(value); return true;
    }
    catch (reason) { if (epoch.current === token) { commandError.current = true; setError(reason instanceof ApplicationError ? errorText[reason.code] ?? '请求失败，请重试。' : '请求失败，请重试。'); } return false; }
    finally { setBusy(false); }
  }
  const visible=view&&JSON.stringify(view.target)===key?view:null;
  return { view:visible, error, busy, command, active: visible?.jobs.some(job => !terminal(job.state)) ?? false };
}
