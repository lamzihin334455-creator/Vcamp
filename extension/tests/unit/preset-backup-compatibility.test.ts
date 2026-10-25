import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { decode } from '../../src/data/backup-format';
import { validateBackup } from '../../src/data/backup-validation';
import { presetRevisions } from '../../src/workbench/template-presets';
import { presetRoleRevisions } from '../../src/workbench/role-presets';
import { IndexedRoleStore } from '../../src/data/role-store';
import { IndexedTemplateStore } from '../../src/data/template-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { databaseTransaction } from '../../src/data/database';

test('approved role catalog order and every current selection survive edits and backup restore', async () => {
  const name = crypto.randomUUID(), roles = new IndexedRoleStore(name), spaces = new IndexedWorkspaceStore(name);
  const catalog = await roles.list();
  expect(catalog.map(role => role.name)).toEqual(['简洁直接', '标准', '深度分析', '通俗易懂']);
  for (const role of catalog) {
    const space = await spaces.open({ platform: 'bilibili', videoId: 'BVapproved', partId: role.id, title: role.name });
    await spaces.save(space.id, 0, { ...space.draft, role: { roleId: role.id, revisionId: role.revisionId } });
    await roles.save(role.id, role.revision, { name: role.name, description: role.description, instructions: 'Edited after selection' });
    expect((await roles.revision(role.id, role.revisionId)).instructions).toBe(role.instructions);
  }
  const file = await new IndexedBackupStore(name).export(), destinationName = crypto.randomUUID();
  const destination = new IndexedBackupStore(destinationName), plan = await destination.preview(file);
  await destination.execute(plan.planId, plan.checksum);
  const restored = (await decode(await destination.export())).payload;
  for (const original of catalog) {
    const draft = restored.workspaces.find(space => space.source.partId === original.id)!.chats[0].draft;
    expect(restored.roleRevisions.find(role => role.revisionId === draft.role!.revisionId)?.instructions).toBe(original.instructions);
  }
});

test('all builtin template selections export unique historical dependencies and restore into a fresh database', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name);
  const selections = [...new Map(presetRevisions.map(revision => [revision.revisionId, revision])).values()];
  for (const template of selections) {
    const space = await spaces.open({ platform: 'bilibili', videoId: 'BVbackup', partId: template.revisionId, title: template.name });
    await spaces.save(space.id, 0, { ...space.draft, outputType: template.outputType, template: { templateId: template.templateId, revisionId: template.revisionId } });
  }
  const file = await new IndexedBackupStore(name).export(), { payload, checksum } = await decode(file);
  const ids = payload.templateRevisions.map(revision => revision.revisionId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const selected of selections) expect(payload.templateRevisions.find(revision => revision.revisionId === selected.revisionId)).toEqual(selected);
  expect(() => validateBackup(payload)).not.toThrow();
  const destination = new IndexedBackupStore(crypto.randomUUID()), plan = await destination.preview(file);
  await expect(destination.execute(plan.planId, checksum)).resolves.toMatchObject({ conflicts: plan.conflicts });
});

test('old v1 role selections export their actual dependency and restore without upgrading instructions', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name);
  const originals = presetRoleRevisions.filter(revision => revision.revision === 1);
  for (const role of originals) {
    const space = await spaces.open({ platform: 'bilibili', videoId: 'BVbackup', partId: role.roleId, title: role.name });
    await spaces.save(space.id, 0, { ...space.draft, role: { roleId: role.roleId, revisionId: role.revisionId } });
  }
  const file = await new IndexedBackupStore(name).export(), { payload, checksum } = await decode(file);
  for (const selected of originals) {
    expect(payload.roles.find(role => role.id === selected.roleId)).toMatchObject({ revisionId: selected.revisionId, instructions: selected.instructions });
    expect(payload.roleRevisions.find(role => role.revisionId === selected.revisionId)).toEqual(selected);
  }
  expect(() => validateBackup(payload)).not.toThrow();
  const destination = new IndexedBackupStore(crypto.randomUUID()), plan = await destination.preview(file);
  await expect(destination.execute(plan.planId, checksum)).resolves.toMatchObject({ conflicts: plan.conflicts });
  const restored = (await decode(await destination.export())).payload;
  for (const original of originals) {
    const draft = restored.workspaces.find(space => space.source.partId === original.roleId)!.chats[0].draft;
    expect(restored.roleRevisions.find(role => role.revisionId === draft.role!.revisionId)?.instructions).toBe(original.instructions);
  }
});

