import 'fake-indexeddb/auto';
import {expect, test} from 'vitest';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedLibraryStore} from '../../src/data/library-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedScribbleStore} from '../../src/data/scribble-store';
import {IndexedSubtitleStore} from '../../src/data/subtitle-store';
import {IndexedManagementStore} from '../../src/data/management-store';
import {databaseTransaction} from '../../src/data/database';
import {DEFAULT_LIBRARY_FOLDER_ID, type LibraryTarget} from '../../src/contracts/library';

async function setup(videoId = 'BVretained') {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name);
  const source = {platform: 'bilibili' as const, videoId, partId: '11', title: '资料视频'};
  const space = await spaces.open(source);
  const tasks = new IndexedGenerationStore(name), library = new IndexedLibraryStore(name);
  const basis = {locator: 'native', fingerprint: 'fixture', language: 'zh', cueCount: 1,
    binding: {...source, tabId: 1, documentId: 'fixture', epoch: 1}};
  async function start(outputType: 'chat' | 'markdown' | 'html' = 'chat') {
    const current = (await spaces.read(space.id))!;
    await spaces.save(space.id, current.draft.revision, {...current.draft, text: '生成资料', modelId: 'fixture', outputType});
    const job = await tasks.freezeChat({kind: 'chat', workspaceId: space.id, chatId: space.chatId}, current.draft.revision + 1, basis, true);
    return job;
  }
  async function generate(type: 'chat' | 'markdown' | 'html' | 'enhance' | 'translate') {
    const job = type === 'enhance' || type === 'translate' ? await tasks.freezeSubtitle({snapshotId: crypto.randomUUID(),
      target: {kind: 'subtitle', workspaceId: space.id, operation: type}, source: {locator: 'native', fingerprint: 'fixture'},
      targetLanguage: type === 'translate' ? 'en' : null, requirements: '', modelId: 'fixture'}, basis) : await start(type);
    // A queued request/user prompt alone is not a saved result.
    expect((await library.query()).videos).toEqual([]);
    const attemptId = job.attempts[0].attemptId;
    await tasks.attach(job.jobId, attemptId, 1);
    const claimed = (await tasks.claim(job.jobId, attemptId, 1))!;
    const text = type === 'html' ? '<!doctype html><html><head><title>交互页面</title></head><body><h1>内容</h1></body></html>' : '# 已生成内容';
    await tasks.checkpoint(job.jobId, attemptId, claimed.seq + 1, text, {total: 1, covered: 1, ranges: [{firstCue: 0, lastCue: 0}]});
    const id = crypto.randomUUID();
    await tasks.finish(job.jobId, attemptId, 'completed', null, id,
      type === 'enhance' || type === 'translate' ? {kind: 'subtitle', cues: [{from: 0, to: 1, content: '已处理字幕'}]} : undefined);
    return id;
  }
  return {name, spaces, space, source, library, tasks, start, generate, management: new IndexedManagementStore(name), scribbles: new IndexedScribbleStore(name)};
}

test('browsing, saved positions, native track selections, empty chats and unsent drafts never enter recent, including existing rows after restart', async () => {
  const f = await setup();
  await f.library.recordObservation(f.source, 42, Date.now());
  await new IndexedSubtitleStore(f.name).select(f.space.id, 0, {kind: 'native', language: 'en'});
  await f.spaces.save(f.space.id, 0, {...f.space.draft, text: '尚未发送的重要草稿'});
  await f.spaces.createChat(f.space.id);
  await f.spaces.open({...f.source, videoId: 'BVbrowseOnly', coverUrl: 'https://i0.hdslb.com/bfs/archive/browse.jpg'});
  const reopened = new IndexedLibraryStore(f.name);
  expect((await reopened.query()).videos).toEqual([]);
  expect((await reopened.query('资料')).videos).toEqual([]);
  expect((await f.spaces.read(f.space.id, f.space.chatId))!.draft.text).toBe('尚未发送的重要草稿');
});

test.each(['chat', 'markdown', 'html', 'enhance', 'translate'] as const)('%s output alone retains the video across store restart', async type => {
  const f = await setup();
  await f.generate(type);
  expect((await new IndexedLibraryStore(f.name).query()).videos).toMatchObject([{videoId: f.source.videoId, parts: [{workspaceId: f.space.id}]}]);
});

