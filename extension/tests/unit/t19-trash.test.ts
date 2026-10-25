import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedArtifactStore } from '../../src/data/artifact-store';
import { IndexedManagementStore } from '../../src/data/management-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { IndexedScribbleStore } from '../../src/data/scribble-store';
import { vi } from 'vitest';
import { IndexedSubtitleStore } from '../../src/data/subtitle-store';
import { createApplication } from '../../src/app/application';

async function setup() {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name), management = new IndexedManagementStore(name), notes = new IndexedArtifactStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'trash', partId: '1', title: '资料' }, space = await spaces.open(source);
  const target = { kind: 'chat' as const, workspaceId: space.id, chatId: space.chatId };
  const basis = { locator: 'native', fingerprint: 'fixture', language: 'zh', cueCount: 1, binding: { ...source, tabId: 1, documentId: 'doc', epoch: 1 } };
  const draft = { ...space.draft, text: '生成笔记', outputType: 'markdown' as const, modelId: 'fixture' };
  await spaces.save(space.id, 0, draft);
  const job = await tasks.freezeChat(target, 1, basis), attempt = job.attempts[0].attemptId;
  await tasks.attach(job.jobId, attempt, 1); const claimed = (await tasks.claim(job.jobId, attempt, 1))!;
  await tasks.checkpoint(job.jobId, attempt, claimed.seq + 1, '# 留存笔记', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  await tasks.finish(job.jobId, attempt, 'completed', null, 'note');
  return { name, spaces, tasks, management, notes, source, space, target, basis };
}

test('trashing a running Chat preserves its draft, messages and source artifacts, leaves subtitle jobs active, and restores original identity', async () => {
  const { spaces, tasks, management, notes, space, target, basis } = await setup();
  const saved = await spaces.read(space.id, space.chatId);
  await spaces.save(space.id, saved!.draft.revision, { ...saved!.draft, text: '下一份草稿' });
  const chatJob = await tasks.freezeChat(target, saved!.draft.revision + 1, basis);
  const sub = await tasks.freezeSubtitle({ snapshotId: crypto.randomUUID(), target: { kind: 'subtitle', workspaceId: space.id, operation: 'enhance' }, source: { locator: basis.locator, fingerprint: basis.fingerprint }, targetLanguage: null, requirements: '', modelId: 'fixture' }, basis);
  const trashTarget = { workspaceId: space.id, entityType: 'chat' as const, id: space.chatId };
  await management.move(trashTarget, (await management.preview(trashTarget)).revision);
  expect((await tasks.get(chatJob.jobId))!.attempts[0].state).toBe('stopped');
  expect((await tasks.get(sub.jobId))!.attempts[0].state).toBe('queued');
  expect(await notes.list(space.id)).toMatchObject([{ id: 'note', sourceChatId: space.chatId, sourceDeleted: true, content: '# 留存笔记' }]);
  await expect(spaces.save(space.id, 3, { ...space.draft, text: '迟到写入' }, space.chatId)).rejects.toMatchObject({ code: 'not-found' });
  const entry = (await management.trash()).entries[0];
  await management.restore(entry.target, entry.revision);
  expect((await spaces.read(space.id, space.chatId))!.chatId).toBe(space.chatId);
  expect((await tasks.view(target)).messages[0].text).toBe('生成笔记');
  expect((await notes.list(space.id))[0].sourceDeleted).toBe(false);
  expect((await tasks.get(chatJob.jobId))!.attempts[0].state).toBe('stopped');
});

test('ordinary panel reopening offers explicit restore without resurrecting a workspace; old readers reject the deleted target', async () => {
  const { spaces, management, source, space } = await setup(), app = createApplication(spaces);
  await management.move({ workspaceId: space.id, entityType: 'workspace', id: space.id }, 0);
  expect(await (await app.openPanel(source)).query()).toMatchObject({ workspaceId: null, chatId: null, draft: null, deletedWorkspace: { id: space.id } });
  await expect(app.openReader(space.id, space.chatId).query()).rejects.toMatchObject({ code: 'not-found' });
  expect((await management.trash()).entries).toHaveLength(1);
});

