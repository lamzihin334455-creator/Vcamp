import { expect, test, vi } from 'vitest';
import { fetchModelList } from '../../src/generation/model-list';
import { createProviderService } from '../../src/generation/provider-service';
import { createProviderPort } from '../../src/generation/provider-port';

const key = 'SYNTHETIC_SENSENOVA_KEY';
const signal = () => new AbortController().signal;

test('SenseNova compatible stream accepts an empty intermediate finish_reason but still requires completion', async () => {
  const connection = { providerId: 'sensenova' as const };
  const response = (complete: boolean) => new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '合成回答' }, finish_reason: '' }] })}\n\n${complete ? `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n` : ''}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  let output = '';
  const port = createProviderPort(key, async () => response(true), undefined, undefined, connection);
  await port.stream('deepseek-flash', [{ role: 'user', content: 'hello' }], signal(), async text => { output += text; });
  expect(output).toBe('合成回答');
  await expect(createProviderPort(key, async () => response(false), undefined, undefined, connection).stream('deepseek-flash', [{ role: 'user', content: 'hello' }], signal(), async () => {})).rejects.toMatchObject({ code: 'protocol' });
});

test('SenseNova mixed text/image-output catalogue does not reject the entire model list', async () => {
  const transport = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: [
    { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', input_modalities: ['text', 'image'], output_modalities: ['text'] },
    { id: 'sensenova-u1.5-lite', input_modalities: ['text', 'image'], output_modalities: ['image'] },
    { id: 'audio-model', input_modalities: ['audio'], output_modalities: ['audio'] }
  ] }));
  const models = await fetchModelList(key, transport, signal(), { providerId: 'custom', baseUrl: 'https://token.sensenova.cn/v1' });
  expect(models).toMatchObject([
    { id: 'deepseek-flash', text: 'declared', vision: 'unsupported' },
    { id: 'sensenova-u1.5-lite', text: 'unsupported' },
    { id: 'audio-model', text: 'unsupported' }
  ]);
  expect(transport.mock.calls[0][0]).toBe('https://token.sensenova.cn/v1/models');
});

test('SenseNova uppercase LIST/MODEL markers retain valid text models', async () => {
  const transport = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ object: 'LIST', data: [{ id: 'SenseChat-5', object: 'MODEL', permission: [{ allow_chat: true }] }] }));
  const models = await fetchModelList(key, transport, signal(), { providerId: 'custom', baseUrl: 'https://api.sensenova.cn/compatible-mode/v2' });
  expect(models[0]).toMatchObject({ id: 'SenseChat-5', text: 'unknown' });
  expect(transport.mock.calls[0][0]).toBe('https://api.sensenova.cn/v1/llm/models');
});

test('malformed lists still fail instead of treating an error or invented object type as models', async () => {
  for (const payload of [{ data: [{ id: 'valid', object: 'error' }] }, { data: [{ id: 'valid', input_modalities: 'text' }] }, { error: { message: 'No access' } }]) {
    await expect(fetchModelList(key, async () => Response.json(payload), signal())).rejects.toMatchObject({ status: 'protocol' });
  }
});

test('delete any saved connection atomically, including inactive empty and active failed connections', async () => {
  let record: any;
  const storage = { async read() { return structuredClone(record); }, async write(value: unknown) { record = structuredClone(value); } };
  const service = createProviderService(storage, async () => new Response('', { status: 500 }));
  let view = await service.command({ type: 'provider.save-key', providerId: 'deepseek', key: 'SYNTHETIC_PRIMARY', expectedRevision: 0 });
  const primary = view.profileId!;
  view = await service.command({ type: 'provider.configure', providerId: 'custom', baseUrl: 'https://example.test/v1', expectedRevision: view.revision });
  view = await service.command({ type: 'provider.save-key', providerId: 'custom', key: 'SYNTHETIC_WRONG_1', expectedRevision: view.revision });
  const wrong1 = view.profileId!;
  view = await service.command({ type: 'provider.save-key', providerId: 'custom', key: 'SYNTHETIC_WRONG_2', expectedRevision: view.revision });
  const wrong2 = view.profileId!;
  view = await service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  expect(view.status).toBe('unavailable');
  view = await service.command({ type: 'provider.delete-profile', profileId: wrong1, expectedRevision: view.revision });
  expect(view.profileId).toBe(wrong2); expect(record.key).toBe('SYNTHETIC_WRONG_2');
  expect(view.profiles!.map(p => p.id)).toEqual([primary, wrong2]);
  expect(JSON.stringify(record)).not.toContain('SYNTHETIC_WRONG_1');
  await expect(service.command({ type: 'provider.delete-profile', profileId: wrong2, expectedRevision: view.revision - 1 })).rejects.toMatchObject({ code: 'revision-conflict' });
  view = await service.command({ type: 'provider.delete-profile', profileId: wrong2, expectedRevision: view.revision });
  expect(view.profileId).toBe(primary); expect(record.key).toBe('SYNTHETIC_PRIMARY');
  expect(JSON.stringify(record)).not.toContain('SYNTHETIC_WRONG_2');
  expect(await createProviderService(storage).command({ type: 'provider.query' })).toEqual(view);
  await expect(service.command({ type: 'provider.delete-profile', profileId: wrong1, expectedRevision: view.revision })).rejects.toMatchObject({ code: 'not-found' });
  view = await service.command({ type: 'provider.delete-profile', profileId: primary, expectedRevision: view.revision });
  expect(view).toMatchObject({ hasKey: false, profiles: [], models: [], defaultModelId: null });
  expect(record.key).toBeNull(); expect(record.savedProfiles).toEqual([]);
});

test('deleting a fetching connection restores a usable default and a late response cannot resurrect its key', async () => {
  let record: any, finish!: (response: Response) => void;
  const storage = { async read() { return structuredClone(record); }, async write(value: unknown) { record = structuredClone(value); } };
  const service = createProviderService(storage, async () => new Promise(resolve => { finish = resolve; }));
  let view = await service.command({ type: 'provider.configure', providerId: 'custom', baseUrl: 'https://example.test/v1', expectedRevision: 0 });
  view = await service.command({ type: 'provider.save-key', providerId: 'custom', key: 'EMPTY_KEY', expectedRevision: view.revision });
  view = await service.command({ type: 'provider.save-key', providerId: 'custom', key: 'USABLE_KEY', expectedRevision: view.revision });
  const usable = view.profileId!;
  view = await service.command({ type: 'provider.add-model', modelId: 'valid-text', expectedRevision: view.revision });
  view = await service.command({ type: 'provider.save-key', providerId: 'custom', key: 'FETCHING_KEY', expectedRevision: view.revision });
  const removed = view.profileId!;
  const pending = service.command({ type: 'provider.fetch', expectedRevision: view.revision });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  view = await service.command({ type: 'provider.query' });
  view = await service.command({ type: 'provider.delete-profile', profileId: removed, expectedRevision: view.revision });
  expect(view).toMatchObject({ profileId: usable, defaultModelId: 'valid-text', models: [{ id: 'valid-text' }] });
  finish(Response.json({ data: [{ id: 'late-removed-model' }] }));
  expect(await pending).toEqual(view);
  expect(record.key).toBe('USABLE_KEY'); expect(JSON.stringify(record)).not.toContain('FETCHING_KEY');
});