test('a saved scribble retains a video; deleting its last scribble hides it despite the chat operation receipt; restore shows it again', async () => {
  const f = await setup();
  await f.spaces.save(f.space.id, 0, {...f.space.draft, scribble: {text: '随笔内容', time: 9}});
  const note = await f.scribbles.create(f.space.id, '随笔内容', 9, {chatId: f.space.chatId, expectedRevision: 1});
  expect((await f.library.query()).videos).toHaveLength(1);
  const target: LibraryTarget = {workspaceId: f.space.id, entityType: 'scribble', id: note.id};
  await f.management.move(target, 0);
  expect((await f.library.query()).videos).toEqual([]);
  expect((await f.management.trash()).entries).toEqual(expect.arrayContaining([expect.objectContaining({target})]));
  await f.management.restore(target, 1);
  expect((await f.library.query()).videos).toHaveLength(1);
});

test.each(['markdown', 'html', 'enhance', 'translate'] as const)('deleting the last %s result removes recent membership and restore recovers the same video', async type => {
  const f = await setup(), id = await f.generate(type);
  const target: LibraryTarget = {workspaceId: f.space.id, entityType: type === 'enhance' || type === 'translate' ? 'subtitle' : type, id};
  await f.management.move(target, 0);
  expect((await f.library.query()).videos).toEqual([]);
  expect((await f.management.trash()).entries).toEqual(expect.arrayContaining([expect.objectContaining({target})]));
  await f.management.restore(target, 1);
  expect((await f.library.query()).videos).toHaveLength(1);
});

test('an empty failed request is excluded, but a stopped partial answer is retained; trashing that chat hides it', async () => {
  const f = await setup(), empty = await f.start();
  await f.tasks.finish(empty.jobId, empty.attempts[0].attemptId, 'failed');
  expect((await f.library.query()).videos).toEqual([]);
  const partial = await f.start(), attemptId = partial.attempts[0].attemptId;
  await f.tasks.attach(partial.jobId, attemptId, 1);
  const claimed = (await f.tasks.claim(partial.jobId, attemptId, 1))!;
  await f.tasks.checkpoint(partial.jobId, attemptId, claimed.seq + 1, '已经生成的部分回答', {total: 1, covered: 0, ranges: []});
  await f.tasks.finish(partial.jobId, attemptId, 'stopped');
  expect((await f.library.query()).videos).toHaveLength(1);
  await f.management.move({workspaceId: f.space.id, entityType: 'chat', id: f.space.chatId}, 0);
  expect((await f.library.query()).videos).toEqual([]);
});

test('multi-part recent includes only parts with content, while explicit favorites remain available outside recent', async () => {
  const f = await setup();
  const b = await f.spaces.open({...f.source, partId: '12'});
  await f.scribbles.create(f.space.id, 'P1 资料', null);
  await f.spaces.open(f.source);
  expect((await f.library.query()).videos[0].parts.map(part => part.partId)).toEqual(['11']);
  const target = {workspaceId: b.id, entityType: 'workspace' as const, id: b.id};
  await f.library.addFavorite(DEFAULT_LIBRARY_FOLDER_ID, target);
  expect((await f.library.query('', DEFAULT_LIBRARY_FOLDER_ID)).videos[0].parts).toMatchObject([{workspaceId: b.id}]);
  expect((await f.library.query()).videos[0].parts.map(part => part.partId)).toEqual(['11']);
});

test('legacy note imports qualify, but a dangling subtitle version ID and an invalid native-like subtitle row do not', async () => {
  const f = await setup();
  await databaseTransaction<void>(f.name, ['workspaces', 'subtitleVersions'], 'readwrite', (tx, done) => {
    const rows = tx.objectStore('workspaces'), request = rows.get(f.space.id);
    request.onsuccess = () => {rows.put({...request.result, subtitleVersionIds: ['missing']}); done();};
    tx.objectStore('subtitleVersions').put({id: 'native-like', workspaceId: f.space.id, type: 'enhance', cues: []});
  });
  expect((await f.library.query()).videos).toEqual([]);
  await databaseTransaction<void>(f.name, ['artifacts'], 'readwrite', (tx, done) => {
    tx.objectStore('artifacts').put({id: 'legacy', workspaceId: f.space.id, sourceChatId: f.space.chatId, type: 'html', title: '旧知识资料'}); done();
  });
  expect((await f.library.query()).videos).toHaveLength(1);
});
