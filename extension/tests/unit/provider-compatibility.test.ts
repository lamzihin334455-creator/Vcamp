import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
import { baseUrlSchema, nativeDeepSeek, providerDirectory, sameProviderConnection } from '../../src/contracts/provider-config';
import { createProviderService } from '../../src/generation/provider-service';
import { createProviderPort, providerCompletionEndpoint } from '../../src/generation/provider-port';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { createTaskService } from '../../src/generation/task-service';
import { importedModelOptions } from '../../src/app/provider-model-options';

const key = 'SYNTHETIC_COMPATIBILITY_KEY';
const connection = { providerId: 'siliconflow' as const, baseUrl: 'https://api.siliconflow.cn/v1' };
function setup(transport: typeof fetch = async () => Response.json({ data: [{ id: 'org/model', input_modalities: ['text', 'image'] }] }), authorize = async (_url: string) => true) {
  let record: unknown;
  const storage = { async read() { return structuredClone(record); }, async write(value: unknown) { record = structuredClone(value); } };
  return { storage, service: createProviderService(storage, transport, undefined, authorize) };
}
const sse = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });

test('preset base paths are retained; custom URLs reject credentials, suffixes and insecure schemes', () => {
  for (const preset of providerDirectory.filter(item => item.id !== 'custom')) {
    expect(baseUrlSchema.parse(preset.baseUrl + '/')).toBe(preset.baseUrl);
    expect(providerCompletionEndpoint({ providerId: preset.id, baseUrl: preset.baseUrl })).toBe(`${preset.baseUrl}/chat/completions`);
  }
  expect(baseUrlSchema.parse(' https://gateway.example/proxy/v1/ ')).toBe('https://gateway.example/proxy/v1');
  for (const value of ['http://gateway.test/v1', 'https://user:secret@gateway.test/v1', 'https://gateway.test/v1?key=secret', 'https://gateway.test/v1#secret', 'https://gateway.test/v1/chat/completions', 'https://gateway.test/v1/models', 'file:///secret', 'https://gateway.test/with space']) {
    expect(baseUrlSchema.safeParse(value).success, value).toBe(false);
  }
  expect(nativeDeepSeek({ providerId: 'custom', baseUrl: 'https://api.deepseek.com' })).toBe(false);
  expect(nativeDeepSeek({ providerId: 'deepseek', baseUrl: 'https://gateway.test/v1' })).toBe(false);
});

test('switching a connection clears credentials/models; discovery uses its own URL and marks vision unsupported', async () => {
  const requests: { url: string; auth: string | null }[] = [];
  const f = setup(async (url, init) => {
    requests.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
    return Response.json({ data: [{ id: 'org/model', input_modalities: ['text', 'image'] }] });
  });
  let view = await f.service.command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key });
  view = await f.service.command({ type: 'provider.configure', ...connection, expectedRevision: view.revision });
  expect(view).toMatchObject({ hasKey: false, models: [], defaultModelId: null });
  await expect(f.service.command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: view.revision, key })).rejects.toMatchObject({ code: 'revision-conflict' });
  view = await f.service.command({ type: 'provider.save-key', providerId: 'siliconflow', expectedRevision: view.revision, key: 'NEW_PROVIDER_KEY' });
  view = await f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  expect(requests).toEqual([{ url: `${connection.baseUrl}/models`, auth: 'Bearer NEW_PROVIDER_KEY' }]);
  expect(view.models).toEqual([]);
  expect(view.catalog![0]).toMatchObject({ id: 'org/model', vision: 'unsupported' });
  const reopened = createProviderService(f.storage);
  expect(await reopened.command({ type: 'provider.query' })).toEqual(view);
  expect(JSON.stringify(view)).not.toContain('NEW_PROVIDER_KEY');
});

test('denied host permission leaves the old connection intact and never dispatches a request', async () => {
  const fetch = vi.fn(); const f = setup(fetch, async () => false);
  const before = await f.service.command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key });
  await expect(f.service.command({ type: 'provider.configure', ...connection, expectedRevision: before.revision })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(await f.service.command({ type: 'provider.query' })).toEqual(before);
  expect(fetch).not.toHaveBeenCalled();
});

test('manual model works without discovery; failed discovery preserves it; echoed credentials are rejected', async () => {
  const f = setup(async () => new Response('', { status: 404 }));
  let view = await f.service.command({ type: 'provider.configure', ...connection, expectedRevision: 0 });
  view = await f.service.command({ type: 'provider.save-key', providerId: 'siliconflow', expectedRevision: view.revision, key });
  await expect(f.service.command({ type: 'provider.add-model', modelId: key, expectedRevision: view.revision })).rejects.toMatchObject({ code: 'invalid-message' });
  view = await f.service.command({ type: 'provider.add-model', modelId: 'org/manual-model', expectedRevision: view.revision });
  expect(view).toMatchObject({ defaultModelId: 'org/manual-model', models: [{ id: 'org/manual-model', vision: 'unsupported' }] });
  view = await f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  expect(view.status).toBe('unavailable'); expect(view.defaultModelId).toBe('org/manual-model'); expect(view.models).toHaveLength(1);
});