test('deleting the selected AI version invalidates its original ID; restoration validates it without replacing frozen provenance', async () => {
  const { name, tasks, management, space, basis } = await setup();
  const subtitles = new IndexedSubtitleStore(name);
  const job = await tasks.freezeSubtitle({ snapshotId: crypto.randomUUID(), target: { kind: 'subtitle', workspaceId: space.id, operation: 'enhance' }, source: { locator: basis.locator, fingerprint: basis.fingerprint }, targetLanguage: null, requirements: '', modelId: 'fixture' }, basis), attempt = job.attempts[0].attemptId;
  await tasks.attach(job.jobId, attempt, 3); const claimed = (await tasks.claim(job.jobId, attempt, 3))!;
  await tasks.checkpoint(job.jobId, attempt, claimed.seq + 1, '增强', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  await tasks.finish(job.jobId, attempt, 'completed', null, 'ai-version', { kind: 'subtitle', cues: [{ from: 0, to: 1, content: '增强字幕' }] });
  await subtitles.select(space.id, 0, { kind: 'enhanced', versionId: 'ai-version' });
  const before = (await tasks.get(job.jobId))!.snapshot;
  const target = { workspaceId: space.id, entityType: 'subtitle' as const, id: 'ai-version' };
  await management.move(target, 0);
  expect(await subtitles.query(space.id)).toMatchObject({ versions: [], analysisSource: { kind: 'version', versionId: 'ai-version' }, sourceValid: false });
  await management.restore(target, 1);
  expect((await subtitles.query(space.id)).sourceValid).toBe(true);
  expect((await tasks.get(job.jobId))!.snapshot).toEqual(before);
});

test('delete and complete compete in one durable boundary; late completion after restore cannot create a second artifact', async () => {
  const { spaces, tasks, management, notes, space, target, basis } = await setup();
  const draft = (await spaces.read(space.id))!.draft;
  await spaces.save(space.id, draft.revision, { ...draft, text: '竞争任务' });
  const job = await tasks.freezeChat(target, draft.revision + 1, basis), attempt = job.attempts[0].attemptId;
  await tasks.attach(job.jobId, attempt, 2); const claimed = (await tasks.claim(job.jobId, attempt, 2))!;
  await tasks.checkpoint(job.jobId, attempt, claimed.seq + 1, '# 竞争结果', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  const trashTarget = { workspaceId: space.id, entityType: 'chat' as const, id: space.chatId };
  await Promise.all([management.move(trashTarget, 0), tasks.finish(job.jobId, attempt, 'completed', null, 'race-result')]);
  const state = (await tasks.get(job.jobId))!.attempts[0].state;
  expect(['completed', 'stopped']).toContain(state);
  await management.restore(trashTarget, 1);
  await tasks.finish(job.jobId, attempt, 'completed', null, 'second-result');
  expect((await notes.list(space.id)).filter(row => row.id !== 'note').map(row => row.id)).toEqual(state === 'completed' ? ['race-result'] : []);
  // An old delayed draft save cannot overwrite the restored draft.
  await expect(spaces.save(space.id, draft.revision + 2, { ...draft, text: '迟到草稿' }, space.chatId)).rejects.toMatchObject({ code: 'revision-conflict' });
});

test('workspace deletion fences queued and running attempts and ordinary writes; restore preserves independently trashed children', async () => {
  const { name, spaces, tasks, management, notes, source, space, target, basis } = await setup();
  const scribbles = new IndexedScribbleStore(name), library = new IndexedLibraryStore(name);
  const scribble = await scribbles.create(space.id, '独立删除的随笔', 10);
  const child = { workspaceId: space.id, entityType: 'scribble' as const, id: scribble.id }, parent = { workspaceId: space.id, entityType: 'workspace' as const, id: space.id };
  await management.move(child, 0);
  const draft = (await spaces.read(space.id))!.draft;
  await spaces.save(space.id, draft.revision, { ...draft, text: '新任务' });
  const chatJob = await tasks.freezeChat(target, draft.revision + 1, basis), attempt = chatJob.attempts[0].attemptId;
  await tasks.attach(chatJob.jobId, attempt, 2); await tasks.claim(chatJob.jobId, attempt, 2);
  const sub = await tasks.freezeSubtitle({ snapshotId: crypto.randomUUID(), target: { kind: 'subtitle', workspaceId: space.id, operation: 'enhance' }, source: { locator: basis.locator, fingerprint: basis.fingerprint }, targetLanguage: null, requirements: '', modelId: 'fixture' }, basis);
  await management.move(parent, 0);
  expect((await tasks.get(sub.jobId))!.attempts[0].state).toBe('stopped');
  await tasks.checkpoint(chatJob.jobId, attempt, 99, '迟到', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  await tasks.finish(chatJob.jobId, attempt, 'completed', null, 'late');
  await expect(spaces.open(source)).rejects.toMatchObject({ code: 'not-found' });
  await library.recordObservation(source, 888, Date.now());
  await expect(library.resolve(parent)).rejects.toMatchObject({ code: 'not-found' });
  await expect(scribbles.create(space.id, '禁止', null)).rejects.toMatchObject({ code: 'not-found' });
  await expect(tasks.retry(chatJob.jobId)).rejects.toMatchObject({ code: 'not-found' });
  await expect(management.restore(child, 1)).rejects.toMatchObject({ code: 'parent-deleted' });
  await management.restore(parent, 1);
  await tasks.finish(chatJob.jobId, attempt, 'completed', null, 'late-after-restore');
  expect((await notes.list(space.id)).map(row => row.id)).toEqual(['note']);
  expect(await scribbles.list(space.id)).toEqual([]);
  expect((await library.resolve(parent)).position).toBe(0);
  await management.restore(child, 1);
  expect((await scribbles.list(space.id))[0].id).toBe(scribble.id);
  expect((await spaces.read(space.id, space.chatId))!.chatId).toBe(space.chatId);
});

test('an aborted deletion rolls back both target state and task terminal state', async () => {
  const { spaces, tasks, management, space, target, basis } = await setup();
  const draft = (await spaces.read(space.id))!.draft;
  await spaces.save(space.id, draft.revision, { ...draft, text: '运行' });
  const job = await tasks.freezeChat(target, draft.revision + 1, basis);
  const original = IDBObjectStore.prototype.put;
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'jobs') throw new DOMException('fixture quota failure', 'QuotaExceededError');
    return original.apply(this, args);
  });
  await expect(management.move({ workspaceId: space.id, entityType: 'workspace', id: space.id }, 0)).rejects.toMatchObject({ code: 'storage-failed' });
  fault.mockRestore();
  expect((await management.trash()).entries).toEqual([]);
  expect((await tasks.get(job.jobId))!.attempts[0].state).toBe('queued');
  expect((await spaces.read(space.id))!.chatId).toBe(space.chatId);
});
