import 'fake-indexeddb/auto';
import { test, expect } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { seedBackup } from '../fixtures/t20-semantic';
import { digest } from '../../src/data/backup-format';
import { IndexedArtifactStore } from '../../src/data/artifact-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedTemplateStore } from '../../src/data/template-store';
import { IndexedSubtitleStore } from '../../src/data/subtitle-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { IndexedManagementStore } from '../../src/data/management-store';
import { vi } from 'vitest';

test('all current persistent types round trip, conflicts remap history/old templates/references/favorites as one Chat group', async () => {
  const name = crypto.randomUUID(), f = await seedBackup(name), exporter = new IndexedBackupStore(name), file = await exporter.export();
  const newName = crypto.randomUUID(), importer = new IndexedBackupStore(newName);
  const plan = await importer.preview(file); await importer.execute(plan.planId, plan.checksum);
  const notes = new IndexedArtifactStore(newName), tasks = new IndexedGenerationStore(newName), spaces = new IndexedWorkspaceStore(newName), trash = new IndexedManagementStore(newName);
  expect((await notes.list(f.a.id))[0]).toMatchObject({ content: '# 导入原文\n已编辑最新版', sourceChatId: f.a.chatId });
  expect((await notes.revisions(f.a.id, f.note.id)).map(r => r.content)).toEqual(['# 导入原文\n旧版笔记', '# 导入原文\n已编辑最新版']);
  expect((await notes.list(f.b.id))[0].sourceDeleted).toBe(true);
  expect((await tasks.get(f.runningId))!.attempts[0]).toMatchObject({ state: 'interrupted', importedState: 'running', executor: null, claimed: false, completionToken: null });
  expect((await tasks.view({ kind: 'chat', workspaceId: f.a.id, chatId: f.second.chatId })).messages.at(-1)!.state).toBe('interrupted');
  const parent = (await trash.trash()).entries.find(e => e.target.id === f.p2.id)!;
  await trash.restore(parent.target, parent.revision);
  expect((await trash.trash()).entries.some(e => e.target.id === f.deletedChild.id)).toBe(true);
  const draft = (await spaces.read(f.a.id, f.a.chatId))!.draft;
  await spaces.save(f.a.id, draft.revision, { ...draft, text: '本机不同草稿' }, f.a.chatId);
  await notes.save(f.a.id, f.note.id, 2, '# 本机编辑');
  await trash.move({ workspaceId: f.a.id, entityType: 'subtitle', id: f.subtitleId }, 0);
  const templateStore = new IndexedTemplateStore(newName), currentTemplate = (await templateStore.list()).find(t => t.id === f.template.id)!;
  await templateStore.save(f.template.id, currentTemplate.revision, { name: '本机模板修改', description: '', requirements: '本机要求', outputType: 'markdown', defaultModelId: 'fixture' });
  const merge = await importer.preview(file); await importer.execute(merge.planId, merge.checksum);
  const mappedChat = merge.mapping.find(m => m.kind === 'chat' && m.from === f.a.chatId)!.to, mappedNote = merge.mapping.find(m => m.from === f.note.id)!.to;
  const importedDraft = (await spaces.read(f.a.id, mappedChat))!.draft;
  expect(importedDraft.text).toBe('主对话未发送草稿');
  expect(importedDraft.referenceIds).toEqual([mappedNote]);
  expect(importedDraft.references![0].sourceChatId).toBe(mappedChat);
  expect((await notes.list(f.a.id, mappedChat))[0]).toMatchObject({ id: mappedNote, sourceChatId: mappedChat, content: '# 导入原文\n已编辑最新版' });
  expect((await templateStore.revision(importedDraft.template!.templateId, importedDraft.template!.revisionId)).requirements).toBe('旧要求');
  const importedJobId = merge.mapping.find(m => m.from === f.firstJobId)!.to, job = (await tasks.get(importedJobId))!;
  expect(job.snapshot.target).toMatchObject({ chatId: mappedChat, workspaceId: f.a.id });
  const frozenJob = (await tasks.get(merge.mapping.find(m => m.from === f.referenceJobId)!.to))!;
  expect((frozenJob.snapshot as any).referenceSnapshots[0]).toMatchObject({ artifactId: mappedNote, content: '# 导入原文\n旧版笔记' });
  expect((await new IndexedLibraryStore(newName).query()).favorites!.some(fav => fav.target.id === mappedNote)).toBe(true);
  expect((await new IndexedSubtitleStore(newName).query(f.a.id)).analysisSource).toEqual({ kind: 'version', versionId: f.subtitleId });
  const importedAI = merge.mapping.find(m => m.from === f.subtitleId)!.to, importedTranslation = merge.mapping.find(m => m.from === f.translationId)!.to;
  expect(importedAI).not.toBe(f.subtitleId);
  const subView = await new IndexedSubtitleStore(newName).query(f.a.id);
  expect(subView.sourceValid).toBe(false);
  expect(subView.versions.find(v => v.id === importedTranslation)!.source).toEqual({ subtitleVersionId: importedAI });
  const aiJob = (await tasks.get(merge.mapping.find(m => m.from === f.enhancedJobId)!.to))!;
  expect(aiJob.basis.subtitleVersionId).toBe(importedAI);
  expect((aiJob.snapshot as any).analysisSource.versionId).toBe(importedAI);
  expect((await importer.preview(file)).added).toBe(0);
  // The export of a merged graph must itself remain importable.
  await new IndexedBackupStore(crypto.randomUUID()).preview(await importer.export());
});