test('a late list for the old endpoint cannot overwrite a newly configured connection', async () => {
  let finish!: (response: Response) => void;
  const f = setup(async () => new Promise(resolve => { finish = resolve; }));
  let view = await f.service.command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key });
  const pending = f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  view = await f.service.command({ type: 'provider.query' });
  view = await f.service.command({ type: 'provider.configure', ...connection, expectedRevision: view.revision });
  finish(Response.json({ data: [{ id: 'late-model' }] }));
  expect(await pending).toEqual(view); expect(view.hasKey).toBe(false); expect(view.models).toEqual([]);
});

test('generic streaming omits DeepSeek parameters/JSON extensions and leaves unknown output capacity to the service', async () => {
  for (const native of [false, true]) {
    let request: any;
    const config = native ? { providerId: 'deepseek' as const } : connection;
    const endpoint = providerCompletionEndpoint(config);
    const port = createProviderPort(key, async (url, init) => { expect(url).toBe(endpoint); request = JSON.parse(init!.body as string); return sse('complete'); }, endpoint, undefined, config);
    let output = '';
    await port.stream('model', [{ role: 'user', content: 'hello' }], new AbortController().signal, async text => { output += text; }, 'html-page');
    expect(output).toBe('complete'); expect(request.max_tokens).toBe(native ? 393216 : undefined);
    expect(request.thinking).toEqual(native ? { type: 'disabled' } : undefined);
    expect(request.stream_options).toEqual(native ? { include_usage: true } : undefined);
    await port.stream('model', [{ role: 'user', content: 'json' }], new AbortController().signal, async () => {}, 'requirements-plan');
    expect(request.response_format).toEqual(native ? { type: 'json_object' } : undefined);
  }
});

test('connection identity survives backup and prevents retry dispatch to another endpoint with the same model ID', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), store = new IndexedGenerationStore(name);
  const space = await spaces.open({ platform: 'bilibili', videoId: 'fixture', partId: '1', title: 'Fixture' });
  await spaces.save(space.id, 0, { ...space.draft, text: 'question', modelId: 'shared-model' }, space.chatId);
  const binding = { platform: 'bilibili' as const, videoId: 'fixture', partId: '1', tabId: 1, documentId: 'fixture', epoch: 1 };
  const basis = { binding, locator: 'fixture', fingerprint: 'fixture', language: 'zh', cueCount: 1 };
  const target = { kind: 'chat' as const, workspaceId: space.id, chatId: space.chatId };
  const job = await store.freezeChat(target, 1, basis, false, false, undefined, false, connection);
  await store.finish(job.jobId, job.attempts[0].attemptId, 'stopped');
  const backup = new IndexedBackupStore(name), file = await backup.export();
  expect(JSON.parse(file).payload.jobs[0].snapshot.providerConnection).toEqual(connection);
  const dest = crypto.randomUUID(), imported = new IndexedBackupStore(dest), plan = await imported.preview(file);
  await imported.execute(plan.planId, plan.checksum);
  expect((await new IndexedGenerationStore(dest).get(job.jobId))!.snapshot.providerConnection).toEqual(connection);
  const host = { create: vi.fn(), navigate: vi.fn(), exists: async () => false, close: async () => {} };
  const provider = { command: async () => ({ providerId: 'deepseek' as const, revision: 0, hasKey: true, models: [{ id: 'shared-model', name: 'Shared', text: 'unknown' as const, vision: 'declared' as const, web: 'unknown' as const }], defaultModelId: 'shared-model', status: 'ready' as const }) };
  const service = createTaskService(store, spaces, provider, async () => ({ status: 'unsupported', cues: [], binding: null, language: null }), host, 'fixture', () => {});
  await expect(service.command({ type: 'generation.retry', jobId: job.jobId })).rejects.toMatchObject({ code: 'model-unavailable' });
  expect(host.create).not.toHaveBeenCalled();
  expect(sameProviderConnection(undefined, { providerId: 'deepseek' })).toBe(true);
  expect(sameProviderConnection(undefined, connection)).toBe(false);
});

