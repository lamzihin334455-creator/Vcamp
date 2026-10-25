import { expect, test } from 'vitest';
import { createProviderService } from '../../src/generation/provider-service';
import { createCredentialStore } from '../../src/generation/credential-store';
import 'fake-indexeddb/auto';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { createMessageRouter } from '../../src/app/message-router';

const key = 'SYNTHETIC_KEY_ONLY';
function storage() {
  let values: Record<string, unknown> = {}; let trusted = false;
  return {
    async setAccessLevel(options: { accessLevel: string }) { trusted = options.accessLevel === 'TRUSTED_CONTEXTS'; },
    async get(name: string) { expect(trusted).toBe(true); return { [name]: values[name] }; },
    async set(next: Record<string, unknown>) { expect(trusted).toBe(true); values = structuredClone(next); }
  };
}
const models = () => new Response(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-text', object: 'model', owned_by: 'test', name: 'Synthetic text' }] }), { headers: { 'content-type': 'application/json' } });

test('B: restricted credentials persist across reopen, are never returned, and replacement/deletion take effect', async () => {
  const area = storage(); const headers: string[] = [];
  const transport: typeof fetch = async (url, init) => { expect(url).toBe('https://api.deepseek.com/models'); headers.push(new Headers(init?.headers).get('authorization')!); return models(); };
  let service = createProviderService(createCredentialStore(area), transport);
  let view = await service.command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key });
  expect(view.hasKey).toBe(true); expect(JSON.stringify(view)).not.toContain(key);
  service = createProviderService(createCredentialStore(area), transport);
  view = await service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  expect(view.models).toEqual([]);
  view = await service.command({ type: 'provider.import-models', expectedRevision: view.revision, modelIds: ['synthetic-text'] });
  expect(view.models[0].id).toBe('synthetic-text'); expect(view.models[0].vision).toBe('unknown');
  view = await service.command({ type: 'provider.default', expectedRevision: view.revision, modelId: 'synthetic-text' });
  view = await service.command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: view.revision, key: 'REPLACED_SYNTHETIC' });
  view = await service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  expect(headers).toEqual(['Bearer ' + key, 'Bearer REPLACED_SYNTHETIC']);
  view = await service.command({ type: 'provider.delete-key', expectedRevision: view.revision });
  expect(view.hasKey).toBe(false); expect(view.models).toEqual([]);
  expect((await service.command({ type: 'provider.fetch', expectedRevision: view.revision })).status).toBe('key-required');
  expect(headers).toHaveLength(2);
});

test('B: authentication, rate limit, empty and malformed lists are fixed retryable statuses, never response prose', async () => {
  for (const [response, status] of [
    [new Response(key, { status: 401 }), 'authentication'], [new Response(key, { status: 429 }), 'rate-limited'],
    [new Response(JSON.stringify({ object: 'list', data: [] }), { headers: { 'content-type': 'application/json' } }), 'empty'],
    [new Response(JSON.stringify({ object: 'list', data: [{ id: 7 }] }), { headers: { 'content-type': 'application/json' } }), 'protocol']
  ] as const) {
    let calls = 0;
    const service = createProviderService(createCredentialStore(storage()), async () => ++calls === 1 ? response : models());
    let view = await service.command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key });
    view = await service.command({ type: 'provider.fetch', expectedRevision: view.revision });
    expect(view.status).toBe(status); expect(JSON.stringify(view)).not.toContain(key);
    view = await service.command({ type: 'provider.fetch', expectedRevision: view.revision }); expect(view.status).toBe('ready');
  }
});

test('A/B: a late model list cannot overwrite a replacement key or a newer default selection', async () => {
  let finish!: (response: Response) => void;
  let pending = false;
  const service = createProviderService(createCredentialStore(storage()), async () => pending ? new Promise(resolve => { finish = resolve; }) : models());
  let view = await service.command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key });
  view = await service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  view = await service.command({ type: 'provider.import-models', expectedRevision: view.revision, modelIds: ['synthetic-text'] });
  pending = true;
  const load = service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  do { await new Promise(resolve => setTimeout(resolve, 0)); view = await service.command({ type: 'provider.query' }); } while (!finish);
  view = await service.command({ type: 'provider.default', expectedRevision: view.revision, modelId: 'synthetic-text' });
  finish(new Response(JSON.stringify({ object: 'list', data: [{ id: 'late-model' }] }), { headers: { 'content-type': 'application/json' } }));
  expect(await load).toEqual(view); expect(view.defaultModelId).toBe('synthetic-text');
  finish = undefined!;
  const second = service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  do { await new Promise(resolve => setTimeout(resolve, 0)); view = await service.command({ type: 'provider.query' }); } while (!finish);
  view = await service.command({ type: 'provider.delete-key', expectedRevision: view.revision }); finish(models());
  expect(await second).toEqual(view); expect(view.hasKey).toBe(false); expect(view.models).toEqual([]);
});

test('A: failed trusted-context restriction prevents credential reads and writes', async () => {
  let touched = false;
  const service = createProviderService(createCredentialStore({ async setAccessLevel() { throw Error(key); },
    async get() { touched = true; return {}; }, async set() { touched = true; } }));
  await expect(service.command({ type: 'provider.query' })).rejects.toMatchObject({ code: 'storage-failed' });
  expect(touched).toBe(false);
});

test('A: only the trusted panel can configure credentials; Chat selection keeps model and all draft fields', async () => {
  const store = new IndexedWorkspaceStore(crypto.randomUUID());
  const source = { platform: 'bilibili' as const, videoId: 'synthetic', partId: '1', title: 'Synthetic' };
  const provider = createProviderService(createCredentialStore(storage()), async () => models());
  const router = createMessageRouter(store, 'test-id', async () => source, undefined, provider);
  const trusted = { id: 'test-id', frameId: 0, url: 'chrome-extension://test-id/sidepanel.html' };
  const request = (operation: unknown) => ({ version: 1, requestId: crypto.randomUUID(), operation });
  const save = request({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key });
  for (const sender of [{ ...trusted, url: 'https://www.bilibili.com/video/synthetic' }, { ...trusted, frameId: 1 },
    { ...trusted, url: 'chrome-extension://test-id/reader.html' }, { ...trusted, url: 'chrome-extension://test-id/sandbox.html' }]) {
    expect(await router.handle(save, sender)).toMatchObject({ ok: false, code: 'forbidden' });
  }
  expect(await router.handle(save, trusted)).toMatchObject({ ok: true, view: { provider: { hasKey: true } } });
  expect(JSON.stringify(await router.handle(request({ type: 'provider.query' }), trusted))).not.toContain(key);
  const opened = await store.open(source);
  await store.save(opened.id, 0, { ...opened.draft, text: 'retained', modelId: 'old-explicit-model', referenceIds: ['note'],
    references: [{ artifactId: 'note', workspaceId: opened.id, sourceChatId: opened.chatId, title: 'description', type: 'markdown' }] }, opened.chatId);
  let view = await provider.command({ type: 'provider.query' });
  view = await provider.command({ type: 'provider.fetch', expectedRevision: view.revision });
  view = await provider.command({ type: 'provider.import-models', expectedRevision: view.revision, modelIds: ['synthetic-text'] });
  await provider.command({ type: 'provider.default', expectedRevision: view.revision, modelId: 'synthetic-text' });
  await store.createChat(opened.id);
  const selected = await router.handle(request({ type: 'chat.select', workspaceId: opened.id, chatId: opened.chatId }), trusted);
  expect(selected).toMatchObject({ ok: true, view: { draft: { modelId: 'old-explicit-model', text: 'retained', references: [{ title: 'description' }] } } });
});
