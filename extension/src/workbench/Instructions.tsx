import { useEffect, useRef, useState } from 'react';
import type { ApplicationClient, Draft } from '../contracts/application';
import type { InstructionCall, InstructionView } from '../contracts/instructions';
import type { FixedPromptRule } from '../prompts/fixed-rules';
import { fixedPromptRules, selectFixedRules } from '../prompts/fixed-rules';
import type { RoleRevision } from '../contracts/role';
import type { TemplateRevision } from '../contracts/template';
import type { Cue } from '../contracts/video';
import type { ChatMessage } from '../contracts/generation';
import { AttachmentImages } from './Attachments';

const stageNames: Record<string, string> = { 'requirements-plan': '资料规划', 'vision-plan': '取帧规划', 'vision-review': '视觉证据核验', 'web-query':'检索关键词规划', 'web-search': '网页检索', 'subtitle-terms':'字幕术语检查','subtitle-reconcile':'全文术语复核','subtitle-correction-review':'纠错必要性复核','subtitle-enhance': '字幕纠错', 'subtitle-translate': '字幕翻译', 'html-format': 'HTML 页面生成', 'markdown-output': 'Markdown 笔记生成', 'legacy-knowledge': '旧知识生成', 'chat-output': 'Chat 回答' };
function InspectorDialog({ close, children }: { close: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="instruction-dialog" aria-label="本次 AI 指令" onCancel={close} onClose={close}>
    <header><h2>本次 AI 指令</h2><button onClick={close}>关闭指令查看</button></header>{children}
  </dialog>;
}
function TextBlock({ title, text }: { title: string; text: string }) {
  return <details><summary>{title}</summary><pre>{text}</pre></details>;
}
function Copy({ text, label = '复制文本' }: { text: string; label?: string }) {
  const [status, setStatus] = useState('');
  return <span className="instruction-copy"><button onClick={() => void navigator.clipboard.writeText(text).then(() => setStatus('已复制'), () => setStatus('复制失败，可展开后手动选择文本'))}>{label}</button><small role="status">{status}</small></span>;
}
function Rules({ rules }: { rules: readonly FixedPromptRule[] }) {
  return <div className="instruction-rules">{rules.map(rule => <details key={rule.id}><summary>{rule.priority} · {rule.title} <small>只读</small></summary>
    <p>作用：{rule.why}</p><p>生效条件：{rule.appliesWhen}</p><small>{rule.id} · {rule.version}</small><pre>{rule.text}</pre><Copy text={rule.text}/>
  </details>)}</div>;
}
function UserInstructions({ input, role, template, frozen, edit }: { input: string; role?: RoleRevision; template?: TemplateRevision; frozen?: boolean; edit?: (page: 'roles' | 'templates') => void }) {
  return <section><h3>{frozen ? '原请求的角色与任务（已冻结）' : '当前角色与任务'}</h3>
    <TextBlock title="P2 · 本次要求" text={input || '未填写额外要求'}/>
    <details><summary>P2 · 模板：{template ? `${template.name} · v${template.revision}` : '未选择'}</summary><pre>{template?.requirements ?? '直接执行本次要求'}</pre>{template && <Copy text={template.requirements}/>} {edit && <button onClick={() => edit('templates')}>编辑 / 复制模板</button>}</details>
    <details><summary>P3 · 角色：{role ? `${role.name} · v${role.revision}` : '默认表达'}</summary><pre>{role?.instructions ?? '没有附加角色指令'}</pre>{role && <Copy text={role.instructions}/>} {edit && <button onClick={() => edit('roles')}>编辑 / 复制角色</button>}</details>
    <p>角色管理语气、叙事方式、详略和时间呈现；本次明确要求优先，模板提供任务目标与表达默认值。</p>
    {frozen && <p>这里保留原请求的选择；只有最终生成阶段使用角色。修改配置只影响之后的新请求。</p>}
  </section>;
}

export function DraftInstructions({ client, draft, role, template, cues, sourceLabel, videoTitle, history, target, close, edit }: {
  client: ApplicationClient; draft: Draft; role?: RoleRevision; template?: TemplateRevision; cues?: readonly Cue[];
  sourceLabel: string; videoTitle: string; history: readonly ChatMessage[]; target: { workspaceId: string; chatId: string };
  close: () => void; edit: (page: 'roles' | 'templates') => void;
}) {
  const rules = selectFixedRules({ kind: 'answer', output: draft.outputType === 'html' ? (template?.outputProtocol === 'knowledge-json-v1' ? 'knowledge' : 'html-page') : draft.outputType,
    visionOnly: cues !== undefined && !cues.length, hasImages: !!draft.attachmentIds.length || history.some(h => h.attachmentIds.length > 0), web: false });
  return <InspectorDialog close={close}>
    <p className="instruction-notice">发送前配置 · 尚未调用 API。资料规划、联网和取帧结果还未确定；发送后可从消息上的“本次 AI 指令”查看实际调用。</p>
    <p>模型：{draft.modelId ?? '未选择'} · 产物：{draft.outputType}</p>
    <h3>预计生效的固定规则</h3><Rules rules={rules}/>
    {draft.webEnabled && <p>已启用联网：取得网页资料后才会加入网页引用规则。</p>}
    <UserInstructions input={draft.knowledgeFollowup?.question ?? draft.text} role={role} template={draft.knowledgeFollowup ? undefined : template} edit={edit}/>
    <section><h3>当前资料（与指令分开）</h3><p>{sourceLabel}。历史是否加入由资料规划决定，下列历史为候选资料。</p>
      <TextBlock title="视频信息" text={videoTitle}/>
      <TextBlock title={`当前主字幕 · ${cues?.length ?? 0} 条`} text={cues?.map(c => `[${c.from}-${c.to}] ${c.content}`).join('\n') || '当前没有可用字幕；实际发送还需通过来源检查。'}/>
      <TextBlock title={`候选问答历史 · ${history.length} 条`} text={JSON.stringify(history.map(h => ({ role: h.role, text: h.text, template: h.templateSnapshot, attachmentIds: h.attachmentIds })), null, 2)}/>
      <TextBlock title={`引用笔记 · ${draft.referenceIds.length} 项`} text={JSON.stringify(draft.references ?? draft.referenceIds, null, 2)}/>
      {draft.referenceIds.length > 0 && <p>这里列出已选引用；发送时冻结正文，可在实际调用中核对。</p>}
      {draft.knowledgeFollowup && <TextBlock title="选中知识追问" text={JSON.stringify(draft.knowledgeFollowup, null, 2)}/>}
      <details><summary>当前图片 · {draft.attachmentIds.length} 张</summary><AttachmentImages client={client} target={target} ids={draft.attachmentIds}/></details>
      <p>作者简介、章节、观众观点和网页补充按本次任务选择，实际取得后在调用记录中展示。</p>
    </section>
    <details><summary>查看全部产品固定规则</summary><Rules rules={Object.values(fixedPromptRules)}/></details>
  </InspectorDialog>;
}

function ActualMaterials({ call }: { call: InstructionCall }) {
  if(call.stage==='web-search'&&call.modelId==='DeepSeek Search')return <section><h3>实际搜索请求</h3><TextBlock title="关键词与搜索参数" text={call.body}/><p>用户开启联网后，由应用发出本次搜索；模型不能自行增加搜索次数。</p></section>;
  let body: { messages?: { role: string; content: unknown }[] };
  try { body = JSON.parse(call.body); } catch { return <p>请求体无法解析，请复制原始记录检查。</p>; }
  const messages = (body.messages ?? []).filter(message => message.role !== 'system');
  return <section><h3>实际任务消息与上下文资料</h3>{messages.map((message, index) => {
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2);
    if (typeof message.content === 'string' && message.content.startsWith('本次上下文资料（')) {
      try {
        const context = JSON.parse(message.content.slice(message.content.indexOf('\n') + 1));
        const labels: Record<string, string> = { videoTitle: '视频标题', videoPartTitle: '当前分 P', subtitle: '实际主字幕', supplemental: '实际补充资料与规划', visualObservation: '取帧情况', webEvidence: '实际网页资料与来源' };
        return <div key={index}>{Object.entries(context).map(([name, value]) => <TextBlock key={name} title={labels[name] ?? name} text={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}/>)}</div>;
      } catch { /* Preserve the exact message if the format changes. */ }
    }
    return <TextBlock key={index} title={`${index === messages.length - 1 ? '本阶段任务 / 引用' : '历史 / 阶段输入'} · ${message.role} · 消息 ${index + 1}`} text={text}/>;
  })}</section>;
}

