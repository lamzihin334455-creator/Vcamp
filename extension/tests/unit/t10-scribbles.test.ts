import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedScribbleStore } from '../../src/data/scribble-store';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { runChat } from '../../src/generation/run-chat';
import type { ChatRequestSnapshot } from '../../src/contracts/generation';

test('scribble overlay atomically restores complete original draft, preserves space ownership and never enters history or provider requests', async () => {
  const name = crypto.randomUUID(), notes = new IndexedScribbleStore(name), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'BVscribble', partId: '1', title: '随笔' };
  const a = await spaces.open(source), b = await spaces.open({ ...source, videoId: 'BVother' });
  const original = { ...a.draft, text: '原问题', modelId: 'fixture', outputType: 'chat' as const };
  await spaces.save(a.id, 0, { ...original, scribble: { text: '随笔秘密不进模型', time: 12.5 } });
  const row = await notes.create(a.id, '随笔秘密不进模型', 12.5, { chatId: a.chatId, expectedRevision: 1 });
  expect(row).not.toHaveProperty('chatId');
  expect((await spaces.read(a.id))!.draft).toEqual({ ...original, revision: 2 });
  expect(await notes.list(b.id)).toEqual([]);
  await expect(notes.save(b.id, row.id, 1, '越界')).rejects.toMatchObject({ code: 'not-found' });
  const edited = await notes.save(a.id, row.id, 1, '编辑秘密');
  expect((await new IndexedScribbleStore(name).list(a.id))[0]).toEqual(edited);
  await expect(notes.save(a.id, row.id, 1, '冲突')).rejects.toMatchObject({ code: 'revision-conflict' });
  const basis = { locator: 'fixture', fingerprint: 'fixture', language: 'zh', cueCount: 1, binding: { ...source, tabId: 1, documentId: 'doc', epoch: 1 } };
  const job = await tasks.freezeChat({ kind: 'chat', workspaceId: a.id, chatId: a.chatId }, 2, basis);
  expect(job.snapshot).toMatchObject({ historyProjection: [] });
  let input = '';
  await runChat(job.snapshot as ChatRequestSnapshot, [{ from: 0, to: 1, content: '字幕' }], { async stream(_model, messages) { input = JSON.stringify(messages); } }, new AbortController().signal, async () => {});
  expect(input).not.toContain('秘密'); expect(input).not.toContain('已创建随笔');
  const noChat = await notes.create(a.id, '无 Chat 也能保存', null);
  expect(noChat.workspaceId).toBe(a.id); expect(noChat).not.toHaveProperty('chatId');
  const { createMessageRouter } = await import('../../src/app/message-router');
  const router = createMessageRouter(spaces, 'extension', async () => source);
  const sender = { id: 'extension', frameId: 0, url: 'chrome-extension://extension/sidepanel.html', documentId: 'panel' };
  const query = () => router.handle({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'workspace.query', target: { workspaceId: a.id, chatId: a.chatId } } }, sender);
  expect(await query()).toMatchObject({ ok: true, view: { chatId: a.chatId } });
  await spaces.removeChat(a.id, a.chatId);
  const { createApplication } = await import('../../src/app/application');
  expect(await (await createApplication(spaces).openPanel(source)).query()).toMatchObject({ workspaceId: a.id, chatId: null, draft: null, chats: [] });
  expect(await query()).toMatchObject({ ok: true, view: { workspaceId: a.id, chatId: null, draft: null, chats: [] } });
  const independent = await notes.create(a.id, '删除唯一 Chat 后仍可记录', null);
  expect(independent.workspaceId).toBe(a.id);
});

