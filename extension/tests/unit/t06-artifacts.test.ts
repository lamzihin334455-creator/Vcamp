import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedArtifactStore } from '../../src/data/artifact-store';
import type { SubtitleBasis } from '../../src/contracts/generation';

const source = { platform: 'bilibili' as const, videoId: 'BVmarkdown', partId: '1', title: 'Markdown' };
const basis: SubtitleBasis = { locator: 'fixture', fingerprint: 'fixture', language: 'zh', binding: { ...source, tabId: 1, documentId: 'doc', epoch: 1 }, cueCount: 1 };
export async function setup() {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name), notes = new IndexedArtifactStore(name);
  const a = await spaces.open(source), target = { kind: 'chat' as const, workspaceId: a.id, chatId: a.chatId };
  async function generate(text: string, state: 'completed' | 'stopped' | 'failed' = 'completed') {
    const draft = (await spaces.read(a.id, a.chatId))!.draft;
    await spaces.save(a.id, draft.revision, { ...draft, text: '整理笔记', outputType: 'markdown', modelId: 'fixture', referenceIds: [], references: [] }, a.chatId);
    const job = await tasks.freezeChat(target, draft.revision + 1, basis), attempt = job.attempts[0].attemptId;
    await tasks.attach(job.jobId, attempt, 1);
    const claimed = (await tasks.claim(job.jobId, attempt, 1))!;
    await tasks.checkpoint(job.jobId, attempt, claimed.seq + 1, text, { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
    await tasks.finish(job.jobId, attempt, state, null, state === 'completed' ? crypto.randomUUID() : null);
    return { job, attempt };
  }
  return { name, a, target, spaces, tasks, notes, generate, basis };
}

test('completed Markdown creates independent saved artifacts atomically; duplicates, stopped and failed output never create another artifact', async () => {
  const { a, tasks, notes, generate, spaces } = await setup();
  const first = await generate('# 第一份\n内容');
  await tasks.finish(first.job.jobId, first.attempt, 'completed', null, 'duplicate');
  await tasks.finish(first.job.jobId, first.attempt, 'stopped');
  await generate('# 停止半成品', 'stopped'); await generate('# 失败半成品', 'failed');
  await generate('# 第二份');
  const artifacts = await notes.list(a.id);
  expect(artifacts.map(note => note.content).sort()).toEqual(['# 第一份\n内容', '# 第二份'].sort());
  expect(artifacts.every(note => note.sourceChatId === a.chatId && note.revision === 1)).toBe(true);
  expect((await spaces.read(a.id))!.chatId).toBe(a.chatId);
  expect((await tasks.get(first.job.jobId))!.attempts[0].completionToken).toBe(artifacts.find(note => note.content === '# 第一份\n内容')!.id);
});

test('v3 upgrade retains Chats, complete drafts, jobs and subtitle versions', async () => {
  const name = crypto.randomUUID();
  const draft = { schemaVersion: 1, revision: 7, text: '旧草稿', outputType: 'markdown', modelId: 'fixture', template: { templateId: 't', revisionId: 'r' }, referenceIds: ['n'], references: [{ artifactId: 'n', workspaceId: 'legacy', sourceChatId: 'b', title: '旧引用', type: 'markdown' }], attachmentIds: ['a'] };
  const workspace = { id: 'legacy', source, recentChatId: 'b', chats: [{ id: 'a', title: 'A', draft }, { id: 'b', title: 'B', draft: { ...draft, revision: 9 } }] };
  const job = { jobId: 'old-job', snapshot: { snapshotId: 'old-snapshot' }, attempts: [{ state: 'stopped', text: '旧任务' }] };
  const subtitle = { id: 'old-subtitle', workspaceId: 'legacy', cues: [{ from: 0, to: 1, content: 'saved AI subtitle' }] };
  await new Promise<void>(resolve => { const open = indexedDB.open(name, 3); open.onupgradeneeded = () => { for (const [table, keyPath] of [['workspaces', 'id'], ['jobs', 'jobId'], ['subtitleVersions', 'id']]) open.result.createObjectStore(table, { keyPath }); }; open.onsuccess = () => { const tx = open.result.transaction(['workspaces', 'jobs', 'subtitleVersions'], 'readwrite'); tx.objectStore('workspaces').put(workspace); tx.objectStore('jobs').put(job); tx.objectStore('subtitleVersions').put(subtitle); tx.oncomplete = () => { open.result.close(); resolve(); }; }; });
  const spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  expect((await spaces.read('legacy', 'a'))!.draft).toEqual(draft);
  expect(await spaces.read('legacy')).toMatchObject({ chatId: 'b', draft: { revision: 9 } });
  expect(await tasks.get('old-job')).toEqual(job);
  expect(await tasks.subtitleVersions('legacy')).toEqual([subtitle]);
  expect(await new IndexedArtifactStore(name).list('legacy')).toEqual([]);
});

test('saving creates an immutable revision, rejects a stale editor and leaves cancelled text unsaved', async () => {
  const { a, notes, generate } = await setup();
  await generate('# 原版');
  const note = (await notes.list(a.id))[0];
  const saved = await notes.save(a.id, note.id, 1, '# 保存版');
  expect(saved).toMatchObject({ revision: 2, content: '# 保存版', sourceChatId: a.chatId });
  await expect(notes.save(a.id, note.id, 1, '# 过期编辑')).rejects.toMatchObject({ code: 'revision-conflict' });
  expect(await notes.revisions(a.id, note.id)).toMatchObject([{ revision: 1, content: '# 原版' }, { revision: 2, content: '# 保存版' }]);
  expect((await notes.list(a.id))[0].content).toBe('# 保存版');
  await expect(notes.save('other-part', note.id, 2, '# 越权')).rejects.toMatchObject({ code: 'forbidden' });
});

test('send freezes latest saved references, excludes unreferenced artifact output and retry preserves the original provider inputs after editing', async () => {
  const { a, spaces, tasks, notes, generate, target, basis } = await setup();
  await generate('# 原笔记'); await generate('# 第二份');
  const artifacts = await notes.list(a.id), note = artifacts.find(note => note.content === '# 原笔记')!;
  await notes.save(a.id, note.id, 1, '# 最新保存版');
  const draft = (await spaces.read(a.id, a.chatId))!.draft;
  await spaces.save(a.id, draft.revision, { ...draft, outputType: 'chat', text: '结合两份笔记', referenceIds: artifacts.map(note => note.id) }, a.chatId);
  const job = await tasks.freezeChat(target, draft.revision + 1, basis);
  expect(job.snapshot).toMatchObject({ outputType: 'chat', referenceSnapshots: expect.arrayContaining([{ snapshotId: expect.any(String), artifactId: note.id, revisionId: expect.any(String), revision: 2, title: note.title, content: '# 最新保存版' }]) });
  expect(JSON.stringify(job.snapshot)).not.toContain('# 原笔记');
  await tasks.finish(job.jobId, job.attempts[0].attemptId, 'stopped');
  await notes.save(a.id, note.id, 2, '# 后来编辑版');
  const retry = await tasks.retry(job.jobId);
  expect(retry.snapshot).toEqual(job.snapshot);
  expect(JSON.stringify(retry.snapshot)).not.toContain('# 后来编辑版');
  const { runChat } = await import('../../src/generation/run-chat');
  const inputs: unknown[] = [];
  const provider = { async stream(_model: string, messages: unknown) { inputs.push(messages); } };
  for (const snapshot of [job.snapshot, retry.snapshot]) await runChat(snapshot as import('../../src/contracts/generation').ChatRequestSnapshot, [{ from: 0, to: 1, content: '字幕' }], provider, new AbortController().signal, async () => {});
  expect(inputs[0]).toEqual(inputs[1]);
  expect(JSON.stringify(inputs[0])).toContain('# 最新保存版');
  expect(JSON.stringify(inputs[0])).toContain('# 第二份');
});

test('references reject forged IDs, another Chat/part, unsupported types, deleted notes and deleted sources at the Store boundary', async () => {
  const { a, spaces, tasks, notes, generate, basis } = await setup();
  await generate('# 当前笔记');
  const note = (await notes.list(a.id))[0], b = await spaces.createChat(a.id);
  const tryReference = async (workspaceId: string, chatId: string, ids: string[], binding = basis.binding) => {
    const draft = (await spaces.read(workspaceId, chatId))!.draft;
    await spaces.save(workspaceId, draft.revision, { ...draft, modelId: 'fixture', text: '伪造引用', referenceIds: ids, outputType: 'chat' }, chatId);
    return tasks.freezeChat({ kind: 'chat', workspaceId, chatId }, draft.revision + 1, { ...basis, binding });
  };
  expect(await notes.list(a.id, b.chatId)).toEqual([]);
  await expect(tryReference(a.id, b.chatId, [note.id])).rejects.toMatchObject({ code: 'forbidden' });
  const p = await spaces.open({ ...source, partId: '2' });
  await expect(tryReference(p.id, p.chatId, [note.id], { ...basis.binding, partId: '2' })).rejects.toMatchObject({ code: 'forbidden' });
  await expect(tryReference(a.id, a.chatId, ['forged-html', 'forged-scribble', 'missing'])).rejects.toMatchObject({ code: 'forbidden' });
  await notes.remove(a.id, note.id);
  expect(await notes.list(a.id, a.chatId)).toEqual([]);
  await expect(tryReference(a.id, a.chatId, [note.id])).rejects.toMatchObject({ code: 'forbidden' });
  await generate('# 保留成果');
  await spaces.removeChat(a.id, a.chatId);
  expect(await notes.list(a.id)).toMatchObject([{ sourceDeleted: true, content: '# 保留成果' }]);
  expect(await notes.list(a.id, a.chatId)).toEqual([]);
  const kept = (await notes.list(a.id))[0];
  await expect(tryReference(a.id, b.chatId, [kept.id])).rejects.toMatchObject({ code: 'forbidden' });
});

test('artifact transaction failure rolls back receipt, relation and revision together, retaining prior artifacts', async () => {
  const { a, spaces, tasks, notes, target, basis, generate } = await setup();
  await generate('# 之前成果');
  const draft = (await spaces.read(a.id))!.draft;
  await spaces.save(a.id, draft.revision, { ...draft, text: '本次笔记', outputType: 'markdown' });
  const job = await tasks.freezeChat(target, draft.revision + 1, basis), attempt = job.attempts[0].attemptId;
  await tasks.attach(job.jobId, attempt, 1);
  const claimed = (await tasks.claim(job.jobId, attempt, 1))!;
  await tasks.checkpoint(job.jobId, attempt, claimed.seq + 1, '# 本次成果', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (value, key) { if (this.name === 'artifacts') this.transaction.abort(); return originalAdd.call(this, value, key); };
  try { await expect(tasks.finish(job.jobId, attempt, 'completed', null, 'aborted-receipt')).rejects.toMatchObject({ code: 'storage-failed' }); }
  finally { IDBObjectStore.prototype.add = originalAdd; }
  expect(await notes.list(a.id)).toMatchObject([{ content: '# 之前成果', revision: 1 }]);
  expect((await tasks.get(job.jobId))!.attempts[0]).toMatchObject({ state: 'running', completionToken: null });
  await tasks.finish(job.jobId, attempt, 'completed', null, 'valid-receipt');
  expect(await notes.list(a.id)).toHaveLength(2);
});

test('existing non-Markdown entities cannot be referenced, even with matching owner and a valid revision', async () => {
  const { name, a, spaces, tasks, notes, target, basis, generate } = await setup();
  await generate('# 笔记');
  const artifact = (await notes.list(a.id))[0];
  await new Promise<void>(resolve => { const open = indexedDB.open(name); open.onsuccess = () => { const tx = open.result.transaction(['artifacts', 'noteRevisions'], 'readwrite'); for (const type of ['html', 'scribble']) { tx.objectStore('artifacts').put({ ...artifact, id: type, type, revisionId: type }); tx.objectStore('noteRevisions').put({ id: type, artifactId: type, revision: 1, content: '不可引用' }); } tx.oncomplete = () => { open.result.close(); resolve(); }; }; });
  for (const id of ['html', 'scribble']) {
    const draft = (await spaces.read(a.id))!.draft;
    await spaces.save(a.id, draft.revision, { ...draft, text: '尝试引用', referenceIds: [id] });
    await expect(tasks.freezeChat(target, draft.revision + 1, basis)).rejects.toMatchObject({ code: 'forbidden' });
  }
  expect(await notes.list(a.id, a.chatId)).toHaveLength(1);
});

test('fixed readonly artifact remains viewable after its sole source Chat is deleted; forged reads and writes are rejected', async () => {
  const { a, spaces, notes, generate } = await setup();
  await generate('# 来源删除后仍可读');
  const note = (await notes.list(a.id))[0];
  await spaces.removeChat(a.id, a.chatId);
  const { createMessageRouter } = await import('../../src/app/message-router');
  const router = createMessageRouter(spaces, 'extension', async () => null, undefined, undefined, undefined, { async command(command) {
    if (command.type === 'artifact.save') return { artifacts: [await notes.save(command.workspaceId, command.artifactId, command.expectedRevision, command.content)] };
    return { artifacts: (await notes.list(command.workspaceId, command.sourceChatId)).filter(note => !command.artifactId || note.id === command.artifactId) };
  } });
  const sender = { id: 'extension', frameId: 0, url: `chrome-extension://extension/reader.html?workspaceId=${encodeURIComponent(a.id)}&artifactId=${note.id}` };
  const handle = (operation: unknown) => router.handle({ version: 1, requestId: crypto.randomUUID(), operation }, sender);
  expect(await handle({ type: 'workspace.query' })).toMatchObject({ ok: true, view: { mode: 'readonly', workspaceId: a.id, chatId: null, draft: null } });
  expect(await handle({ type: 'artifact.query', workspaceId: a.id, artifactId: note.id })).toMatchObject({ ok: true, view: { artifacts: { artifacts: [{ sourceDeleted: true, content: '# 来源删除后仍可读' }] } } });
  expect(await handle({ type: 'artifact.query', workspaceId: a.id, artifactId: 'other' })).toMatchObject({ ok: false, code: 'forbidden' });
  expect(await handle({ type: 'artifact.save', workspaceId: a.id, artifactId: note.id, expectedRevision: 1, content: 'forged' })).toMatchObject({ ok: false, code: 'forbidden' });
});

test('an empty Markdown heading still creates a viewable artifact title', async () => {
  const { a, notes, generate } = await setup();
  await generate('# \n有效正文');
  const { artifactSchema } = await import('../../src/contracts/artifact');
  const note = artifactSchema.parse((await notes.list(a.id))[0]);
  expect(note).toMatchObject({ title: 'Markdown 笔记', content: '# \n有效正文' });
});