test('backup preview is inert and confirmed merge restores complete drafts in the same video/P identity', async () => {
  const sourceName = crypto.randomUUID(), source = new IndexedWorkspaceStore(sourceName), targetName = crypto.randomUUID(), target = new IndexedWorkspaceStore(targetName);
  const row = await source.open({ platform: 'bilibili', videoId: 'backup', partId: '1', title: '备份视频' });
  await source.save(row.id, 0, { ...row.draft, text: '完整草稿', modelId: 'unconfigured-model', scribble: { text: '随笔草稿', time: 8 } });
  const backup = new IndexedBackupStore(sourceName), importer = new IndexedBackupStore(targetName);
  const file = await backup.export(), plan = await importer.preview(file);
  expect(await target.read(row.id)).toBeUndefined();
  await importer.execute(plan.planId, plan.checksum);
  expect((await target.read(row.id))!.draft).toMatchObject({ text: '完整草稿', modelId: 'unconfigured-model', scribble: { text: '随笔草稿', time: 8 } });
  const again = await importer.preview(file);
  expect(again.added).toBe(0);
});

test('a checksum-valid package with missing immutable dependencies is rejected before any write', async () => {
  const name = crypto.randomUUID(); await seedBackup(name);
  const packet = JSON.parse(await new IndexedBackupStore(name).export());
  packet.payload.noteRevisions = [];
  packet.manifest.checksum = await digest(packet.manifest.formatVersion===6?{payload:packet.payload,...(packet.preferences?{preferences:packet.preferences}:{})}:packet.payload);
  const importer = new IndexedBackupStore(crypto.randomUUID());
  await expect(importer.preview(JSON.stringify(packet))).rejects.toMatchObject({ code: 'invalid-message' });
  expect(JSON.parse(await importer.export()).payload.workspaces).toEqual([]);
});

test('stale previews reject draft/job/deletion changes and quota faults roll back the entire graph', async () => {
  const sourceName = crypto.randomUUID(), f = await seedBackup(sourceName), file = await new IndexedBackupStore(sourceName).export();
  const name = crypto.randomUUID(), backup = new IndexedBackupStore(name), spaces = new IndexedWorkspaceStore(name);
  const first = await backup.preview(file); await backup.execute(first.planId, first.checksum);
  const plan = await backup.preview(file), row = (await spaces.read(f.a.id, f.a.chatId))!;
  await spaces.save(f.a.id, row.draft.revision, { ...row.draft, text: '预览后编辑' }, f.a.chatId);
  await expect(backup.execute(plan.planId, plan.checksum)).rejects.toMatchObject({ code: 'plan-expired' });
  const empty = new IndexedBackupStore(crypto.randomUUID()), importing = await empty.preview(file), originalPut = IDBObjectStore.prototype.put;
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'noteRevisions') throw new DOMException('fixture quota', 'QuotaExceededError');
    return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
  });
  try { await expect(empty.execute(importing.planId, importing.checksum)).rejects.toMatchObject({ code: 'storage-failed' }); }
  finally { fault.mockRestore(); }
  expect(JSON.parse(await empty.export()).payload.workspaces).toEqual([]);
  await empty.execute(importing.planId, importing.checksum);
  expect(JSON.parse(await empty.export()).payload.workspaces).toHaveLength(3);
});

