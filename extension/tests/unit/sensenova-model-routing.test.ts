import { expect, test } from 'vitest';
import { createProviderService } from '../../src/generation/provider-service';
import { createProviderPort, providerCompletionEndpoint } from '../../src/generation/provider-port';
import { providerModelId } from '../../src/generation/provider-model-routing';

const key = 'SYNTHETIC_ROUTING_KEY';
const connection = { providerId: 'sensenova' as const };
const model = (id: string) => ({ id, name: id, text: 'unknown', vision: 'unsupported', web: 'unknown' });

test('a fetched SenseNova V4.1 model can be imported and called without typing an ID', async () => {
  let record: any;
  const service = createProviderService({ async read() { return record; }, async write(value) { record = structuredClone(value); } }, async () => Response.json({ data: [
    { id: 'deepseek-v4-flash' }, { id: 'deepseek-v4.1-flash' }, { id: 'deepseek-flash' }, { id: 'glm-5.2' }
  ] }));
  let view = await service.command({ type: 'provider.query' });
  view = await service.command({ type: 'provider.configure', ...connection, baseUrl: 'https://token.sensenova.cn/v1', expectedRevision: view.revision });
  view = await service.command({ type: 'provider.save-key', ...connection, key, expectedRevision: view.revision });
  view = await service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  const selected = view.catalog!.find(row => row.name.includes('V4.1'))!;
  expect(selected?.id).toBe('deepseek-flash');
  expect(view.catalog!.filter(row => /deepseek/.test(row.id)).map(row => row.id)).toEqual(['deepseek-v4-flash', 'deepseek-flash']);
  view = await service.command({ type: 'provider.import-models', modelIds: [selected.id], expectedRevision: view.revision });
  expect(view.defaultModelId).toBe('deepseek-flash');
  let called = '', output = '';
  const port = createProviderPort(key, async (_url, init) => {
    called = JSON.parse(init!.body as string).model;
    if (called !== 'deepseek-flash') return Response.json({ error: { code: 'forbidden' } }, { status: 403 });
    return new Response('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }, providerCompletionEndpoint(connection), undefined, connection);
  await port.stream(view.defaultModelId!, [{ role: 'user', content: '你好' }], new AbortController().signal, async text => { output += text; });
  expect(output).toBe('你好'); expect(called).toBe('deepseek-flash');
});

test('existing SenseNova V4.1 aliases are migrated once, deduplicated and old retries route correctly', async () => {
  const profileId = crypto.randomUUID();
  let record: any = { ...connection, revision: 7, key, models: [model('deepseek-v4.1-flash'), model('deepseek-flash')], catalog: [model('deepseek-v4.1-flash')], defaultModelId: 'deepseek-v4.1-flash', status: 'ready', profileId, profileLabel: '商汤', savedProfiles: [{ ...connection, id: profileId, label: '商汤', key, catalog: [model('deepseek-v4.1-flash')], models: [model('deepseek-v4.1-flash'), model('deepseek-flash')], defaultModelId: 'deepseek-v4.1-flash' }] };
  const service = createProviderService({ async read() { return structuredClone(record); }, async write(value) { record = structuredClone(value); } });
  const view = await service.command({ type: 'provider.query' });
  expect(view.models.map(row => row.id)).toEqual(['deepseek-flash']); expect(view.defaultModelId).toBe('deepseek-flash');
  expect(record.savedProfiles[0].models.map((row: any) => row.id)).toEqual(['deepseek-flash']);
  expect((await createProviderService({ async read() { return structuredClone(record); }, async write(value) { record = structuredClone(value); } }).command({ type: 'provider.query' })).revision).toBe(view.revision);
  let sent = '';
  const port = createProviderPort(key, async (_url, init) => { sent = JSON.parse(init!.body as string).model; return new Response('', { status: 429 }); }, providerCompletionEndpoint(connection), undefined, connection);
  await expect(port.stream('deepseek-v4.1-flash', [{ role: 'user', content: '你好' }], new AbortController().signal, async () => {})).rejects.toMatchObject({ code: 'rate-limit' });
  expect(sent).toBe('deepseek-flash');
});

test('routing is limited to the known SenseNova endpoint and never replaces V4 with V4.1', () => {
  expect(providerModelId(connection, 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
  expect(providerModelId({ providerId: 'custom', baseUrl: 'https://token.sensenova.cn/v1' }, 'deepseek-v4.1-flash')).toBe('deepseek-flash');
  for (const target of [{ providerId: 'bailian' as const }, { providerId: 'sensenova' as const, baseUrl: 'https://proxy.example/v1' }, { providerId: 'custom' as const, baseUrl: 'https://token.sensenova.cn.example/v1' }]) {
    expect(providerModelId(target, 'deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash');
  }
});