test.each(['save', 'delete'] as const)('old builtin edits survive a preset upgrade, %s, and a backup round trip', async action => {
  const name = crypto.randomUUID();
  const originalRole = presetRoleRevisions.find(row => row.roleId === 'role-professor' && row.revision === 1)!;
  const originalTemplate = presetRevisions.find(row => row.templateId === 'builtin-note' && row.revision === 1)!;
  const localRole = { ...originalRole, revisionId: crypto.randomUUID(), revision: 2, instructions: 'OLD_LOCAL_ROLE' };
  const localTemplate = { ...originalTemplate, revisionId: crypto.randomUUID(), revision: 2, requirements: 'OLD_LOCAL_TASK' };
  // Simulate the records written by the v1 app before newer builtin revisions existed.
  await databaseTransaction(name, ['roles', 'roleRevisions', 'templates', 'templateRevisions'], 'readwrite', (tx, done) => {
    const { roleId, ...role } = localRole, { templateId, ...template } = localTemplate;
    tx.objectStore('roles').put({ ...role, id: roleId, builtin: true });
    tx.objectStore('templates').put({ ...template, id: templateId, builtin: true });
    for (const row of [originalRole, localRole]) tx.objectStore('roleRevisions').put(row);
    for (const row of [originalTemplate, localTemplate]) tx.objectStore('templateRevisions').put(row);
    done(undefined);
  });
  const roles = new IndexedRoleStore(name), templates = new IndexedTemplateStore(name), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'BVupgrade', partId: '1', title: '旧版自定义预设' };
  const workspace = await spaces.open(source);
  const oldSelection = await spaces.open({ ...source, partId: 'original-v1' });
  await spaces.save(oldSelection.id, 0, { ...oldSelection.draft, role: { roleId: originalRole.roleId, revisionId: originalRole.revisionId }, template: { templateId: originalTemplate.templateId, revisionId: originalTemplate.revisionId } });
  const selection = { role: { roleId: localRole.roleId, revisionId: localRole.revisionId }, template: { templateId: localTemplate.templateId, revisionId: localTemplate.revisionId } };
  await spaces.save(workspace.id, 0, { ...workspace.draft, ...selection, text: '保留旧版任务', outputType: 'markdown', modelId: 'fixture' });
  const job = await tasks.freezeChat({ kind: 'chat', workspaceId: workspace.id, chatId: workspace.chatId }, 1,
    { locator: 'fixture', fingerprint: 'fixture', language: 'zh', cueCount: 1, binding: { ...source, tabId: 1, documentId: 'doc', epoch: 1 } }, false, false, undefined, true);
  await tasks.finish(job.jobId, job.attempts[0].attemptId, 'stopped');
  const current = (await spaces.read(workspace.id))!;
  await spaces.save(workspace.id, current.draft.revision, { ...current.draft, ...selection });
  // Export must also work immediately after upgrade, before any new edit.
  const before = (await decode(await new IndexedBackupStore(name).export())).payload;
  expect(before.roleRevisions).toHaveLength(2);
  expect(before.templateRevisions).toHaveLength(2);
  expect(() => validateBackup(before)).not.toThrow();
  if (action === 'save') {
    const { roleId: _roleId, revisionId: _roleRevisionId, revision: _roleRevision, ...roleFields } = localRole;
    const { templateId: _templateId, revisionId: _templateRevisionId, revision: _templateRevision, ...templateFields } = localTemplate;
    expect(await roles.save(localRole.roleId, 2, { ...roleFields, instructions: 'NEW_LOCAL_ROLE' })).toMatchObject({ revision: 3 });
    expect(await templates.save(localTemplate.templateId, 2, { ...templateFields, requirements: 'NEW_LOCAL_TASK' })).toMatchObject({ revision: 3 });
  } else {
    await roles.delete(localRole.roleId, 2);
    await templates.delete(localTemplate.templateId, 2);
  }
  expect(await roles.revision(localRole.roleId, localRole.revisionId)).toEqual(localRole);
  expect(await templates.revision(localTemplate.templateId, localTemplate.revisionId)).toEqual(localTemplate);
  expect((await spaces.read(workspace.id))!.draft).toMatchObject(selection);
  const file = await new IndexedBackupStore(name).export(), { payload, checksum } = await decode(file);
  expect(payload.roleRevisions.map(row => row.revision).sort()).toEqual(action === 'save' ? [1, 2, 3] : [1, 2]);
  expect(payload.templateRevisions.map(row => row.revision).sort()).toEqual(action === 'save' ? [1, 2, 3] : [1, 2]);
  expect(payload.roleRevisions).toContainEqual(localRole);
  expect(payload.templateRevisions).toContainEqual(localTemplate);
  expect(() => validateBackup(payload)).not.toThrow();
  const destination = new IndexedBackupStore(crypto.randomUUID()), plan = await destination.preview(file);
  await expect(destination.execute(plan.planId, checksum)).resolves.toMatchObject({ conflicts: plan.conflicts });
  const restored = (await decode(await destination.export())).payload;
  expect(restored.jobs[0].snapshot).toMatchObject({ roleSnapshot: { instructions: 'OLD_LOCAL_ROLE' }, templateSnapshot: { requirements: 'OLD_LOCAL_TASK' } });
  const draft = restored.workspaces.find(row => row.source.partId === '1')!.chats[0].draft;
  expect(restored.roleRevisions.find(row => row.revisionId === draft.role!.revisionId)?.instructions).toBe('OLD_LOCAL_ROLE');
  expect(restored.templateRevisions.find(row => row.revisionId === draft.template!.revisionId)?.requirements).toBe('OLD_LOCAL_TASK');
  const originalDraft = restored.workspaces.find(row => row.source.partId === 'original-v1')!.chats[0].draft;
  expect(restored.roleRevisions.find(row => row.revisionId === originalDraft.role!.revisionId)?.instructions).toBe(originalRole.instructions);
  expect(restored.templateRevisions.find(row => row.revisionId === originalDraft.template!.revisionId)?.requirements).toBe(originalTemplate.requirements);
});