test('foreign ownership, unknown types, duplicate IDs, unsupported attachments and stale checksums fail before merge', async () => {
  const name = crypto.randomUUID(); const f = await seedBackup(name), file = await new IndexedBackupStore(name).export();
  const importer = new IndexedBackupStore(crypto.randomUUID());
  for (const change of [
    (p: any) => { p.payload.artifacts[0].workspaceId = f.p2.id; },
    (p: any) => { p.payload.jobs.push(p.payload.jobs[0]); },
    (p: any) => { p.payload.jobs[1].snapshot.snapshotId = p.payload.jobs[0].snapshot.snapshotId; },
    (p: any) => { p.payload.jobs[0].basis.binding.documentId = 'old-capability'; },
    (p: any) => { p.payload.screenshotBlobs = []; p.manifest.types.push('screenshotBlobs'); },
    (p: any) => { p.payload.workspaces[0].apiKey = 'synthetic-secret'; }
  ]) {
    const p = JSON.parse(file); change(p); p.manifest.checksum = await digest(p.payload);
    await expect(importer.preview(JSON.stringify(p))).rejects.toMatchObject({ code: 'invalid-message' });
  }
  const attachment = JSON.parse(file); attachment.payload.workspaces[0].chats[0].draft.attachmentIds = ['unimplemented-blob']; attachment.manifest.checksum = await digest(attachment.payload);
  await expect(importer.preview(JSON.stringify(attachment))).rejects.toMatchObject({ code: 'invalid-message' });
  await expect(importer.preview(file.replace('备份重复标题', '篡改标题'))).rejects.toMatchObject({ code: 'invalid-message' });
  expect(JSON.parse(await importer.export()).payload.workspaces).toEqual([]);
});

test('built-in template versions become immutable portable custom dependencies', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), row = await spaces.open({ platform: 'bilibili', videoId: 'builtin', partId: '1', title: '模板版本' });
  await spaces.save(row.id, 0, { ...row.draft, template: { templateId: 'builtin-note', revisionId: 'builtin-note:v1' }, outputType: 'markdown' });
  const file = await new IndexedBackupStore(name).export(), targetName = crypto.randomUUID(), importer = new IndexedBackupStore(targetName), plan = await importer.preview(file);
  await importer.execute(plan.planId, plan.checksum);
  const imported = (await new IndexedWorkspaceStore(targetName).read(row.id))!.draft.template!;
  expect(imported.templateId).not.toBe('builtin-note');
  expect((await new IndexedTemplateStore(targetName).revision(imported.templateId, imported.revisionId)).requirements).toContain('Markdown');
  expect((await importer.preview(file)).added).toBe(0);
});

