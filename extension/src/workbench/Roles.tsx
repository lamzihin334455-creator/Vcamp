import { useEffect, useId, useState } from 'react';
import { Globe2, FileText } from 'lucide-react';
import type { ApplicationClient, Draft } from '../contracts/application';
import type { PromptRole, RoleFields, RoleRevision } from '../contracts/role';
import { nextCopyName } from './prompt-name';
import { usePromptLeaveGuard, type RegisterPromptLeaveGuard } from './PromptLeaveGuard';

export function useRoles(client: ApplicationClient, selected?: Draft['role'], enabled = true) {
  const [roles, setRoles] = useState<PromptRole[]>([]), [revision, setRevision] = useState<RoleRevision>(), [error, setError] = useState('');
  useEffect(() => {
    if (!enabled || !client.roles) return;
    let disposed = false, sequence = 0;
    const refresh = async () => {
      const token = ++sequence;
      try {
        const result = await client.roles!({ type: 'role.query', ...(selected ? { selected } : {}) });
        if (!disposed && token === sequence) { setRoles(result.roles); setRevision(result.revisions?.[0]); setError(''); }
      } catch { if (!disposed && token === sequence) setError('角色读取失败，请重选角色或切换为默认表达。'); }
    };
    const dispose = client.subscribe(() => void refresh(), state => { if (state === 'connected') void refresh(); });
    void refresh();
    return () => { disposed = true; dispose(); };
  }, [client, selected?.roleId, selected?.revisionId, enabled]);
  return { roles, revision, error };
}

