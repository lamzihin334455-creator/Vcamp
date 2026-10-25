import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { DEFAULT_LIBRARY_FOLDER_ID } from '../../src/contracts/library';
import { IndexedScribbleStore } from '../../src/data/scribble-store';
import { databaseTransaction } from '../../src/data/database';

test('multi-folder favorites deduplicate transactionally; removing and deleting folders only remove relations', async () => {
  const name = `favorites-${crypto.randomUUID()}`, spaces = new IndexedWorkspaceStore(name), library = new IndexedLibraryStore(name), notes = new IndexedScribbleStore(name);
  const space = await spaces.open({ platform: 'bilibili', videoId: 'BVone', partId: '11', title: '视频' });
  const note = await notes.create(space.id, '真实随笔', 9);
  const a = await library.createFolder('课程'), b = await library.createFolder('复习');
  const target = { workspaceId: space.id, entityType: 'scribble' as const, id: note.id };
  expect((await library.query('', 'all')).favorites).toEqual([]);
  await Promise.all([library.addFavorite(a.id, target), library.addFavorite(a.id, target)]);
  await library.addFavorite(b.id, target);
  expect((await library.query('', 'all')).favorites).toHaveLength(2);
  await library.removeFavorite(a.id, target);
  expect((await library.query('', a.id)).favorites).toHaveLength(0);
  await library.addFavorite(a.id, target);
  await library.deleteFolder(a.id, 1);
  expect((await library.query('', 'all')).favorites).toHaveLength(1);
  expect((await notes.list(space.id))[0].text).toBe('真实随笔');
  expect((await new IndexedLibraryStore(name).query('', b.id)).favorites?.[0].target).toEqual(target);
  await expect(library.addFavorite(b.id, { ...target, workspaceId: 'other' })).rejects.toMatchObject({ code: 'not-found' });
});

test('v5 migration retains all existing rows verbatim and adds only relation stores', async () => {
  const name = `v5-${crypto.randomUUID()}`;
  const tables = ['workspaces', 'jobs', 'subtitleVersions', 'artifacts', 'noteRevisions', 'templates', 'templateRevisions', 'scribbles'];
  const rows = tables.map((table, i) => ({ id: `old-${i}`, jobId: `old-${i}`, revisionId: `old-${i}`, sentinel: table, nested: { text: '保留旧草稿、快照和版本' } }));
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 5);
    request.onupgradeneeded = () => tables.forEach(table => request.result.createObjectStore(table, { keyPath: table === 'jobs' ? 'jobId' : table === 'templateRevisions' ? 'revisionId' : 'id' }));
    request.onsuccess = () => { const db = request.result, tx = db.transaction(tables, 'readwrite'); tables.forEach((table, i) => tx.objectStore(table).add(rows[i])); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
  });
  await new IndexedLibraryStore(name).createFolder('升级后文件夹');
  const preserved = await databaseTransaction(name, tables, 'readonly', (tx, done) => {
    const values: unknown[] = []; let remaining = tables.length;
    tables.forEach((table, i) => { const request = tx.objectStore(table).getAll(); request.onsuccess = () => { values[i] = request.result[0]; if (!--remaining) done(values); }; });
    expect(tx.db.version).toBe(10); expect([...tx.db.objectStoreNames]).toEqual(expect.arrayContaining(['folders', 'favorites']));
  });
  expect(preserved).toEqual(rows);
});

test('unavailable favorites remain explicit and cannot silently resolve another object', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), library = new IndexedLibraryStore(name);
  const a = await spaces.open({ platform: 'bilibili', videoId: 'BVone', partId: '11', title: '标题' });
  const folder = await library.createFolder('资料');
  const target = { workspaceId: a.id, entityType: 'chat' as const, id: a.chatId };
  await library.addFavorite(folder.id, target); await spaces.removeChat(a.id, a.chatId);
  expect((await library.query('', 'all')).favorites).toMatchObject([{ available: false, target }]);
  await expect(library.resolve(target)).rejects.toMatchObject({ code: 'not-found' });
  await library.renameFolder(folder.id, 1, '收藏');
  await expect(library.deleteFolder(folder.id, 1)).rejects.toMatchObject({ code: 'revision-conflict' });
});

test('every library has one protected default folder and direct favorites can target it without setup', async () => {
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),library=new IndexedLibraryStore(name);
  const space=await spaces.open({platform:'bilibili',videoId:'BVdefault',partId:'11',title:'默认收藏视频'});
  const target={workspaceId:space.id,entityType:'workspace' as const,id:space.id};
  const initial=await library.query();
  expect(initial.folders).toContainEqual(expect.objectContaining({id:DEFAULT_LIBRARY_FOLDER_ID,name:'默认文件夹'}));
  await library.addFavorite(DEFAULT_LIBRARY_FOLDER_ID,target);
  expect((await library.query('',DEFAULT_LIBRARY_FOLDER_ID)).favorites).toMatchObject([{folderId:DEFAULT_LIBRARY_FOLDER_ID,target}]);
  await expect(library.deleteFolder(DEFAULT_LIBRARY_FOLDER_ID,1)).rejects.toMatchObject({code:'forbidden'});
  await expect(library.renameFolder(DEFAULT_LIBRARY_FOLDER_ID,1,'不可改名')).rejects.toMatchObject({code:'forbidden'});
});
