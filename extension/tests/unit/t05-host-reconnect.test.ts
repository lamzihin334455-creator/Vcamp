import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { createTaskService, type TaskHost } from '../../src/generation/task-service';
import { reconcileGeneration } from '../../src/app/use-generation';
import { createChromeClient } from '../../src/app/chrome-client';
import type { VideoView } from '../../src/contracts/video';
import type { ProviderService } from '../../src/contracts/provider';
import type { GenerationView } from '../../src/contracts/generation';

test('A/D seam: independent targets, verified boot, surviving executor across Worker restart, lost host interruption and changed-source retry refusal', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), store = new IndexedGenerationStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'BVhost', partId: 'A', title: 'A' };
  let video: VideoView = { status: 'ready', binding: { platform: 'bilibili', videoId: source.videoId, partId: source.partId, tabId: 1, documentId: 'doc', epoch: 1 }, language: 'zh', cues: [{ from: 0, to: 1, content: '完整字幕' }] };
  const tabs = new Map<number, string>(); let nextId = 10, navigations = 0;
  const host: TaskHost = { create: async () => ++nextId, navigate: async (tabId, jobId, attemptId) => { tabs.set(tabId, `${jobId}/${attemptId}`); navigations++; }, exists: async (tabId, jobId, attemptId) => tabs.get(tabId) === `${jobId}/${attemptId}`, close: async tabId => { tabs.delete(tabId); } };
  const provider: ProviderService = { command: async () => ({ providerId: 'deepseek', revision: 1, hasKey: true, models: [{ id: 'model-a', name: 'A', text: 'declared', vision: 'unknown', web: 'unknown' }], defaultModelId: 'model-a', status: 'ready' }) };
  const service = createTaskService(store, spaces, provider, async () => video, host, 'ext', () => {});
  const a = await spaces.open(source);
  await spaces.save(a.id, 0, { ...a.draft, text: '问题A', modelId: 'model-a' });
  const target = { kind: 'chat' as const, workspaceId: a.id, chatId: a.chatId };
  const view = await service.command({ type: 'generation.send', target, expectedRevision: 1, binding: video.binding! });
  const job = view.jobs[0], tab = 11;
  const sender = { id: 'ext', frameId: 0, tab: { id: tab }, url: `chrome-extension://ext/executor.html#${job.jobId}/${job.attemptId}` };
  await expect(service.boot(job.jobId, job.attemptId, { ...sender, url: 'https://evil.example/' })).rejects.toMatchObject({ code: 'forbidden' });
  expect(await service.boot(job.jobId, job.attemptId, sender)).toMatchObject({ cues: [{ content: '完整字幕' }] });
  expect(await store.claim(job.jobId, job.attemptId, tab)).not.toBeNull();
  video = { ...video, binding: { ...video.binding!, partId: 'B' } };
  const b = await spaces.open({ ...source, partId: 'B' });
  await spaces.save(b.id, 0, { ...b.draft, text: '问题B', modelId: 'model-a' });
  const second = await service.command({ type: 'generation.send', target: { ...target, workspaceId: b.id, chatId: b.chatId }, expectedRevision: 1, binding: video.binding! });
  expect(tabs.size).toBe(2);
  const c = await spaces.createChat(b.id);
  await spaces.save(c.id, 0, { ...c.draft, text: '排队的问题', modelId: 'model-a' }, c.chatId);
  const third = await service.command({ type: 'generation.send', target: { ...target, workspaceId: c.id, chatId: c.chatId }, expectedRevision: 1, binding: video.binding! });
  expect(third.jobs[0].state).toBe('queued'); expect(tabs.size).toBe(2);
  await service.command({ type: 'generation.stop', jobId: second.jobs[0].jobId });
  expect((await service.command({ type: 'generation.query', target: third.target })).jobs[0].state).toBe('preparing');
  expect(tabs.size).toBe(2);
  const restarted = createTaskService(store, spaces, provider, async () => video, host, 'ext', () => {});
  expect((await restarted.command({ type: 'generation.query', target })).jobs[0].state).toBe('running');
  expect(navigations).toBe(3); // no redispatch or new model invocation
  tabs.delete(tab); await restarted.removed(tab);
  expect((await restarted.command({ type: 'generation.query', target })).jobs[0].state).toBe('interrupted');
  await expect(restarted.command({ type: 'generation.retry', jobId: job.jobId })).rejects.toMatchObject({ code: 'source-changed' });
  expect(navigations).toBe(3);
});
test('A: full snapshots converge across duplicate/missing events and stale running response after completion', () => {
  const target = { kind: 'chat' as const, workspaceId: 'A', chatId: 'a' };
  const running: GenerationView = { target, messages: [], jobs: [{ jobId: crypto.randomUUID(), attemptId: crypto.randomUUID(), target, seq: 4, state: 'running', text: '部分', error: null, coverage: { total: 1, covered: 0, ranges: [] } }] };
  const completed: GenerationView = { ...running, jobs: [{ ...running.jobs[0], seq: 9, state: 'completed', text: '完整回答' }] };
  expect(reconcileGeneration(running, completed).jobs[0]).toMatchObject({ seq: 9, state: 'completed' });
  expect(reconcileGeneration(completed, running)).toEqual(completed);
  expect(reconcileGeneration(completed, completed)).toEqual(completed);
});
test('A: a real client registers first, queries after ack and reconciles a completion inside the ack/snapshot window', async () => {
  const events: string[] = [], messages: ((value: unknown) => void)[] = [];
  const target = { kind: 'chat' as const, workspaceId: 'A', chatId: 'a' }, jobId = crypto.randomUUID(), attemptId = crypto.randomUUID();
  let seq = 3, state: 'running' | 'completed' = 'running';
  const previous = globalThis.chrome;
  globalThis.chrome = { windows: { getCurrent: async () => ({ id: 1 }) }, runtime: {
    connect: () => { events.push('registered'); return { onMessage: { addListener: (listener: (value: unknown) => void) => messages.push(listener) }, onDisconnect: { addListener: () => {} }, disconnect: () => {} }; },
    sendMessage: async (request: { requestId: string }) => { events.push('snapshot'); state = 'completed'; seq = 8; return { version: 1, requestId: request.requestId, ok: true, view: { mode: 'interactive', workspaceId: null, chatId: null, title: '', draft: null, generation: { target, messages: [], jobs: [{ jobId, attemptId, target, seq, state, text: '答案', error: null, coverage: { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] } }] } } }; }
  } } as unknown as typeof chrome;
  try {
    const client = createChromeClient(false);
    let visible: GenerationView | null = null;
    let done!: () => void; const snapshot = new Promise<void>(resolve => { done = resolve; });
    const dispose = client.subscribe(() => { void client.generation!({ type: 'generation.query', target }).then(value => { visible = reconcileGeneration(visible, value); done(); }); }, status => events.push(status));
    expect(events).toEqual(['connecting', 'registered']);
    messages[0]({ version: 1, type: 'ready' }); await snapshot;
    expect(events.slice(2)).toEqual(['connected', 'snapshot']);
    expect((visible as unknown as GenerationView).jobs[0]).toMatchObject({ state: 'completed', seq: 8 });
    dispose();
  } finally { globalThis.chrome = previous; }
});