test('import leaves a local running task able to checkpoint and complete in its original Chat', async () => {
  const name = crypto.randomUUID(), f = await seedBackup(name), backup = new IndexedBackupStore(name), tasks = new IndexedGenerationStore(name);
  const file = await backup.export(), before = (await tasks.get(f.runningId))!;
  const plan = await backup.preview(file); await backup.execute(plan.planId, plan.checksum);
  expect(await tasks.get(f.runningId)).toEqual(before);
  const attemptId = before.attempts[0].attemptId;
  await tasks.checkpoint(f.runningId, attemptId, before.seq + 1, '运行中的部分回答，继续完成', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  await tasks.finish(f.runningId, attemptId, 'completed', null, crypto.randomUUID());
  expect((await tasks.get(f.runningId))!.snapshot.target).toEqual({ kind: 'chat', workspaceId: f.a.id, chatId: f.second.chatId });
  expect((await tasks.view({ kind: 'chat', workspaceId: f.a.id, chatId: f.second.chatId })).messages.at(-1)).toMatchObject({ text: '运行中的部分回答，继续完成', state: 'completed' });
});

test('job completion and deletion expire an already validated import plan, independently of draft revisions', async () => {
  const name = crypto.randomUUID(), f = await seedBackup(name), backup = new IndexedBackupStore(name), tasks = new IndexedGenerationStore(name), management = new IndexedManagementStore(name), file = await backup.export();
  const first = await backup.preview(file), job = (await tasks.get(f.runningId))!;
  await tasks.checkpoint(job.jobId, job.attempts[0].attemptId, job.seq + 1, '运行中的部分回答，完成', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  await tasks.finish(job.jobId, job.attempts[0].attemptId, 'completed', null, crypto.randomUUID());
  await expect(backup.execute(first.planId, first.checksum)).rejects.toMatchObject({ code: 'plan-expired' });
  const second = await backup.preview(file);
  await management.move({ workspaceId: f.a.id, entityType: 'scribble', id: f.scribble.id }, 0);
  await expect(backup.execute(second.planId, second.checksum)).rejects.toMatchObject({ code: 'plan-expired' });
});

test('workspace singleton conflicts preserve local choices and retain imported alternatives without creating duplicate Chats', async () => {
  const sourceName = crypto.randomUUID(), f = await seedBackup(sourceName), file = await new IndexedBackupStore(sourceName).export(), name = crypto.randomUUID(), backup = new IndexedBackupStore(name), spaces = new IndexedWorkspaceStore(name), library = new IndexedLibraryStore(name);
  const initial = await backup.preview(file); await backup.execute(initial.planId, initial.checksum);
  const localChat = await spaces.createChat(f.a.id);
  await library.recordObservation(f.a.source, 77, Date.now() + 1000);
  const plan = await backup.preview(file); await backup.execute(plan.planId, plan.checksum);
  expect((await spaces.read(f.a.id))!.chatId).toBe(localChat.chatId);
  const packet = JSON.parse(await backup.export()), workspace = packet.payload.workspaces.find((w: any) => w.id === f.a.id);
  expect(workspace.watchPosition.time).toBe(77);
  expect(workspace.chats).toHaveLength(3);
  expect(workspace.backupImports.some((r: any) => r.watchPosition.time === 33 && r.recentChatId === f.second.chatId)).toBe(true);
  expect((await backup.preview(file)).added).toBe(0);
});

test('conflict copies remap frozen historical content versions that differ from the live message version', async () => {
  const name = crypto.randomUUID(), f = await seedBackup(name), backup = new IndexedBackupStore(name), packet = JSON.parse(await backup.export());
  const request = packet.payload.jobs.find((j: any) => j.jobId === f.enhancedJobId), entry = request.snapshot.historyProjection.find((e: any) => e.role === 'assistant');
  const historicalId = crypto.randomUUID(); entry.contentVersionId = historicalId; entry.text = '冻结时的旧消息片段';
  packet.manifest.checksum = await digest(packet.manifest.formatVersion===6?{payload:packet.payload,...(packet.preferences?{preferences:packet.preferences}:{})}:packet.payload);
  const plan = await backup.preview(JSON.stringify(packet)); await backup.execute(plan.planId, plan.checksum);
  const importedJob = (await new IndexedGenerationStore(name).get(plan.mapping.find(m => m.from === f.enhancedJobId)!.to))!;
  const history = (importedJob.snapshot as any).historyProjection.find((e: any) => e.text === '冻结时的旧消息片段');
  expect(history.contentVersionId).not.toBe(historicalId);
  expect(history.text).toBe('冻结时的旧消息片段');
});

test('conflicting Chat drafts retain both copies and repeated imports compare actual contents rather than the package ID', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), importer = new IndexedBackupStore(name);
  const row = await spaces.open({ platform: 'bilibili', videoId: 'conflict', partId: '1', title: '重复标题' });
  await spaces.save(row.id, 0, { ...row.draft, text: '来自备份的草稿' });
  const file = await importer.export();
  await spaces.save(row.id, 1, { ...row.draft, text: '本机新草稿' });
  const plan = await importer.preview(file);
  expect(plan.conflicts).toBeGreaterThan(0);
  await importer.execute(plan.planId, plan.checksum);
  const chats = (await spaces.read(row.id, row.chatId))!.chats;
  expect(chats).toHaveLength(2);
  const copy = chats.find(c => c.id !== row.chatId)!;
  expect((await spaces.read(row.id, copy.id))!.draft.text).toBe('来自备份的草稿');
  expect((await spaces.read(row.id, row.chatId))!.draft.text).toBe('本机新草稿');
  expect((await importer.preview(file)).added).toBe(0);
  await spaces.save(row.id, 1, { ...(await spaces.read(row.id, copy.id))!.draft, text: '导入副本后来也改了' }, copy.id);
  const fresh = await importer.preview(file);
  expect(fresh.added).toBeGreaterThan(0);
  await importer.execute(fresh.planId, fresh.checksum);
  expect((await spaces.read(row.id, row.chatId))!.chats).toHaveLength(3);
});
