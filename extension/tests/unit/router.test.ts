import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { createMessageRouter } from '../../src/app/message-router';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';

const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/sidepanel.html', frameId: 0 };
const query = () => ({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'workspace.query' } });
const setup = () => createMessageRouter(new IndexedWorkspaceStore(crypto.randomUUID()), sender.id, async () => null);

test('A: production unbound view has no invented workspace, Chat or draft', async () => {
  expect(await setup().handle(query(), sender)).toMatchObject({ ok: true, view: { workspaceId: null, chatId: null, draft: null } });
});
test.each([
  { ...sender, id: 'another-extension' },
  { ...sender, url: 'https://www.bilibili.com/video/test' },
  { ...sender, frameId: 1 },
  { ...sender, url: 'chrome-extension://test-extension/sandbox.html' },
  { ...sender, url: 'chrome-extension://spoof/sidepanel.html' },
  { ...sender, url: 'not a valid URL' },
  { ...sender, url: 'http://[malformed' }
])('A: untrusted sender receives no application data: %j', async untrusted => {
  expect(await setup().handle(query(), untrusted)).toMatchObject({ ok: false, code: 'forbidden' });
});

test('STD-01: valid query/save and readonly rejection do not require URL.canParse', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(URL, 'canParse')!;
  Object.defineProperty(URL, 'canParse', { configurable: true, value: undefined });
  try {
    const router = createMessageRouter(new IndexedWorkspaceStore(crypto.randomUUID()), sender.id,
      async () => ({ platform: 'bilibili', videoId: 'v', partId: 'p', title: '测试' }));
    const opened = await router.handle(query(), sender);
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('Expected workspace');
    const operation = { type: 'draft.save', expectedRevision: 0, draft: { ...opened.view.draft!, text: '兼容旧版' } };
    expect(await router.handle({ ...query(), operation }, sender)).toMatchObject({ ok: true, view: { draft: { text: '兼容旧版' } } });
    expect(await router.handle({ ...query(), operation }, { ...sender, url: `chrome-extension://${sender.id}/reader.html?workspaceId=${encodeURIComponent(opened.view.workspaceId!)}` })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await router.handle(query(), { ...sender, url: 'http://[malformed' })).toMatchObject({ ok: false, code: 'forbidden' });
    for (const untrusted of [
      { ...sender, id: 'wrong' }, { ...sender, url: 'https://example.com/sidepanel.html' },
      { ...sender, frameId: 1 }, { ...sender, url: 'chrome-extension://test-extension/sandbox.html' },
      { ...sender, url: 'chrome-extension://wrong/sidepanel.html' }, { id: sender.id }
    ]) expect(await router.handle(query(), untrusted)).toMatchObject({ ok: false, code: 'forbidden' });
  } finally { Object.defineProperty(URL, 'canParse', descriptor); }
});
test('A: caller cannot smuggle a capability, workspace or protocol version', async () => {
  const router = setup();
  for (const message of [{ ...query(), role: 'interactive' }, { ...query(), version: 2 }, { ...query(), operation: { type: 'workspace.query', workspaceId: 'other' } }]) {
    expect(await router.handle(message, sender)).toMatchObject({ ok: false, code: 'invalid-message' });
  }
});
