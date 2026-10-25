import { z } from 'zod';
import { connectionIdentity, nativeDeepSeek, providerBaseUrl, providerDirectory } from '../contracts/provider-config';
import { ApplicationError } from '../contracts/application';
import { providerCommandSchema, providerCredentialSchema, type ProviderService, type ProviderView } from '../contracts/provider';
import type { CredentialStore } from './credential-store';
import { fetchModelList, ModelListError } from './model-list';
import { normalizeProviderModels, providerModelId } from './provider-model-routing';

type State = z.infer<typeof providerCredentialSchema>;
type Profile = NonNullable<State['savedProfiles']>[number];
const profileFrom = (state: State): Profile | undefined => state.key && state.profileId ? {
  id: state.profileId, label: state.profileLabel!, providerId: state.providerId, baseUrl: state.baseUrl,
  key: state.key, catalog: state.catalog ?? [], models: state.models, defaultModelId: state.defaultModelId
} : undefined;
function syncProfile(state: State): State {
  const current = profileFrom(state), saved = state.savedProfiles ?? [];
  return { ...state, savedProfiles: current ? saved.some(profile => profile.id === current.id) ? saved.map(profile => profile.id === current.id ? current : profile) : [...saved, current] : saved };
}
function activate(state: State, profile: Profile): State {
  return { ...state, profileId: profile.id, profileLabel: profile.label, providerId: profile.providerId, baseUrl: profile.baseUrl,
    key: profile.key, models: profile.models, catalog: profile.catalog, defaultModelId: profile.defaultModelId,
    status: profile.catalog.length || profile.models.length ? 'ready' : 'idle' };
}
export function createProviderService(storage: CredentialStore, transport: typeof fetch = fetch, changed = () => {}, authorize: (baseUrl: string) => Promise<boolean> = async () => true): ProviderService {
  let state: State;
  let active: AbortController | undefined;
  const ready = storage.read().then(async value => {
    state = value === undefined ? { providerId: 'deepseek', revision: 0, key: null, models: [], defaultModelId: null, status: 'idle' } : providerCredentialSchema.parse(value);
    // Existing installations keep their previously usable models on migration.
    const migrating = !!state.key && !state.profileId;
    state.catalog ??= [...state.models];
    const beforeRepair = JSON.stringify(state);
    const repair = <T extends { providerId: State['providerId']; baseUrl?: string; models: State['models']; catalog?: State['catalog']; defaultModelId: string | null }>(profile: T): T => ({ ...profile,
      models: normalizeProviderModels(profile, profile.models), catalog: normalizeProviderModels(profile, profile.catalog ?? []),
      defaultModelId: profile.defaultModelId ? providerModelId(profile, profile.defaultModelId) : null });
    state = { ...repair(state), ...(state.savedProfiles ? { savedProfiles: state.savedProfiles.map(repair) } : {}) };
    const repaired = beforeRepair !== JSON.stringify(state);
    if (repaired) state.revision++;
    if (state.key && !state.profileId) { state.profileId = crypto.randomUUID(); state.profileLabel = `${providerDirectory.find(provider => provider.id === state.providerId)!.name} 1`; }
    state = syncProfile(state);
    if (migrating || repaired) await storage.write(state);
    if (state.status === 'loading') state = { ...state, status: 'idle' };
  }).catch(() => { throw new ApplicationError('storage-failed'); });
  void ready.catch(() => {});
  let queue = Promise.resolve();
  const view = (): ProviderView => {
    const { key, savedProfiles, ...publicState } = state;
    return structuredClone({ ...publicState, hasKey: key !== null, profiles: (savedProfiles ?? []).map(profile => ({
      id: profile.id, label: profile.label, providerId: profile.providerId, baseUrl: profile.baseUrl,
      modelCount: profile.models.length, catalogCount: profile.catalog.length, models: profile.models
    })) });
  };
  function serial<T>(work: () => Promise<T> | T): Promise<T> {
    const task = queue.then(async () => { await ready; return work(); });
    queue = task.then(() => {}, () => {}); return task;
  }
  async function commit(next: State) {
    next = syncProfile(next);
    try { await storage.write(next); } catch { throw new ApplicationError('storage-failed'); }
    state = next; changed();
  }
  return { async command(input) {
    const parsed = providerCommandSchema.safeParse(input);
    if (!parsed.success) throw new ApplicationError('invalid-message');
    const op = parsed.data;
    if (op.type === 'provider.query') return serial(view);
    const start = await serial(async () => {
      if (op.expectedRevision !== state.revision) throw new ApplicationError('revision-conflict');
      if (op.type === 'provider.fetch' && !state.key) {
        await commit({ ...state, status: 'key-required', revision: state.revision + 1 }); return null;
      }
      if (op.type === 'provider.save-key' && op.providerId !== state.providerId) throw new ApplicationError('revision-conflict');
      if (op.type === 'provider.configure' && !await authorize(op.baseUrl)) throw new ApplicationError('permission-denied');
      if (op.type === 'provider.add-model' && (!state.key || nativeDeepSeek(state) || state.models.length >= 1000)) throw new ApplicationError('unsupported-capability');
      if (op.type === 'provider.default' && !state.models.some(model => model.id === op.modelId)) throw new ApplicationError('model-unavailable');
      let next = { ...state, revision: state.revision + 1 };
      if (op.type === 'provider.configure') {
        next.providerId = op.providerId; next.baseUrl = op.baseUrl;
        if (connectionIdentity(next) !== connectionIdentity(state)) {
          next.key = null; next.models = []; next.catalog = []; next.defaultModelId = null;
          next.profileId = undefined; next.profileLabel = undefined;
        }
        next.status = 'idle';
      }
      if (op.type === 'provider.save-key') {
        const existing = state.savedProfiles?.find(profile => profile.key === op.key && connectionIdentity(profile) === connectionIdentity(state));
        if (existing) next = activate(next, existing);
        else {
          if ((state.savedProfiles?.length ?? 0) >= 50) throw new ApplicationError('resource-limit');
          const prefix = providerDirectory.find(provider => provider.id === state.providerId)!.name;
          let index = 1; while (state.savedProfiles?.some(profile => profile.label === `${prefix} ${index}`)) index++;
          next.profileId = crypto.randomUUID(); next.profileLabel = `${prefix} ${index}`;
          next.key = op.key; next.models = []; next.catalog = []; next.defaultModelId = null; next.status = 'idle';
        }
      }
      if (op.type === 'provider.select-profile' || op.type === 'provider.select-model') {
        const profile = state.savedProfiles?.find(profile => profile.id === op.profileId);
        if (!profile) throw new ApplicationError('not-found');
        if (op.type === 'provider.select-model' && !profile.models.some(model => model.id === op.modelId && model.text !== 'unsupported')) throw new ApplicationError('model-unavailable');
        next = activate(next, profile);
        if (op.type === 'provider.select-model') next.defaultModelId = op.modelId;
      }
      if (op.type === 'provider.rename-profile') {
        if (!state.profileId || state.key && op.label.includes(state.key)) throw new ApplicationError('invalid-message');
        next.profileLabel = op.label;
      }
      if (op.type === 'provider.delete-key') {
        next.savedProfiles = state.savedProfiles?.filter(profile => profile.id !== state.profileId);
        next.key = null; next.models = []; next.catalog = []; next.defaultModelId = null;
        next.profileId = undefined; next.profileLabel = undefined; next.status = 'idle';
      }
      if (op.type === 'provider.delete-profile') {
        if (!state.savedProfiles?.some(profile => profile.id === op.profileId)) throw new ApplicationError('not-found');
        next.savedProfiles = state.savedProfiles.filter(profile => profile.id !== op.profileId);
        if (state.profileId === op.profileId) {
          const fallback = next.savedProfiles.find(profile => profile.defaultModelId && profile.models.some(model => model.id === profile.defaultModelId && model.text !== 'unsupported')) ?? next.savedProfiles[0];
          if (fallback) next = activate(next, fallback);
          else {
            next.key = null; next.models = []; next.catalog = []; next.defaultModelId = null;
            next.profileId = undefined; next.profileLabel = undefined; next.status = 'idle';
          }
        }
      }
      if (op.type === 'provider.import-models') {
        if (!state.key) throw new ApplicationError('model-unavailable');
        const available = new Map([...(state.catalog ?? []), ...state.models].map(model => [model.id, model]));
        if (op.modelIds.some(id => !available.has(id))) throw new ApplicationError('model-unavailable');
        next.models = op.modelIds.map(id => available.get(id)!);
        if (!next.models.some(model => model.id === next.defaultModelId)) next.defaultModelId = next.models[0]?.id ?? null;
      }
      if (op.type === 'provider.add-model') {
        if (op.modelId.includes(state.key!)) throw new ApplicationError('invalid-message');
        const model = { id: op.modelId, name: op.modelId, text: 'unknown' as const, vision: 'unsupported' as const, web: 'unknown' as const };
        if (!next.models.some(model => model.id === op.modelId)) next.models = [...next.models, model];
        if (!next.catalog?.some(model => model.id === op.modelId)) next.catalog = [...next.catalog ?? [], model];
        next.defaultModelId = op.modelId;
      }
      if (op.type === 'provider.default') next.defaultModelId = op.modelId;
      active?.abort(); active = undefined;
      next.status = op.type === 'provider.fetch' ? 'loading' : next.status === 'loading' ? 'idle' : next.status;
      await commit(next);
      if (op.type !== 'provider.fetch') return null;
      active = new AbortController();
      return { revision: state.revision, key: state.key!, connection: { providerId: state.providerId, baseUrl: providerBaseUrl(state) }, controller: active };
    });
    if (!start) return serial(view);
    const timer = setTimeout(() => start.controller.abort(), 15000);
    let catalog: ProviderView['models'] = [], status: ProviderView['status'] = 'ready';
    try { catalog = await fetchModelList(start.key, transport, start.controller.signal, start.connection); }
    catch (error) { status = error instanceof ModelListError ? error.status : 'network'; }
    finally { clearTimeout(timer); }
    return serial(async () => {
      if (state.revision !== start.revision) return view();
      await commit({ ...state, catalog: status === 'ready' ? catalog : state.catalog, status, revision: state.revision + 1 });
      if (active === start.controller) active = undefined;
      return view();
    });
  } };
}
