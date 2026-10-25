import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { seedImport } from '../fixtures/w25-import';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { IndexedArtifactStore } from '../../src/data/artifact-store';
import { IndexedKnowledgeStore } from '../../src/data/knowledge-store';
import { IndexedSubtitleStore } from '../../src/data/subtitle-store';
import { IndexedManagementStore } from '../../src/data/management-store';

test.each(['observation', 'reopen', 'readonly'])('preview confirms during %s and preserves the latest local position and metadata', async mode => {
  const sourceName = crypto.randomUUID(), f = await seedImport(sourceName);
  const file = await new IndexedBackupStore(sourceName).export();
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), library = new IndexedLibraryStore(name), backup = new IndexedBackupStore(name);
  const local = await spaces.open(f.source);
  await library.recordObservation(f.source, 40, Date.now());
  const plan = await backup.preview(file);
  for (let i = 1; i <= 3; i++) {
    if (mode === 'reopen') await spaces.open(f.source);
    if (mode === 'observation') await library.recordObservation(f.source, 40 + i, Date.now() + i);
    await spaces.read(local.id, local.chatId);
  }
  const latest = JSON.parse(await backup.export()).payload.workspaces[0];
  await expect(backup.execute(plan.planId, plan.checksum)).resolves.toMatchObject({ added: plan.added, conflicts: plan.conflicts });
  const restored = JSON.parse(await backup.export()).payload.workspaces[0];
  expect(restored.watchPosition).toEqual(latest.watchPosition);
  expect(restored.lastOpenedAt).toBe(latest.lastOpenedAt);
  expect(restored.recentChatId).toBe(local.chatId);
  expect((await new IndexedArtifactStore(name).list(local.id, f.a.chatId))[0]).toMatchObject({ revision: 2, content: '# 合成 B 编辑版 revision 2' });
  expect((await new IndexedKnowledgeStore(name).list(local.id, f.knowledge.id))[0]).toMatchObject({ document: { title: '合成知识 v1' } });
});

test('concurrent content, selections, new conflicts and deletion still require a new preview and leave all latest data intact', async () => {
  const name = crypto.randomUUID(), f = await seedImport(name), backup = new IndexedBackupStore(name);
  const file = await backup.export(), spaces = new IndexedWorkspaceStore(name);
  await spaces.createChat(f.a.id);
  const changes = [
    () => new IndexedArtifactStore(name).save(f.a.id, f.note.id, 2, '# 确认前并发编辑'),
    async () => { const row = (await spaces.read(f.a.id, f.a.chatId))!; await spaces.save(row.id, row.draft.revision, { ...row.draft, text: '确认前新草稿' }, row.chatId); },
    () => spaces.selectChat(f.a.id, f.a.chatId),
    () => new IndexedSubtitleStore(name).select(f.a.id, 0, { kind: 'native' }),
    () => spaces.createChat(f.a.id),
    () => new IndexedManagementStore(name).move({ workspaceId: f.a.id, entityType: 'chat', id: f.a.chatId }, 0)
  ];
  for (const change of changes) {
    const plan = await backup.preview(file);
    await change();
    await new IndexedLibraryStore(name).recordObservation(f.source, 70, Date.now());
    const latest = JSON.parse(await backup.export()).payload;
    await expect(backup.execute(plan.planId, plan.checksum)).rejects.toMatchObject({ code: 'plan-expired' });
    expect(JSON.parse(await backup.export()).payload).toEqual(latest);
  }
});
