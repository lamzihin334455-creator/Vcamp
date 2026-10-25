import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { IndexedScribbleStore } from '../../src/data/scribble-store';
import { IndexedCacheStore } from '../../src/data/cache-store';
import { databaseTransaction } from '../../src/data/database';

test('only explicit rebuildable CacheEntry rows are cleaned; concrete favorites protect all Ps of a stable video and durable data survives', async () => {
  const name = crypto.randomUUID(), now = Date.now(), old = now - 60 * 86400000;
  const spaces = new IndexedWorkspaceStore(name), library = new IndexedLibraryStore(name), scribbles = new IndexedScribbleStore(name), cache = new IndexedCacheStore(name, () => now);
  const a = await spaces.open({ platform: 'bilibili', videoId: 'protected', partId: '1', title: '课程' });
  await spaces.open({ platform: 'bilibili', videoId: 'protected', partId: '2', title: '第二P' });
  const note = await scribbles.create(a.id, '长期资料', 2), folder = await library.createFolder('课程');
  await library.addFavorite(folder.id, { workspaceId: a.id, entityType: 'scribble', id: note.id });
  // Public cache interface is currently used by tests only; no production writers.
  await cache.put({ id: 'protected-cache', platform: 'bilibili', videoId: 'protected', kind: 'derived-preview', data: new Uint8Array(100), lastAccessedAt: old });
  await cache.put({ id: 'cleanable', platform: 'bilibili', videoId: 'unvisited', kind: 'video-metadata', data: new Uint8Array(7), lastAccessedAt: old });
  const plan = await cache.preview({ olderThanDays: 30, types: ['derived-preview', 'video-metadata'] });
  expect(plan).toMatchObject({ count: 1, bytes: 7, videoCount: 1 });
  expect(await cache.execute(plan.planId)).toEqual({ count: 1, bytes: 7, videoCount: 1 });
  expect(await cache.execute(plan.planId)).toEqual({ count: 1, bytes: 7, videoCount: 1 }); // receipt, never counts a second deletion
  expect((await cache.inventory()).count).toBe(1);
  expect((await scribbles.list(a.id))[0].text).toBe('长期资料');
  expect((await library.query('', 'all')).favorites).toHaveLength(1);
  expect((await spaces.read(a.id))!.chatId).toBe(a.chatId);
});

test('v6 to v7 adds only temporary cache stores and retains every durable row, deletion flag and favorite relation verbatim', async () => {
  const name = crypto.randomUUID(), tables = ['workspaces', 'jobs', 'subtitleVersions', 'artifacts', 'noteRevisions', 'templates', 'templateRevisions', 'scribbles', 'folders', 'favorites'];
  const rows = tables.map((table, i) => ({ id: `v6-${i}`, jobId: `v6-${i}`, revisionId: `v6-${i}`, deleted: true, sentinel: table, nested: { text: '保留原ID、来源、草稿、快照和收藏' } }));
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 6);
    request.onupgradeneeded = () => tables.forEach(table => request.result.createObjectStore(table, { keyPath: table === 'jobs' ? 'jobId' : table === 'templateRevisions' ? 'revisionId' : 'id' }));
    request.onsuccess = () => { const db = request.result, tx = db.transaction(tables, 'readwrite'); tables.forEach((table, i) => tx.objectStore(table).add(rows[i])); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
  });
  expect(await new IndexedCacheStore(name).inventory()).toEqual({ count: 0, bytes: 0, videoCount: 0 });
  const preserved = await databaseTransaction(name, tables, 'readonly', (tx, done) => {
    const values: unknown[] = []; let left = tables.length;
    for (const [i, table] of tables.entries()) { const request = tx.objectStore(table).getAll(); request.onsuccess = () => { values[i] = request.result[0]; if (!--left) done(values); }; }
    expect(tx.db.version).toBe(10);
  });
  expect(preserved).toEqual(rows);
});

test('new concrete favorite, recent workspace/cache access, cache replacement and elapsed expiry invalidate a preview before any deletion', async () => {
  const name = crypto.randomUUID(), now = Date.now(), old = now - 60 * 86400000;
  const spaces = new IndexedWorkspaceStore(name), library = new IndexedLibraryStore(name), scribbles = new IndexedScribbleStore(name);
  let clock = now; const cache = new IndexedCacheStore(name, () => clock);
  const source = { platform: 'bilibili' as const, videoId: 'preview', partId: '1', title: '预览保护' };
  const date = vi.spyOn(Date, 'now').mockReturnValue(old);
  const space = await spaces.open(source); date.mockRestore();
  const note = await scribbles.create(space.id, '具体收藏', null), folder = await library.createFolder('保护');
  const value = { id: 'entry', platform: 'bilibili' as const, videoId: 'preview', kind: 'derived-preview' as const, data: new Uint8Array(8), lastAccessedAt: old };
  await cache.put(value);
  const plan = await cache.preview(); expect(plan.count).toBe(1);
  const target = { workspaceId: space.id, entityType: 'scribble' as const, id: note.id };
  await library.addFavorite(folder.id, target);
  await expect(cache.execute(plan.planId)).rejects.toMatchObject({ code: 'plan-expired' });
  expect((await cache.inventory()).bytes).toBe(8);
  await library.removeFavorite(folder.id, target);
  const accessed = await cache.preview(); await cache.touch('entry');
  await expect(cache.execute(accessed.planId)).rejects.toMatchObject({ code: 'plan-expired' });
  await cache.put({ ...value, data: new Uint8Array(9) }, 2);
  const visited = await cache.preview(); await spaces.open(source);
  await expect(cache.execute(visited.planId)).rejects.toMatchObject({ code: 'plan-expired' });
  const bare = { ...value, id: 'bare', videoId: 'unvisited' };
  await cache.put(bare);
  const replaced = await cache.preview(); await cache.put({ ...bare, data: new Uint8Array(12) }, 1);
  await expect(cache.execute(replaced.planId)).rejects.toMatchObject({ code: 'plan-expired' });
  const expired = await cache.preview(); clock += 11 * 60000;
  await expect(cache.execute(expired.planId)).rejects.toMatchObject({ code: 'plan-expired' });
  expect((await cache.inventory()).count).toBe(2);
});

test('cleanup failure rolls back its deletes and accounting; retry returns the actual committed byte count', async () => {
  const name = crypto.randomUUID(), old = Date.now() - 60 * 86400000, cache = new IndexedCacheStore(name);
  for (const [id, size] of [['one', 3], ['two', 5]] as const) await cache.put({ id, platform: 'bilibili', videoId: id, kind: 'derived-preview', data: new Uint8Array(size), lastAccessedAt: old });
  const plan = await cache.preview(), original = IDBObjectStore.prototype.delete;
  const fault = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function(this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
    if (key === 'two') throw new DOMException('fixture delete failure', 'UnknownError');
    return original.call(this, key);
  });
  await expect(cache.execute(plan.planId)).rejects.toMatchObject({ code: 'storage-failed' }); fault.mockRestore();
  expect(await cache.inventory()).toEqual({ count: 2, bytes: 8, videoCount: 2 });
  expect(await cache.execute(plan.planId)).toEqual({ count: 2, bytes: 8, videoCount: 2 });
  expect(await cache.inventory()).toEqual({ count: 0, bytes: 0, videoCount: 0 });
});