test('backend rejects third-party web/vision even if its model list declares images or contains deepseek-flash', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), store = new IndexedGenerationStore(name);
  const space = await spaces.open({ platform: 'bilibili', videoId: 'fixture', partId: '1', title: 'Fixture' });
  const host = { create: vi.fn(), navigate: vi.fn(), exists: async () => false, close: async () => {} };
  const provider = { command: async () => ({ ...connection, revision: 0, hasKey: true, models: [{ id: 'deepseek-flash', name: 'Shared', text: 'unknown' as const, vision: 'declared' as const, web: 'unknown' as const }], defaultModelId: 'deepseek-flash', status: 'ready' as const }) };
  const service = createTaskService(store, spaces, provider, async () => ({ status: 'unsupported', cues: [], binding: null, language: null }), host, 'fixture', () => {});
  await expect(service.command({ type: 'generation.subtitle.send', target: { kind: 'subtitle', workspaceId: space.id, operation: 'enhance' }, subtitleWorkflow: 2, webEnabled: true, modelId: 'deepseek-flash', targetLanguage: null })).rejects.toMatchObject({ code: 'web-unsupported' });
  await spaces.save(space.id, 0, { ...space.draft, text: 'look at frames', modelId: 'deepseek-flash', visionEnabled: true }, space.chatId);
  await expect(service.command({ type: 'generation.send', target: { kind: 'chat', workspaceId: space.id, chatId: space.chatId }, expectedRevision: 1 })).rejects.toMatchObject({ code: 'unsupported-capability' });
  expect(host.create).not.toHaveBeenCalled();
});

test('discovery is deduplicated and never imports models; only selected models can be applied', async () => {
  const f = setup(async () => Response.json({ data: [{ id: 'org/a', name: 'Same name' }, { id: 'org/a', name: 'Same name' }, { id: 'org/b', name: 'Same name' }] }));
  let view = await f.service.command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key });
  view = await f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  expect(view.catalog!.map(model => model.id)).toEqual(['org/a', 'org/b']);
  expect(view.models).toEqual([]); expect(view.defaultModelId).toBeNull();
  await expect(f.service.command({ type: 'provider.default', modelId: 'org/a', expectedRevision: view.revision })).rejects.toMatchObject({ code: 'model-unavailable' });
  await expect(f.service.command({ type: 'provider.import-models', modelIds: ['invented'], expectedRevision: view.revision })).rejects.toMatchObject({ code: 'model-unavailable' });
  view = await f.service.command({ type: 'provider.import-models', modelIds: ['org/b'], expectedRevision: view.revision });
  expect(view.models.map(model => model.id)).toEqual(['org/b']); expect(view.defaultModelId).toBe('org/b');
  await expect(f.service.command({ type: 'provider.default', modelId: 'org/a', expectedRevision: view.revision })).rejects.toMatchObject({ code: 'model-unavailable' });
  view = await f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  expect(view.models.map(model => model.id)).toEqual(['org/b']);
});

test('multiple keys retain separate names and imported models and can be switched without rediscovery', async () => {
  let calls = 0;
  const f = setup(async () => { calls++; return Response.json({ data: [{ id: 'org/a' }, { id: 'org/b' }] }); });
  let view = await f.service.command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key });
  const firstId = view.profileId!;
  view = await f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.import-models', modelIds: ['org/a'], expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.rename-profile', label: 'Primary account', expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.save-key', providerId: 'deepseek', key: 'ANOTHER_SYNTHETIC_KEY', expectedRevision: view.revision });
  const secondId = view.profileId!;
  expect(secondId).not.toBe(firstId); expect(view.models).toEqual([]); expect(view.catalog).toEqual([]);
  view = await f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.import-models', modelIds: ['org/b'], expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.select-profile', profileId: firstId, expectedRevision: view.revision });
  expect(view).toMatchObject({ profileLabel: 'Primary account', defaultModelId: 'org/a', models: [{ id: 'org/a' }] });
  expect(JSON.stringify(view)).not.toContain(key); expect(JSON.stringify(view)).not.toContain('ANOTHER_SYNTHETIC_KEY');
  expect((await f.storage.read() as any).key).toBe(key);
  expect(calls).toBe(2);
  const reopened = createProviderService(f.storage);
  expect(await reopened.command({ type: 'provider.query' })).toEqual(view);
  view = await reopened.command({ type: 'provider.delete-key', expectedRevision: view.revision });
  expect(view.profiles!.map(profile => profile.id)).toEqual([secondId]);
  view = await reopened.command({ type: 'provider.select-profile', profileId: secondId, expectedRevision: view.revision });
  expect(view.defaultModelId).toBe('org/b');
  expect(sameProviderConnection({ ...connection, profileId: firstId }, { ...connection, profileId: secondId })).toBe(false);
});

