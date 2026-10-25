import { useCallback, useEffect, useRef, useState } from 'react';
import { ApplicationError, type ApplicationClient } from '../contracts/application';
import { baseUrlSchema, nativeDeepSeek, providerBaseUrl, providerDirectory, providerPresets, type ProviderId } from '../contracts/provider-config';
import { modelIdSchema } from '../contracts/provider';
import type { ProviderCommand, ProviderView } from '../contracts/provider';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { importedModelOptions } from './provider-model-options';
import { ChoicePicker } from './ChoicePicker';

export function useProvider(client: ApplicationClient, enabled: boolean) {
  const [view, setView] = useState<ProviderView>();
  const [error, setError] = useState('');
  const alive = useRef(true);
  const accept = useCallback((next: ProviderView) => {
    if (alive.current) setView(old => !old || next.revision >= old.revision ? next : old);
  }, []);
  const refresh = useCallback(async () => {
    if (!enabled || !client.provider) return;
    try { accept(await client.provider({ type: 'provider.query' })); if (alive.current) setError(''); }
    catch { if (alive.current) setError('无法读取服务配置，请重试。'); }
  }, [client, enabled, accept]);
  useEffect(() => {
    alive.current = true;
    if (!enabled || !client.provider) return;
    const dispose = client.subscribe(() => { void refresh(); }, () => {});
    void refresh(); return () => { alive.current = false; dispose(); };
  }, [client, enabled, refresh]);
  async function command(op: ProviderCommand) {
    if (!client.provider) return false;
    try { const next = await client.provider(op); accept(next); if (alive.current) setError(''); return next; }
    catch (reason) {
      if (alive.current) setError(reason instanceof ApplicationError && reason.code === 'revision-conflict'
        ? '配置已在另一操作中更新，请重新读取后再操作。' : '配置操作未完成，请重试。');
      return false;
    }
  }
  return { view, error, command, refresh };
}
const statuses: Record<ProviderView['status'], string> = {
  idle: '尚未拉取模型', loading: '正在拉取模型…', ready: '模型列表已更新', 'key-required': '请先保存 API Key',
  authentication: '认证失败，请替换 API Key 后重试', 'rate-limited': '请求过于频繁，请稍后重试', network: '网络连接失败，请重试',
  timeout: '连接超时，请重试', empty: '服务未返回可用模型，请重试', protocol: '模型响应格式不受支持，请重试', unavailable: '服务暂不可用，请稍后重试'
};
export function ProviderSettings({ provider }: { provider: ReturnType<typeof useProvider> }) {
  const [key, setKey] = useState(''), [saving, setSaving] = useState(false);
  const [providerId, setProviderId] = useState<ProviderId>('deepseek');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com');
  const [modelId, setModelId] = useState(''), [localError, setLocalError] = useState('');
  const [importOpen, setImportOpen] = useState(false), [profileName, setProfileName] = useState('');
  const [adding, setAdding] = useState(false);
  const view = provider.view;
  useEffect(() => {
    if (view) { setProviderId(view.providerId); setBaseUrl(providerBaseUrl(view)); setKey(''); setModelId(''); }
  }, [view?.providerId, view?.baseUrl, view?.profileId]);
  useEffect(() => { setProfileName(view?.profileLabel ?? ''); setImportOpen(false); setAdding(false); }, [view?.profileId]);
  const url = baseUrlSchema.safeParse(baseUrl);
  const dirty = !!view && (adding || providerId !== view.providerId || !url.success || url.data !== providerBaseUrl(view));
  const generic = !!view && !nativeDeepSeek(view);
  async function save() {
    if (!view || !url.success) return;
    const entered = key; setKey(''); setSaving(true); setLocalError('');
    try {
      let current = view;
      if (dirty) {
        const permission = { origins: [`${new URL(url.data).origin}/*`] };
        // Presets and previously granted custom origins save without a browser prompt.
        if (!await chrome.permissions.contains(permission) && !await chrome.permissions.request(permission)) {
          setLocalError('服务地址访问权限未授予，连接配置未更改。'); return;
        }
        const configured = await provider.command({ type: 'provider.configure', providerId, baseUrl: url.data, expectedRevision: current.revision });
        if (!configured) return;
        current = configured;
      }
      if (entered && await provider.command({ type: 'provider.save-key', providerId: current.providerId, expectedRevision: current.revision, key: entered })) setAdding(false);
    } catch { setLocalError('连接未保存，请检查服务地址与浏览器权限后重试。'); }
    finally { setSaving(false); }
  }
  async function run(command: ProviderCommand) {
    setSaving(true);
    try { const result = await provider.command(command); if (result && command.type === 'provider.add-model') setModelId(''); if (result && command.type === 'provider.fetch' && result.status === 'ready') setImportOpen(true); if (result && command.type === 'provider.import-models') setImportOpen(false); } finally { setSaving(false); }
  }
  return <section className="provider-settings" aria-label="模型服务配置">
    <section className="provider-step provider-current" aria-label="当前模型配置"><h3>当前应用模型</h3><QuickProviderSwitcher provider={provider} readonly={saving}/></section>
    <section className="provider-step" aria-label="连接服务"><div className="provider-step-heading"><h3><span>1</span>连接服务</h3><button className="provider-new" disabled={!view || saving} onClick={() => { setAdding(true); setKey(''); setModelId(''); setLocalError(''); }}><Plus/>新增连接</button></div>
    <label>服务商<select aria-label="服务商" value={providerId} disabled={!view || saving} onChange={event => {
      const id = event.target.value as ProviderId; setProviderId(id); setBaseUrl(providerDirectory.find(item => item.id === id)!.baseUrl); setKey(''); setLocalError('');
    }}>{providerPresets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{!providerPresets.some(item => item.id === providerId) && <option value={providerId} disabled>{providerDirectory.find(item => item.id === providerId)!.name}（已有连接）</option>}</select></label>
    <label>服务地址（Base URL）<input aria-label="服务地址（Base URL）" type="url" autoComplete="off" spellCheck={false} value={baseUrl} maxLength={500} disabled={!view || saving} placeholder="https://your-provider.example/v1" onChange={event => { setBaseUrl(event.target.value); setKey(''); }}/></label>
    {!url.success && baseUrl && <p role="alert">请填写有效的 HTTPS Base URL，不含密钥、查询参数或 /chat/completions。</p>}
    <label>API Key<input aria-label="API Key" type="password" autoComplete="off" spellCheck={false} value={key} maxLength={256} disabled={saving}
      placeholder={!dirty && view?.hasKey ? '已保存，输入新 Key 可新增连接' : '输入 API Key'} onChange={e => setKey(e.target.value)}/></label>
    <div className="provider-actions"><button className="provider-primary" onClick={() => void save()} disabled={!view || saving || !url.success || (key ? !/^[\x21-\x7e]{1,256}$/.test(key) : adding || !dirty)}>{saving ? '正在处理…' : dirty ? '保存连接' : view?.hasKey ? '保存另一 Key' : '保存 Key'}</button></div>
    <p data-testid="key-state">{dirty ? '新连接尚未保存' : view?.hasKey ? 'Key 已保存在本机' : '未保存 Key'}</p>
    </section>
    <section className="provider-step" aria-label="管理模型"><h3><span>2</span>管理模型</h3>
      <div className="provider-profile-list" aria-label="已保存的 API 配置">{view?.profiles?.map(profile => <div className="provider-profile-card" key={profile.id} data-selected={!adding && profile.id === view.profileId}>
        <button className="provider-profile-select" aria-pressed={!adding && profile.id === view.profileId} disabled={saving} onClick={() => { setAdding(false); if (profile.id === view.profileId) { setProviderId(view.providerId); setBaseUrl(providerBaseUrl(view)); setKey(''); } else void run({ type: 'provider.select-profile', profileId: profile.id, expectedRevision: view.revision }); }}><strong>{profile.label}</strong><small>{providerDirectory.find(item => item.id === profile.providerId)!.name} · {profile.modelCount} 个模型</small></button>
        <button className="provider-profile-delete" aria-label={`删除连接 ${profile.label}`} disabled={saving} onClick={() => void run({ type: 'provider.delete-profile', profileId: profile.id, expectedRevision: view.revision })}><Trash2/>删除</button>
      </div>)}</div>
      {!view?.profiles?.length && <p className="provider-help">暂无连接</p>}
    {view?.profileId && !dirty && <p className="provider-connection-title">当前连接<strong>{view.profileLabel}</strong></p>}
    {view?.hasKey && !dirty && <button className="provider-primary" disabled={saving || view.status === 'loading'} onClick={() => void run({ type: 'provider.fetch', expectedRevision: view.revision })}>{view.status === 'loading' ? '正在拉取模型…' : '拉取模型 / 重试'}</button>}
    <p role="status">{dirty ? '请先保存连接' : view?.hasKey || !view ? view ? statuses[view.status] : '正在读取配置…' : ''}</p>
    {!!view?.catalog?.length && !dirty && <><button aria-expanded={importOpen} onClick={() => setImportOpen(value => !value)}>选择模型录入（已录入 {view.models.length} / 可选 {view.catalog.length}）</button></>}
    {!dirty && importOpen && !!view?.catalog?.length && <ModelIntake key={view.profileId} view={view} saving={saving} apply={ids => run({ type: 'provider.import-models', modelIds: ids, expectedRevision: view.revision })}/>}
    {view?.profileId && !dirty && <section className="provider-imported" aria-label="已录入模型"><div className="provider-imported-heading"><strong>已录入模型</strong><span>{view.models.length} 个</span></div>
      {view.models.map(model => <div className="provider-imported-row" key={model.id}><span><strong>{model.name}</strong>{model.name !== model.id && <small>{model.id}</small>}{model.id === view.defaultModelId && <small className="provider-default-badge">默认模型</small>}</span><button aria-label={`删除已录入模型 ${model.id}`} title="删除已录入模型" disabled={saving} onClick={() => void run({ type: 'provider.import-models', modelIds: view.models.filter(item => item.id !== model.id).map(item => item.id), expectedRevision: view.revision })}><Trash2/></button></div>)}
      {!view.models.length && <p className="provider-help">还没有录入模型</p>}
    </section>}
    {view?.profileId && !dirty && <details className="provider-more"><summary>更多设置</summary><div>
      {generic && <><label>手动模型 ID<input aria-label="手动模型 ID" value={modelId} maxLength={160} spellCheck={false} disabled={!view.hasKey || saving} onChange={event => setModelId(event.target.value)} placeholder="输入完整模型 ID"/></label>
      <button disabled={!view.hasKey || saving || !modelIdSchema.safeParse(modelId).success} onClick={() => void run({ type: 'provider.add-model', expectedRevision: view.revision, modelId })}>添加并设为默认模型</button></>}
      <div className="provider-profile-name"><label>连接名称<input aria-label="配置名称" maxLength={40} disabled={saving} value={profileName} onChange={event => setProfileName(event.target.value)}/></label><button disabled={saving || !profileName.trim() || profileName.trim() === view.profileLabel} onClick={() => void run({ type: 'provider.rename-profile', expectedRevision: view.revision, label: profileName })}>保存名称</button></div>
    </div></details>}
    </section>
    {(localError || provider.error) && <div role="alert">{localError || provider.error}<button onClick={() => void provider.refresh()}>重新读取配置</button></div>}
  </section>;
}

function ModelIntake({ view, saving, apply }: { view: ProviderView; saving: boolean; apply: (ids: string[]) => Promise<void> }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(view.models.map(model => model.id)));
  useEffect(() => { setSelected(new Set(view.models.map(model => model.id))); }, [view.profileId, view.revision]);
  const catalogue = [...new Map([...(view.catalog ?? []), ...view.models].map(model => [model.id, model])).values()];
  const query = search.trim().toLowerCase(), matches = catalogue.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(query));
  function toggle(id: string) { setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <div className="provider-intake" aria-label="模型录入">
    <label>搜索模型<input aria-label="搜索待录入模型" type="search" placeholder="搜索名称或完整模型 ID" value={search} onChange={event => setSearch(event.target.value)}/></label>
    <div className="provider-intake-actions"><span>已选 {selected.size} 个 · 匹配 {matches.length} 个</span><button disabled={saving} onClick={() => setSelected(previous => new Set([...previous, ...matches.filter(model => model.text !== 'unsupported').map(model => model.id)]))}>全选搜索结果</button><button disabled={saving} onClick={() => setSelected(previous => new Set([...previous].filter(id => !matches.some(model => model.id === id))))}>取消搜索结果</button></div>
    <div className="provider-model-catalog" role="group" aria-label="待录入模型列表">{matches.map(model => <label key={model.id}><input type="checkbox" checked={selected.has(model.id)} disabled={saving || model.text === 'unsupported'} onChange={() => toggle(model.id)}/><span><strong>{model.name}</strong><small>{model.id}{model.text === 'unsupported' ? ' · 不支持文本对话' : ''}</small></span></label>)}{!matches.length && <p>没有匹配的模型</p>}</div>
    <button className="provider-primary" disabled={saving} onClick={() => void apply([...selected])}>录入所选模型</button>
  </div>;
}