export function RequestInstructions({ client, jobId, target, close }: { client: ApplicationClient; jobId: string; target: { workspaceId: string; chatId?: string }; close: () => void }) {
  const [view, setView] = useState<InstructionView>(), [error, setError] = useState(''), [selected, setSelected] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true, sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const token = ++sequence;
      try {
        const result = await client.instructions!({ type: 'instructions.query', jobId, ...target });
        if (alive && token === sequence) { setView(result); setError(''); }
      } catch { if (alive && token === sequence) setError('暂时无法读取调用记录。原对话可能已删除，请重试。'); }
    };
    // Streaming checkpoints can arrive for every token. Refresh at most twice a second.
    const schedule = () => { timer ??= setTimeout(() => { timer = undefined; void load(); }, 500); };
    const dispose = client.subscribe(schedule, state => { if (state === 'connected') schedule(); });
    void load();
    return () => { alive = false; clearTimeout(timer); dispose(); };
  }, [client, jobId, target.workspaceId, target.chatId, refresh]);
  const call = view?.calls.find(row => row.id === selected) ?? view?.calls.at(-1);
  const imageIds = [...new Set(call?.images.flatMap(image => view?.images.filter(row => row.sha256 === image.sha256).slice(0, 1).map(row => row.id) ?? []) ?? [])];
  return <InspectorDialog close={close}>
    <p className="instruction-notice">实际调用记录 · 不会再次调用模型</p><button onClick={() => setRefresh(value => value + 1)}>刷新调用记录</button>
    {error && <p role="alert">{error}</p>}{!view && !error && <p>读取中…</p>}
    {view && <><p>{view.note}</p><UserInstructions {...view.request} frozen/>
      {!view.calls.length && <p role="status">暂无实际调用记录：可能尚未发送、记录已过期 / 被清理、浏览器已重启，或该请求来自旧版 / 导入备份。上方冻结配置不等同于实际发出的消息。</p>}
      {call && <><label>选择调用阶段<select aria-label="选择调用阶段" value={call.id} onChange={e => setSelected(e.target.value)}>{view.calls.map((row, index) => <option key={row.id} value={row.id}>{index + 1}. {stageNames[row.stage] ?? row.stage} · 尝试 {view.attempts.findIndex(a => a.attemptId === row.attemptId) + 1}</option>)}</select></label>
        <p>模型：{call.modelId} · {new Date(call.capturedAt).toLocaleString()} · {call.status === 'network-error' ? '网络失败，接收情况未知' : call.status === 'dispatching' ? '已交给网络层，未记录到响应' : `HTTP ${call.httpStatus}`}</p>
        <small>任务 {jobId}<br/>尝试 {call.attemptId}</small>
        {call.redacted && <p>检测到与当前密钥相同的文本，已隐藏；此记录含脱敏替换。</p>}
        <h3>本阶段生效的固定规则 · 只读</h3><Rules rules={call.rules}/>
        <ActualMaterials call={call}/>
        {call.stage==='vision-plan'&&call.failedPlanResponse!==undefined&&<section><h3>失败规划响应</h3>
          <p>这是本地接收并送入校验的正文，未改写。仅在本次浏览器会话临时保存，不包含在“完整诊断”或备份中；复制前可检查其中的视频与任务内容。</p>
          <Copy text={call.failedPlanResponse} label="复制失败规划响应"/><TextBlock title="展开失败规划响应" text={call.failedPlanResponse}/>
        </section>}
        {call.stage==='vision-review'&&call.failedReviewResponse!==undefined&&<section><h3>失败核验响应</h3>
          <p>仅在本次浏览器会话临时保留，未包含在诊断或备份中。</p>
          <Copy text={call.failedReviewResponse} label="复制失败核验响应"/><TextBlock title="展开失败核验响应" text={call.failedReviewResponse}/>
        </section>}
        {call.images.length > 0 && <section><h3>实际发送图片 · {call.images.length} 张</h3>
          {target.chatId && <AttachmentImages client={client} target={{ workspaceId: target.workspaceId, chatId: target.chatId }} ids={imageIds} historyOnly/>}
          <TextBlock title="图片指纹与字节数" text={JSON.stringify(call.images, null, 2)}/>
          {imageIds.length < new Set(call.images.map(image => image.sha256)).size && <p>部分原附件当前无法读取；发送记录中的指纹仍保留。</p>}
        </section>}
        <h3>请求体核对</h3><p>保留实际模型参数和消息顺序。图片编码用指纹占位，密钥与请求头不包含在内。</p>
        <Copy text={call.body} label="复制请求文本"/><TextBlock title="展开请求 JSON" text={call.body}/>
      </>}
    </>}
  </InspectorDialog>;
}

export function RequestInstructionButton({ client, jobId, target, compact=false }: { client: ApplicationClient; jobId: string; target: { workspaceId: string; chatId?: string }; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!client.instructions) return null;
  return <><button className={compact?'completion-meta-link':'instruction-open'} aria-label={compact?'AI 指令':undefined} title="查看本次 AI 指令" onClick={() => setOpen(true)}>{compact?'AI 指令':'本次 AI 指令'}</button>{open && <RequestInstructions client={client} jobId={jobId} target={target} close={() => setOpen(false)}/>}</>;
}