test('legacy key migration persists the new profile identity and keeps previously usable models imported', async () => {
  let record: any = { providerId: 'deepseek', revision: 12, key, models: [{ id: 'legacy', name: 'Legacy', text: 'unknown', vision: 'unknown', web: 'unknown' }], defaultModelId: 'legacy', status: 'ready' };
  const storage = { async read() { return structuredClone(record); }, async write(value: unknown) { record = structuredClone(value); } };
  const first = await createProviderService(storage).command({ type: 'provider.query' });
  expect(first.profileId).toBe(record.profileId); expect(first.models[0].id).toBe('legacy');
  expect(first.profiles).toHaveLength(1); expect(first.profiles![0].modelCount).toBe(1);
  expect(await createProviderService(storage).command({ type: 'provider.query' })).toEqual(first);
});

test('a combined model choice atomically applies the correct provider and Key even when model IDs match', async () => {
  const f = setup(async () => Response.json({ data: [{ id: 'org/shared', name: 'Same model' }, { id: 'org/hidden' }] }));
  let view = await f.service.command({ type: 'provider.configure', ...connection, expectedRevision: 0 });
  view = await f.service.command({ type: 'provider.save-key', providerId: 'siliconflow', key, expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.import-models', modelIds: ['org/shared'], expectedRevision: view.revision });
  const firstId = view.profileId!;
  view = await f.service.command({ type: 'provider.configure', providerId: 'bailian', baseUrl: providerDirectory[1].baseUrl, expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.save-key', providerId: 'bailian', key: 'SYNTHETIC_BAILIAN_KEY', expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.import-models', modelIds: ['org/shared'], expectedRevision: view.revision });
  const secondId = view.profileId!;
  const choices = importedModelOptions(view);
  expect(choices).toHaveLength(2);
  expect(choices.map(choice => choice.value)).toEqual([`${firstId}:org/shared`, `${secondId}:org/shared`]);
  expect(choices[0].label).toContain('硅基流动'); expect(choices[1].label).toContain('阿里云百炼');
  expect(choices.every(choice => choice.modelId !== 'org/hidden')).toBe(true);
  const write = vi.spyOn(f.storage, 'write');
  const before = view;
  await expect(f.service.command({ type: 'provider.select-model', profileId: firstId, modelId: 'org/hidden', expectedRevision: view.revision })).rejects.toMatchObject({ code: 'model-unavailable' });
  expect(await f.service.command({ type: 'provider.query' })).toEqual(before); expect(write).not.toHaveBeenCalled();
  view = await f.service.command({ type: 'provider.select-model', profileId: firstId, modelId: 'org/shared', expectedRevision: view.revision });
  expect(write).toHaveBeenCalledTimes(1);
  expect(view).toMatchObject({ providerId: 'siliconflow', baseUrl: connection.baseUrl, profileId: firstId, defaultModelId: 'org/shared', revision: before.revision + 1 });
  expect((await f.storage.read() as any).key).toBe(key);
  await expect(f.service.command({ type: 'provider.select-model', profileId: secondId, modelId: 'org/shared', expectedRevision: before.revision })).rejects.toMatchObject({ code: 'revision-conflict' });
  const reopened = createProviderService(f.storage);
  expect(await reopened.command({ type: 'provider.query' })).toEqual(view);
  view = await reopened.command({ type: 'provider.select-model', profileId: secondId, modelId: 'org/shared', expectedRevision: view.revision });
  expect(view).toMatchObject({ providerId: 'bailian', profileId: secondId, defaultModelId: 'org/shared' });
  expect((await f.storage.read() as any).key).toBe('SYNTHETIC_BAILIAN_KEY');
  expect(JSON.stringify(view)).not.toContain('SYNTHETIC_BAILIAN_KEY');
});

test('combined choices distinguish multiple Keys at the same provider and exclude unsupported text models', async () => {
  const f = setup(async () => Response.json({ data: [{ id: 'org/shared' }, { id: 'image-only', input_modalities: ['image'] }] }));
  let view = await f.service.command({ type: 'provider.save-key', providerId: 'deepseek', key, expectedRevision: 0 });
  view = await f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.import-models', modelIds: ['org/shared', 'image-only'], expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.save-key', providerId: 'deepseek', key: 'SYNTHETIC_OTHER_ACCOUNT', expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  view = await f.service.command({ type: 'provider.import-models', modelIds: ['org/shared'], expectedRevision: view.revision });
  const choices = importedModelOptions(view);
  expect(choices).toHaveLength(2); expect(choices[0].label).toContain('DeepSeek 1'); expect(choices[1].label).toContain('DeepSeek 2');
  await expect(f.service.command({ type: 'provider.select-model', profileId: view.profiles![0].id, modelId: 'image-only', expectedRevision: view.revision })).rejects.toMatchObject({ code: 'model-unavailable' });
});