export function QuickProviderSwitcher({ provider, manage, readonly = false }: { provider: ReturnType<typeof useProvider>; manage?: () => void; readonly?: boolean }) {
  const [busy, setBusy] = useState(false);
  const view = provider.view;
  const options = importedModelOptions(view);
  const value = view?.profileId && view.defaultModelId ? `${view.profileId}:${view.defaultModelId}` : '';
  const current = options.find(option => option.value === value);
  async function select(value: string) {
    const option = options.find(option => option.value === value);
    if (!view || !option) return;
    setBusy(true);
    try { await provider.command({ type: 'provider.select-model', profileId: option.profileId, modelId: option.modelId, expectedRevision: view.revision }); }
    finally { setBusy(false); }
  }
  const selector = <ChoicePicker label="当前应用模型" popupLabel="选择已录入模型" placeholder={options.length ? '选择模型' : '请先录入模型'} matchWidth={!manage} value={current?.value ?? ''} selectedLabel={current?.label} options={options.map(option => ({ value: option.value, label: option.modelLabel, badge: option.providerLabel }))} disabled={readonly || busy || !options.length} onChange={value => void select(value)}/>;
  return <div className={`provider-quick-switcher ${manage ? 'provider-menu-switcher' : 'provider-quick-controls'}`}>
    {manage ? <div className="quick-api-row"><button className="quick-api-trigger" aria-label="API 设置" disabled={readonly} onClick={manage}><span>API 设置</span><ChevronRight/></button>{selector}</div> : <label>应用模型{selector}</label>}
    {provider.error && <p role="alert">{provider.error}</p>}
  </div>;
}
