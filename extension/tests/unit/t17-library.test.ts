import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { createMessageRouter } from '../../src/app/message-router';
import { createLibraryService } from '../../src/library/service';
import { IndexedScribbleStore } from '../../src/data/scribble-store';

test('title-only search groups stable video identities, separating parts and duplicate titles', async () => {
  const name = `library-${crypto.randomUUID()}`, spaces = new IndexedWorkspaceStore(name), library = new IndexedLibraryStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'BVone', partId: '11', title: '共同标题 · P1 秘密章节' };
  const scribbles = new IndexedScribbleStore(name);
  for (const video of [source, { ...source, partId: '12', title: '共同标题 · P2 第二章' }, { ...source, videoId: 'BVtwo', title: '共同标题' }]) {
    const space = await spaces.open(video);
    await scribbles.create(space.id, '已保存资料', null);
  }
  const rows = (await library.query('共同标题')).videos;
  expect(rows).toHaveLength(2);
  expect(rows.find(row => row.videoId === 'BVone')?.parts).toHaveLength(2);
  expect((await library.query('秘密章节')).videos).toEqual([]);
  expect((await library.query('BVone')).videos).toEqual([]);
});

test('revisiting an existing interactive space moves it to recent; read-only browsing does not', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), library = new IndexedLibraryStore(name);
  const clock = vi.spyOn(Date, 'now');
  try {
    const source = { platform: 'bilibili' as const, videoId: 'BVa', partId: '11', title: 'A' };
    clock.mockReturnValue(100); const a = await spaces.open(source);
    await new IndexedScribbleStore(name).create(a.id, 'A 随笔', null);
    clock.mockReturnValue(200); const b = await spaces.open({ ...source, videoId: 'BVb', title: 'B' });
    await new IndexedScribbleStore(name).create(b.id, 'B 随笔', null);
    clock.mockReturnValue(300); await spaces.open(source);
    expect((await library.query()).videos.map(row => row.videoId)).toEqual(['BVa', 'BVb']);
    clock.mockReturnValue(400); await library.detail(a.id);
    expect((await library.query()).videos[0].parts[0].recentAt).toBe(300);
  } finally { clock.mockRestore(); }
});

test('controlled video open uses saved position or explicit reference time and never substitutes an invalid object', async () => {
  const name = `open-${crypto.randomUUID()}`, spaces = new IndexedWorkspaceStore(name), store = new IndexedLibraryStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'BVone', partId: '11', title: '视频', pageNumber: 2 };
  const space = await spaces.open(source);
  await store.recordObservation(source, 31, 100);
  const opened: { source: unknown; time: number }[] = [];
  const service = createLibraryService(store, async () => {}, async (source, time) => { opened.push({ source, time }); });
  const target = { workspaceId: space.id, entityType: 'workspace' as const, id: space.id };
  await service.command({ type: 'library.open', action: 'video', target });
  await service.command({ type: 'library.open', action: 'video', target, time: 9 });
  expect(opened).toEqual([{ source, time: 31 }, { source, time: 9 }]);
  await expect(service.command({ type: 'library.open', action: 'video', target: { ...target, entityType: 'scribble', id: 'missing' } })).rejects.toMatchObject({ code: 'not-found' });
  expect(opened).toHaveLength(2);
});

test('fixed library reader rejects cross-part and mutations, and viewing another Chat leaves recent Chat/draft intact', async () => {
  const name = `reader-${crypto.randomUUID()}`, spaces = new IndexedWorkspaceStore(name), library = new IndexedLibraryStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'BVone', partId: '11', title: '视频' };
  const a = await spaces.open(source), b = await spaces.createChat(a.id), other = await spaces.open({ ...source, partId: '12' });
  const router = createMessageRouter(spaces, 'test', async () => source, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { command: op => op.type === 'library.read' ? library.detail(op.workspaceId) : library.query() });
  const sender = { id: 'test', url: `chrome-extension://test/reader.html?library=1&workspaceId=${encodeURIComponent(a.id)}` };
  const handle = (operation: unknown) => router.handle({ version: 1, requestId: crypto.randomUUID(), operation }, sender);
  expect((await handle({ type: 'library.read', workspaceId: a.id })).ok).toBe(true);
  expect(await handle({ type: 'library.read', workspaceId: other.id })).toMatchObject({ ok: false, code: 'forbidden' });
  expect(await handle({ type: 'workspace.query', target: { workspaceId: a.id, chatId: a.chatId } })).toMatchObject({ ok: true, view: { chatId: a.chatId, draft: null } });
  expect(await handle({ type: 'workspace.query', target: { workspaceId: a.id, chatId: other.chatId } })).toMatchObject({ ok: false, code: 'forbidden' });
  expect(await handle({ type: 'chat.select', workspaceId: a.id, chatId: a.chatId })).toMatchObject({ ok: false, code: 'forbidden' });
  expect(await handle({ type: 'library.open', action: 'video', target: { workspaceId: a.id, entityType: 'workspace', id: a.id } })).toMatchObject({ ok: false, code: 'forbidden' });
  expect((await spaces.read(a.id))?.chatId).toBe(b.chatId);
  expect((await spaces.read(a.id))?.draft).toEqual(b.draft);
});

test('observed positions write back to original part, and late older observations cannot overwrite newer position', async () => {
  const name = `position-${crypto.randomUUID()}`, spaces = new IndexedWorkspaceStore(name), library = new IndexedLibraryStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'BVone', partId: '11', title: '视频' };
  const a = await spaces.open(source), b = await spaces.open({ ...source, partId: '12' });
  await library.recordObservation(source, 24, 200);
  await library.recordObservation(source, 8, 100);
  expect((await library.resolve({ workspaceId: a.id, entityType: 'workspace', id: a.id })).position).toBe(24);
  expect((await library.resolve({ workspaceId: b.id, entityType: 'workspace', id: b.id })).position).toBe(0);
  await library.detail(a.id);
  expect((await library.resolve({ workspaceId: a.id, entityType: 'workspace', id: a.id })).position).toBe(24);
});
