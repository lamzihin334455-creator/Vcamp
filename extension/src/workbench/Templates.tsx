import { useCallback,useEffect,useRef,useState } from 'react';
import {StyleManager} from './Styles';
import { Plus } from 'lucide-react';
import { SortablePromptList } from './SortablePromptList';
import type { ApplicationClient, Draft } from '../contracts/application';
import { isLegacyHtmlTemplate, isRetiredGenerationTemplate, type Template, type TemplateFields, type TemplateRevision } from '../contracts/template';
import { configurableDataSourceSchema, type ConfigurableDataSource } from '../contracts/evidence';
import { nextCopyName } from './prompt-name';
import { usePromptLeaveGuard, type RegisterPromptLeaveGuard } from './PromptLeaveGuard';

export function useTemplates(client: ApplicationClient, selected?: Draft['template'], enabled = true) {
  const [templates, setTemplates] = useState<Template[]>([]), [revision, setRevision] = useState<TemplateRevision>(), [error, setError] = useState('');
  useEffect(() => {
    if (!enabled || !client.templates) return;
    let disposed = false, sequence = 0;
    const refresh = async () => {
      const token = ++sequence;
      try {
        const result = await client.templates!({ type: 'template.query', ...(selected ? { selected } : {}) });
        if (!disposed && token === sequence) { setTemplates(result.templates); setRevision(result.revisions?.[0]); setError(''); }
      } catch { if (!disposed) setError('模板读取失败，请退出或重新选择模板'); }
    };
    const dispose = client.subscribe(() => void refresh(), state => { if (state === 'connected') void refresh(); });
    void refresh();
    return () => { disposed = true; dispose(); };
  }, [client, selected?.templateId, selected?.revisionId, enabled]);
  async function reorder(ids: string[]) {
    if (!client.templates) throw new Error('Template service unavailable');
    const result = await client.templates({ type: 'template.reorder', ids }); setTemplates(result.templates);
  }
  return { templates, revision, error, reorder };
}

