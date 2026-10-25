import { useEffect, useId, useRef, useState } from 'react';
import type { ModuleChrome, ModuleId } from './modules';
import { Icon } from './Icons';
import { accentColors } from './appearance';
import type { PromptRole, RoleRevision, RoleSelection } from '../contracts/role';
import { ChoicePicker } from './ChoicePicker';

/** Presentation only: item selection and actions stay with their owning module. */
export function ContextHeader({ module, title, subtitle, status, items, actions, disabled, readonly=false, newChat, extra, collapsed, collapse }: {
  module: ModuleId; title: string; subtitle: string; status: string;
  items: NonNullable<ModuleChrome['items']>; actions: NonNullable<ModuleChrome['actions']>;
  disabled: boolean; readonly?:boolean; newChat?: () => void; extra?: React.ReactNode;
  collapsed: boolean; collapse: (value: boolean) => void;
}) {
  const statusId = useId();
  const toolbarId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [module, title, collapsed]);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return <>
    <button className="context-toggle" aria-label={collapsed ? '展开顶部工具栏' : '收起顶部工具栏'} title={collapsed ? '展开顶部工具栏' : '收起顶部工具栏'} aria-expanded={!collapsed} aria-controls={toolbarId} onClick={() => collapse(!collapsed)}><Icon name="chevron"/></button>
    <header id={toolbarId} className="titlebar" hidden={collapsed}>
      <div className="context-current" ref={root} onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}>
        <button ref={trigger} className="context-current-button" disabled={disabled||readonly} aria-label={module==='subtitle'?'切换字幕轨道':'切换当前内容'} aria-describedby={statusId} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <strong title={title}>{title}</strong><i aria-hidden="true" className="context-status-dot" title={status} data-busy={/正在|中|未保存/.test(status)}/><span className="context-module">{subtitle}</span><span id={statusId} className="sr-only">{status}</span><Icon name="chevron"/>
        </button>
        {open && <div className="context-menu" role="menu" aria-label={module==='subtitle'?'字幕轨道':'当前内容'}>
          <p>{subtitle}</p>{newChat && <button role="menuitem" onClick={() => { setOpen(false); newChat(); }}><Icon name="plus"/>新对话</button>}
          {items.map(item => <button role="menuitem" key={item.id} disabled={item.disabled} onClick={() => { setOpen(false); item.select(); }}>{item.title}</button>)}
          {!items.length && <p>暂无已保存内容</p>}{extra}
        </div>}
      </div>
      <div className="header-actions">{actions.map(action => <button key={action.label} aria-label={action.iconOnly?action.label:undefined} data-subtitle-settings-trigger={module==='subtitle'&&action.label==='字幕设置'?true:undefined} aria-haspopup={module==='subtitle'&&action.label==='字幕设置'?'dialog':undefined} aria-expanded={module==='subtitle'&&action.label==='字幕设置'?action.active:undefined} className={`${action.active?'active':''}${action.iconOnly?' header-icon-action':''}`} aria-pressed={action.active} title={action.tooltip??(action.label==='联网'?(action.active?'当前对话已开启联网，点击关闭':'当前对话未开启联网，点击开启'):undefined)} disabled={disabled || action.disabled || readonly&&action.label!=='导出'} onClick={action.run}><Icon name={action.label==='刷新'?'refresh':action.label === '联网' ? 'online' : action.label === '导出' ? 'export' : action.label === '字幕设置' ? 'sliders' : action.label.includes('初始化') ? 'init' : 'edit'}/>{!action.iconOnly&&action.label}</button>)}</div>
    </header>
  </>;
}

export function SettingsMenu({ color, chooseColor, close, openPage, readonly, roles, activeRole, activeRoleRevision, roleBusy, chooseRole, webDefault, webBusy, toggleWebDefault, apiControls }: { apiControls?: React.ReactNode; color: string; chooseColor: (color: string) => void; close: () => void; openPage: (page: 'api' | 'templates' | 'roles') => void; readonly: boolean; roles: PromptRole[]; activeRole: RoleSelection | null; activeRoleRevision?: RoleRevision; roleBusy: boolean; chooseRole: (role: PromptRole | null) => void; webDefault: boolean; webBusy: boolean; toggleWebDefault: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const currentRole = roles.find(role => role.id === activeRole?.roleId && role.revisionId === activeRole.revisionId);
  const selectedRevision = activeRoleRevision?.roleId === activeRole?.roleId && activeRoleRevision?.revisionId === activeRole?.revisionId ? activeRoleRevision : undefined;
  const roleLabel = !activeRole ? '默认表达' : currentRole?.name ?? (selectedRevision ? `${selectedRevision.name}（历史版本）` : '已选角色');
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node) && !(e.target as Element).closest('[aria-label="设置"], [data-settings-picker]')) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [close]);
  return <div className="quick-settings" ref={root} onKeyDown={e => { if (e.key === 'Escape') close(); }} aria-label="工作台设置">
    <p>设置</p>
    <div className="settings-label">主题颜色</div><div className="accent-colors" aria-label="强调色">{accentColors.map(item => <button key={item.value} disabled={readonly} title={item.name} aria-label={item.name} aria-pressed={color === item.value} style={{ '--swatch': item.value } as React.CSSProperties} onClick={() => chooseColor(item.value)}/>)}</div>
    <div className="settings-toggle-row"><span><strong>对话偏好</strong><small>新对话默认联网</small></span><button className="toggle-switch" role="switch" aria-label="新对话默认联网" aria-checked={webDefault} disabled={readonly||webBusy} onClick={toggleWebDefault}><i/></button></div>
    <div className="quick-api-row quick-role-row"><button className="quick-api-trigger" aria-label="角色设置" onClick={() => openPage('roles')}><span>角色设置</span><Icon name="chevron"/></button><ChoicePicker label="当前角色" popupLabel="选择角色" placeholder="默认表达" selectedLabel={roleLabel} value={activeRole ? activeRole.revisionId : 'default'} disabled={readonly||roleBusy} options={[{value:'default',label:'默认表达',detail:'使用默认的表达方式'},...roles.map(role => ({value:role.revisionId,label:role.name,detail:role.description}))]} onChange={value => { const role=roles.find(role=>role.revisionId===value); if (value==='default'||role) chooseRole(role??null); }}/></div>
    {apiControls ?? <button onClick={() => openPage('api')}>API 设置<Icon name="chevron"/></button>}<button onClick={() => openPage('templates')}>模板工作流<Icon name="chevron"/></button>
  </div>;
}