test('fixed readonly scribble reader survives Chat deletion and refuses all writes and other entities', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), notes = new IndexedScribbleStore(name);
  const a = await spaces.open({ platform: 'bilibili', videoId: 'reader', partId: '1', title: 'reader' });
  const note = await notes.create(a.id, '独立随笔', null);
  await spaces.removeChat(a.id, a.chatId);
  const { createMessageRouter } = await import('../../src/app/message-router');
  const router = createMessageRouter(spaces, 'extension', async () => null, undefined, undefined, undefined, undefined, undefined, { async command(op) { return { scribbles: (await notes.list(op.workspaceId)).filter(row => op.type !== 'scribble.query' || !op.scribbleId || op.scribbleId === row.id) }; } });
  const sender = { id: 'extension', frameId: 0, url: `chrome-extension://extension/reader.html?workspaceId=${encodeURIComponent(a.id)}&scribbleId=${note.id}` };
  const handle = (operation: unknown) => router.handle({ version: 1, requestId: crypto.randomUUID(), operation }, sender);
  expect(await handle({ type: 'workspace.query' })).toMatchObject({ ok: true, view: { chatId: null, draft: null, scribbles: { scribbles: [note] } } });
  expect(await handle({ type: 'scribble.save', workspaceId: a.id, scribbleId: note.id, expectedRevision: 1, text: '伪造' })).toMatchObject({ ok: false, code: 'forbidden' });
  expect(await handle({ type: 'scribble.query', workspaceId: a.id, scribbleId: 'other' })).toMatchObject({ ok: false, code: 'forbidden' });
});

test('v4 upgrade preserves every old table verbatim while adding all v5 stores together', async () => {
  const name = crypto.randomUUID();
  const tables = [['workspaces', 'id'], ['jobs', 'jobId'], ['subtitleVersions', 'id'], ['artifacts', 'id'], ['noteRevisions', 'id']] as const;
  const rows = tables.map(([table, key]) => ({ [key]: table, draft: { text: '旧草稿', template: { revisionId: 'old' }, referenceIds: ['ref'] }, marker: table }));
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(name, 4); open.onerror = () => reject(open.error);
    open.onupgradeneeded = () => { tables.forEach(([table, keyPath]) => open.result.createObjectStore(table, { keyPath })); };
    open.onsuccess = () => { const tx = open.result.transaction(tables.map(([table]) => table), 'readwrite'); tables.forEach(([table], i) => tx.objectStore(table).put(rows[i])); tx.oncomplete = () => { open.result.close(); resolve(); }; };
  });
  const { databaseTransaction } = await import('../../src/data/database');
  const preserved = await databaseTransaction(name, tables.map(([table]) => table), 'readonly', (tx, done) => {
    const results: unknown[] = []; tables.forEach(([table], i) => { const req = tx.objectStore(table).getAll(); req.onsuccess = () => { results[i] = req.result[0]; if (i === tables.length - 1) done(results); }; });
    expect([...tx.db.objectStoreNames]).toEqual(expect.arrayContaining(['templates', 'templateRevisions', 'scribbles'])); expect(tx.db.version).toBe(10);
  });
  expect(preserved).toEqual(rows);
});

test('aborted scribble creation leaves the full overlay and original draft intact without an operation record', async () => {
  const name = crypto.randomUUID(), notes = new IndexedScribbleStore(name), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  const a = await spaces.open({ platform: 'bilibili', videoId: 'abort', partId: '1', title: 'abort' });
  const draft = { ...a.draft, text: '原文', outputType: 'markdown' as const, modelId: 'manual', template: { templateId: 'old-template', revisionId: 'old-version' }, referenceIds: ['r'], attachmentIds: ['a'], scribble: { text: '  保留空白\n随笔  ', time: null } };
  await spaces.save(a.id, 0, draft);
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (row, key) { if (this.name === 'scribbles') this.transaction.abort(); return original.call(this, row, key); };
  try { await expect(notes.create(a.id, draft.scribble.text, null, { chatId: a.chatId, expectedRevision: 1 })).rejects.toMatchObject({ code: 'storage-failed' }); }
  finally { IDBObjectStore.prototype.add = original; }
  expect(await notes.list(a.id)).toEqual([]);
  expect((await spaces.read(a.id))!.draft).toEqual({ ...draft, revision: 1 });
  expect((await tasks.view({ kind: 'chat', workspaceId: a.id, chatId: a.chatId })).messages).toEqual([]);
  const saved = await notes.create(a.id, draft.scribble.text, null, { chatId: a.chatId, expectedRevision: 1 });
  expect(saved.text).toBe(draft.scribble.text);
  const { scribble: _overlay, ...restored } = draft;
  expect((await spaces.read(a.id))!.draft).toEqual({ ...restored, revision: 2 });
});