const blank: RoleFields = { name: '', description: '', instructions: '' };
export function RoleManager({ client, registerLeaveGuard }: { client: ApplicationClient; registerLeaveGuard?: RegisterPromptLeaveGuard }) {
  const scopeId = useId();
  const { roles, error: loadError } = useRoles(client);
  const [allOutputs,setAllOutputs]=useState(false),[scopeReady,setScopeReady]=useState(false),[scopeBusy,setScopeBusy]=useState(false),[scopeError,setScopeError]=useState('');
  useEffect(()=>{let alive=true;void (client.roleOutputPreferences?.read()??Promise.resolve(false)).then(value=>{if(alive){setAllOutputs(value);setScopeReady(true);}},()=>{if(alive)setScopeError('角色应用范围读取失败，请重试。');});return()=>{alive=false;};},[client]);
  useEffect(()=>{let alive=true;const dispose=client.subscribePreferences?.(keys=>{if(keys.includes('vcamp.roleAllOutputs'))void client.roleOutputPreferences?.read().then(value=>{if(alive)setAllOutputs(value);}).catch(()=>{});});return()=>{alive=false;dispose?.();};},[client]);
  async function changeScope(enabled:boolean){if(!client.roleOutputPreferences||scopeBusy)return;const previous=allOutputs;setAllOutputs(enabled);setScopeBusy(true);try{await client.roleOutputPreferences.write(enabled);setAllOutputs(enabled);setScopeError('');}catch{setAllOutputs(previous);setScopeError('应用范围未保存，请重试。');}finally{setScopeBusy(false);}}
  const [editing, setEditing] = useState<PromptRole>(), [fields, setFields] = useState<RoleFields>(blank);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false), [savedFields, setSavedFields] = useState<RoleFields>(blank);
  const { requestLeave, leaveDialog } = usePromptLeaveGuard(editorOpen && JSON.stringify(fields) !== JSON.stringify(savedFields), busy, registerLeaveGuard);
  const reset = () => { setEditing(undefined); setFields(blank); setSavedFields(blank); setError(''); setStatus(''); setConfirmDelete(false); };
  function begin(role?: PromptRole) {
    reset(); const initial = role ? { name: role.name, description: role.description, instructions: role.instructions } : blank;
    setEditing(role); setFields(initial); setSavedFields(initial); setEditorOpen(true);
  }
  async function backToList() { if (await requestLeave()) { reset(); setEditorOpen(false); } }
  async function save() {
    if (!client.roles) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await client.roles(editing ? { type: 'role.save', roleId: editing.id, expectedRevision: editing.revision, fields } : { type: 'role.create', fields });
      const saved = editing ? result.roles.find(row => row.id === editing.id) : result.roles.find(row => !roles.some(old => old.id === row.id));
      setEditing(saved); if (saved) { const initial = { name: saved.name, description: saved.description, instructions: saved.instructions }; setFields(initial); setSavedFields(initial); }
      setStatus('角色已保存。返回侧栏设置重新选择后生效。');
    } catch { setError('保存失败：请检查必填项，或重新打开另一窗口已更新的角色。当前输入已保留。'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!client.roles || !editing) return;
    setBusy(true); setError('');
    try { await client.roles({ type: 'role.delete', roleId: editing.id, expectedRevision: editing.revision }); reset(); setEditorOpen(false); setStatus('角色已从列表删除。已有选择和历史请求保留原版本。'); }
    catch { setError('删除失败，角色可能已更新，请重新选择后重试。'); }
    finally { setBusy(false); }
  }
  return <section className="template-manager prompt-manager" aria-label="角色管理">
    <div className="prompt-heading"><h3>{editorOpen ? editing ? `编辑角色 · ${editing.name}` : '新建角色' : '角色管理'}</h3>{editorOpen && <button disabled={busy} onClick={() => void backToList()}>返回角色列表</button>}</div>
    {loadError && <p role="alert">{loadError}</p>}
    {!editorOpen ? <><section className="role-scope-card" aria-label="应用范围">
      <h4><Globe2 size={18} aria-hidden="true"/>应用范围</h4>
      <div className="role-scope-control">
        <div className="settings-toggle-row"><strong id={`${scopeId}-label`}>将当前角色应用到所有产物</strong><button className="toggle-switch" role="switch" aria-labelledby={`${scopeId}-label`} aria-describedby={`${scopeId}-description`} aria-checked={allOutputs} aria-busy={scopeBusy} disabled={!scopeReady||scopeBusy||!client.roleOutputPreferences} onClick={()=>void changeScope(!allOutputs)}><i/></button></div>
        <p id={`${scopeId}-description`}>关闭时仅用于问答；开启后，笔记和 HTML 页面也使用当前角色的表达偏好。已发送的请求保持原设置。</p>
      </div>
      {scopeError&&<p role="alert">{scopeError}</p>}
    </section>
    <section className="role-description-card" aria-label="角色说明"><h4><FileText size={18} aria-hidden="true"/>角色说明</h4><p>设置回答的详略与侧重点，也可自定义角色身份和表达风格。</p></section>
    <div className="prompt-actions"><button onClick={() => begin()}>新建角色</button></div>
    <div className="template-list prompt-list">{roles.map(role => <button key={role.id} aria-label={role.name} onClick={() => begin(role)}><span className="prompt-list-title"><strong>{role.name}</strong></span><span className="prompt-list-description">{role.description || '点击编辑表达方式与角色指令'}</span></button>)}</div>
    <details className="prompt-details"><summary>角色如何生效</summary><p>角色管理表达偏好，模板定义任务目标。本次明确要求优先；未填写的偏好由模型按任务决定。保存后，从侧栏设置重新选择角色生效；历史请求保留原版本。</p></details>{status && <p role="status">{status}</p>}</> :
    <form className="prompt-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="prompt-editor-body"><fieldset className="prompt-editor-fields" disabled={busy}>
      {editing && <div className="prompt-actions"><button type="button" disabled={busy} onClick={() => { setEditing(undefined); setSavedFields(blank); setFields({ ...fields, name: nextCopyName(fields.name,roles.map(role=>role.name)) }); setConfirmDelete(false); setStatus('修改后点击创建角色，保存为独立角色。'); }}>复制角色</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>删除角色</button></div>}
      {confirmDelete && <div className="prompt-delete" role="group" aria-label="确认删除角色"><p>从列表删除「{editing?.name}」？已有选择和历史请求仍保留原版本。</p><button type="button" disabled={busy} onClick={() => void remove()}>确认删除角色</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button></div>}
      <label>角色名称<input required maxLength={200} value={fields.name} onChange={e => setFields({ ...fields, name: e.target.value })}/></label>
      <label>角色指令与表达偏好<textarea aria-label="角色指令" required maxLength={4000} value={fields.instructions} placeholder="描述语气、叙事方式、回答详略，以及是否显示时间点、频率和形式" onChange={e => setFields({ ...fields, instructions: e.target.value })}/></label>
      <label>列表简介（选填，不作为表达指令）<input maxLength={2000} value={fields.description} onChange={e => setFields({ ...fields, description: e.target.value })}/></label>
      <details className="prompt-details"><summary>指令示例与使用说明</summary><p>例如：像伙伴一样直白交流，先给结论，再用一个例子解释，通常简短回答；默认不附时间点，需要定位时再提供。</p><p>也可以写：详细解释原理与推导，用章节组织；每章末尾附一处相关时间区间，避免每句话都标时间。</p><p>把实际偏好写在上方指令中。本次明确要求优先于角色偏好，角色偏好优先于模板的表达默认值；任务目标、事实与输出格式仍须遵守。保存后需从侧栏设置重新选择才会生效。</p></details>
      </fieldset></div><div className="prompt-editor-footer">{error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}<button className="prompt-save" disabled={busy}>{busy ? '正在保存…' : editing ? '保存角色' : '创建角色'}</button></div>
    </form>}{leaveDialog}
  </section>;
}
