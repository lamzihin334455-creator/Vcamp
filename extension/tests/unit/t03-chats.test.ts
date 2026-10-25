import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { createApplication } from '../../src/app/application';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { createMessageRouter } from '../../src/app/message-router';
import legacy from '../fixtures/t03-v1-workspaces.json';
import { emptyDraft, draftSchema, type VideoKey } from '../../src/contracts/application';

const source = { platform: 'bilibili' as const, videoId: 'BVsame', partId: '10', title: '重复标题' };
async function seedV1(name: string) {
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('workspaces', { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('workspaces', 'readwrite');
      legacy.forEach(row => tx.objectStore('workspaces').add(row));
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onabort = () => { open.result.close(); reject(tx.error); };
    };
  });
}

test('A: two Chats keep independent drafts and reopening restores the recent Chat', async () => {
  const name = `t03-${crypto.randomUUID()}`;
  const app = createApplication(new IndexedWorkspaceStore(name));
  const panel = await app.openPanel(source);
  const a = await panel.query();
  await panel.command({ type: 'draft.save', expectedRevision: 0, draft: { ...a.draft!, text: 'A 草稿', outputType: 'markdown' } });
  const b = await panel.command({ type: 'chat.create', workspaceId: a.workspaceId! });
  expect(b.chatId).not.toBe(a.chatId);
  expect(b.draft?.text).toBe('');
  expect(b.chats).toHaveLength(2);
  await panel.command({ type: 'draft.save', expectedRevision: 0, draft: { ...b.draft!, text: 'B 草稿' } });
  expect(await panel.command({ type: 'chat.select', workspaceId: a.workspaceId!, chatId: a.chatId! }))
    .toMatchObject({ chatId: a.chatId, draft: { text: 'A 草稿', outputType: 'markdown', revision: 1 } });
  const reopened = await createApplication(new IndexedWorkspaceStore(name)).openPanel({ ...source, title: '标题改变' });
  expect(await reopened.query()).toMatchObject({ chatId: a.chatId, draft: { text: 'A 草稿' } });
});

test('A: versioned reference and attachment descriptions roundtrip and cannot claim another Chat', async () => {
  const panel = await createApplication(new IndexedWorkspaceStore(crypto.randomUUID())).openPanel(source);
  const a = await panel.query();
  const draft = { ...emptyDraft(), text: '描述夹具', outputType: 'html' as const,
    template: { templateId: 'template-a', revisionId: 'revision-3' },
    referenceIds: ['note-a'], attachmentIds: ['attachment-a'],
    references: [{ artifactId: 'note-a', workspaceId: a.workspaceId!, sourceChatId: a.chatId!, title: '当前 Chat 笔记', type: 'markdown' as const }],
    attachments: [{ attachmentId: 'attachment-a', workspaceId: a.workspaceId!, chatId: a.chatId!, name: '当前帧', mimeType: 'image/png', time: 12.5 }] };
  expect((await panel.command({ type: 'draft.save', expectedRevision: 0, draft })).draft).toEqual({ ...draft, revision: 1 });
  await expect(panel.command({ type: 'draft.save', expectedRevision: 1, draft: { ...draft, references: [{ ...draft.references[0], sourceChatId: 'foreign' }] } }))
    .rejects.toMatchObject({ code: 'forbidden' });
  expect((await panel.query()).draft).toEqual({ ...draft, revision: 1 });
});

test('B/A: a real v1 workspace fixture migrates without changing IDs, draft revisions or descriptors', async () => {
  const name = `t03-legacy-${crypto.randomUUID()}`;
  await seedV1(name);
  const app = createApplication(new IndexedWorkspaceStore(name));
  for (const row of legacy) {
    const panel = await app.openPanel(row.source as VideoKey);
    expect(await panel.query()).toMatchObject({ workspaceId: row.id, chatId: row.chatId, draft: row.draft });
    const saved = await panel.command({ type: 'draft.save', expectedRevision: row.draft.revision, draft: draftSchema.parse({ ...row.draft, text: '迁移后继续写' }) });
    expect(saved.draft).toMatchObject({ ...row.draft, text: '迁移后继续写', revision: row.draft.revision + 1 });
  }
});

test('B/A: aborted migration reports failure, then retry recovers every old workspace', async () => {
  const name = `t03-abort-upgrade-${crypto.randomUUID()}`;
  await seedV1(name);
  const original = IDBCursor.prototype.update;
  IDBCursor.prototype.update = function(value) {
    const request = original.call(this, value);
    (this.source as IDBObjectStore).transaction.abort();
    return request;
  };
  try {
    await expect(new IndexedWorkspaceStore(name).open(legacy[0].source as VideoKey)).rejects.toMatchObject({ code: 'storage-failed' });
  } finally { IDBCursor.prototype.update = original; }
  const app = createApplication(new IndexedWorkspaceStore(name));
  for (const row of legacy) {
    expect(await (await app.openPanel(row.source as VideoKey)).query())
      .toMatchObject({ workspaceId: row.id, chatId: row.chatId, draft: row.draft });
  }
});

test('A: windows select independently, delayed saves target the original Chat and foreign targets are rejected', async () => {
  let partId = '10';
  const router = createMessageRouter(new IndexedWorkspaceStore(crypto.randomUUID()), 'test', async () => ({ ...source, partId }));
  const sender = { id: 'test', url: 'chrome-extension://test/sidepanel.html', frameId: 0, documentId: 'window-a' };
  const request = async (operation: unknown, documentId = 'window-a') => {
    const result = await router.handle({ version: 1, requestId: crypto.randomUUID(), operation }, { ...sender, documentId });
    if (!result.ok) throw new Error(result.code);
    return result.view;
  };
  const a = await request({ type: 'workspace.query' });
  await request({ type: 'workspace.query' }, 'window-b');
  const b = await request({ type: 'chat.create', workspaceId: a.workspaceId });
  expect((await request({ type: 'workspace.query' }, 'window-b')).chatId).toBe(a.chatId);
  await request({ type: 'draft.save', target: { workspaceId: a.workspaceId, chatId: a.chatId }, expectedRevision: 0, draft: { ...a.draft!, text: 'A delayed' } });
  expect(await request({ type: 'workspace.query' })).toMatchObject({ chatId: b.chatId, draft: { text: '' } });
  expect(await request({ type: 'workspace.query' }, 'window-b')).toMatchObject({ chatId: a.chatId, draft: { text: 'A delayed' } });
  partId = '20';
  const other = await request({ type: 'workspace.query' });
  expect(other.workspaceId).not.toBe(a.workspaceId);
  await expect(request({ type: 'chat.select', workspaceId: other.workspaceId, chatId: a.chatId })).rejects.toThrow('forbidden');
  const reader = { ...sender, url: `chrome-extension://test/reader.html?workspaceId=${encodeURIComponent(a.workspaceId!)}&chatId=${a.chatId}` };
  expect(await router.handle({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'chat.create', workspaceId: a.workspaceId } }, reader)).toMatchObject({ ok: false, code: 'forbidden' });
  partId = '10';
  expect((await request({ type: 'workspace.query' })).chatId).toBe(b.chatId);
});