const blank: TemplateFields = { name: '', description: '', requirements: '', outputType: 'chat', defaultModelId: null, requiredSources: [] };
export function PromptManager({client,models,registerLeaveGuard}:Parameters<typeof TemplateManager>[0]){
  const [tab,setTab]=useState<'tasks'|'styles'>('tasks');
  const guard=useRef<(()=>Promise<boolean>)|null>(null);
  const register=useCallback<RegisterPromptLeaveGuard>(value=>{guard.current=value;registerLeaveGuard?.(value);},[registerLeaveGuard]);
  async function select(next:typeof tab){if(next===tab)return;if(await (guard.current?.()??Promise.resolve(true)))setTab(next);}
  return <><nav className="prompt-manager-tabs" aria-label="模板管理分类"><button aria-pressed={tab==='tasks'} onClick={()=>void select('tasks')}>任务模板</button><button aria-pressed={tab==='styles'} onClick={()=>void select('styles')}>风格管理</button></nav>{tab==='tasks'?<TemplateManager client={client} models={models} registerLeaveGuard={register}/>:<StyleManager client={client} registerLeaveGuard={register}/>}</>;
}
const sourceLabels: Record<ConfigurableDataSource,string> = { full_subtitles:'完整主字幕', video_description:'视频简介', video_chapters:'视频章节', hot_comments:'热门评论', video_frames:'视频画面', conversation_history:'对话历史', web:'网页补充资料' };
const fieldsOf = (template: Template): TemplateFields => ({ name: template.name, description: template.description, requirements: template.requirements, outputType: template.outputType, ...(template.outputProtocol ? { outputProtocol: template.outputProtocol } : {}), defaultModelId: template.defaultModelId, requiredSources: [...(template.requiredSources ?? [])] });
export function TemplateManager({ client, models, registerLeaveGuard }: { client: ApplicationClient; models: { id: string; name: string }[]; registerLeaveGuard?: RegisterPromptLeaveGuard }) {
  const { templates, error: loadError, reorder } = useTemplates(client);
  const [editing, setEditing] = useState<Template>(), [fields, setFields] = useState<TemplateFields>(blank), [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false), [savedFields, setSavedFields] = useState<TemplateFields>(blank);
  const { requestLeave, leaveDialog } = usePromptLeaveGuard(editorOpen && JSON.stringify(fields) !== JSON.stringify(savedFields), busy, registerLeaveGuard);
  function begin(template?: Template) {
    const initial = template ? fieldsOf(template) : blank;
    setEditing(template); setFields(initial); setSavedFields(initial); setEditorOpen(true); setError(''); setStatus(''); setConfirmDelete(false);
  }
  async function backToList() {
    if (!await requestLeave()) return;
    setEditorOpen(false); setEditing(undefined); setFields(blank); setSavedFields(blank); setError(''); setStatus(''); setConfirmDelete(false);
  }
  const retired = isRetiredGenerationTemplate(editing), converting = retired && fields.outputProtocol === 'html-page-v1';
  async function save() {
    if (!client.templates) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await client.templates(editing ? { type: 'template.save', templateId: editing.id, expectedRevision: editing.revision, fields } : { type: 'template.create', fields });
      const saved = editing ? result.templates.find(row => row.id === editing.id) : result.templates.find(row => !templates.some(old => old.id === row.id));
      setEditing(saved); if (saved) { setFields(fieldsOf(saved)); setSavedFields(fieldsOf(saved)); }
      setStatus('模板已保存。从对话 @ 菜单重新选择后生效。');
    } catch { setError('保存失败：名称和要求不能为空，或模板已被另一窗口更新。当前输入已保留。'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!client.templates || !editing) return;
    setBusy(true); setError(''); setStatus('');
    try { await client.templates({ type: 'template.delete', templateId: editing.id, expectedRevision: editing.revision }); setEditing(undefined); setFields(blank); setSavedFields(blank); setEditorOpen(false); setConfirmDelete(false); setStatus('模板已从列表删除。已有选择和历史请求保留原版本。'); }
    catch { setError('删除失败，模板可能已更新，请重新选择后重试。'); }
    finally { setBusy(false); }
  }
  function setAllSources(required:boolean){setFields({...fields,requiredSources:required?[...configurableDataSourceSchema.options]:[]});}
  return <section className="template-manager prompt-manager" aria-label="任务模板管理">
    <div className="prompt-heading"><h3>{editorOpen ? editing ? `编辑模板 · ${editing.name}` : '新建模板' : <>模板管理 <span className="prompt-count">{templates.length}</span></>}</h3>{editorOpen ? <button disabled={busy} onClick={() => void backToList()}>返回模板列表</button> : <button className="prompt-create" onClick={() => begin()}><Plus aria-hidden="true"/>新建模板</button>}</div>
    {loadError && <p role="alert">{loadError}</p>}
    {!editorOpen ? <><SortablePromptList label="任务模板" items={templates.map(template => {
      const detail = isLegacyHtmlTemplate(template) ? '旧 HTML' : template.outputProtocol === 'html-page-v1' ? 'HTML' : template.outputProtocol ? '旧交互知识' : template.outputType === 'markdown' ? 'Markdown' : 'Chat';
      const label = `${template.name}${isLegacyHtmlTemplate(template) ? ' · 旧自由 HTML' : template.outputProtocol==='html-page-v1'?' · HTML 页面':template.outputProtocol ? ' · 旧交互知识' : template.outputType==='markdown'?' · Markdown 笔记':' · Chat'}`;
      return { id: template.id, name: template.name, detail, label, description: template.description };
    })} onOpen={id => begin(templates.find(row => row.id === id))} onReorder={reorder}/>{status && <p role="status">{status}</p>}</> :
    <form className="prompt-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="prompt-editor-body"><fieldset className="prompt-editor-fields" disabled={busy}>
    {editing && <div className="prompt-actions"><button type="button" disabled={busy || retired && !converting} onClick={() => { setEditing(undefined); setSavedFields(blank); setFields({ ...fields, name: nextCopyName(fields.name,templates.map(template=>template.name)) }); setConfirmDelete(false); setStatus('修改后点击创建模板，保存为独立模板。'); }}>复制模板</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>删除模板</button></div>}
    {confirmDelete && <div className="prompt-delete" role="group" aria-label="确认删除模板"><p>从列表删除「{editing?.name}」？已有选择和历史请求仍保留原版本。</p><button type="button" disabled={busy} onClick={() => void remove()}>确认删除模板</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button></div>}
    {retired && <div role="note"><p>这个模板使用已退役的生成协议，只保留读取和旧任务重试。转换后使用自包含 HTML 页面协议。</p><p>确认保存会创建新版本；旧成果与已冻结请求仍保留，当前草稿需从 @ 重新选择新版。</p>{!converting && <button type="button" disabled={busy} onClick={() => setFields({ ...fields, outputType: 'html', outputProtocol: 'html-page-v1' })}>转换为 HTML 页面</button>}</div>}
      <label>模板名称<input required maxLength={200} value={fields.name} onChange={e => setFields({ ...fields, name: e.target.value })}/></label>
      <label>模板要求<textarea aria-label="模板要求" required maxLength={8000} value={fields.requirements} onChange={e => setFields({ ...fields, requirements: e.target.value })}/></label>
      <label>固定产物<select value={isLegacyHtmlTemplate(fields) ? 'legacy-html' : fields.outputProtocol==='knowledge-json-v1'?'knowledge-json':fields.outputType} onChange={e => { const { outputProtocol: _protocol, ...rest } = fields; const value = e.target.value; setFields({ ...rest, outputType: value as TemplateFields['outputType'], ...(value === 'html' ? { outputProtocol: 'html-page-v1' as const } : {}) }); }}><option value="chat">Chat 问答</option><option value="markdown">Markdown 笔记</option>{retired&&isLegacyHtmlTemplate(fields)&&<option disabled value="legacy-html">旧自由 HTML（已退役）</option>}{retired&&fields.outputProtocol==='knowledge-json-v1'&&<option disabled value="knowledge-json">旧知识 JSON（已退役）</option>}<option value="html">HTML 页面</option></select></label>
      <label>模板描述（选填）<input maxLength={2000} value={fields.description} onChange={e => setFields({ ...fields, description: e.target.value })}/></label>
      <details className="prompt-details"><summary>资料调用策略 · {fields.requiredSources?.length ? `${fields.requiredSources.length} 项强制使用` : '自动判断'}</summary>
      <fieldset className="template-sources"><legend>资料调用策略</legend><div className="source-bulk-actions"><button type="button" onClick={()=>setAllSources(true)}>一键全开</button><button type="button" onClick={()=>setAllSources(false)}>一键全关</button></div><p>关闭时由资料规划按任务判断；开启后要求该资料参与规划，当前不可用时会将状态告诉模型。视频画面仍需用户在本次草稿中主动开启自主识别。</p>{configurableDataSourceSchema.options.map(source => { const required=fields.requiredSources?.includes(source)??false; return <label key={source}><span>{sourceLabels[source]}<small>{required?'强制使用':'自动判断'}</small></span><input className="source-switch" type="checkbox" role="switch" aria-label={`${sourceLabels[source]}强制使用`} checked={required} onChange={e=>setFields({...fields,requiredSources:e.target.checked?[...new Set([...(fields.requiredSources??[]),source])]:(fields.requiredSources??[]).filter(value=>value!==source)})}/></label>;})}</fieldset>
      </details>
      <details className="prompt-details"><summary>默认模型（选填）</summary>
      <label>默认模型<select value={fields.defaultModelId ?? ''} onChange={e => setFields({ ...fields, defaultModelId: e.target.value || null })}><option value="">使用当前配置的默认模型</option>{fields.defaultModelId && !models.some(m => m.id === fields.defaultModelId) && <option value={fields.defaultModelId}>{fields.defaultModelId}（不可用）</option>}{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      </details>
      </fieldset></div><div className="prompt-editor-footer">{error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}<button className="prompt-save" disabled={busy || retired && !converting}>{busy ? '正在保存…' : converting ? '确认转换并保存' : editing ? '保存模板' : '创建模板'}</button></div>
    </form>}{leaveDialog}
  </section>;
}
