import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';

// Produced by the real BASE TemplateStore and WorkspaceStore, before this repair.
const fixture = readFileSync(new URL('../fixtures/t09-legacy-custom-backup.json', import.meta.url), 'utf8');
const old = JSON.parse(fixture).payload;
const source = old.workspaces[0], chat = source.chats[0];
const basis = { locator: 'fixture', fingerprint: 'digest', language: 'zh', cueCount: 1, binding: { ...source.source, tabId: 1, documentId: 'doc', epoch: 1 } };
async function legacy() {
  const name = crypto.randomUUID(), backup = new IndexedBackupStore(name), tasks = new IndexedGenerationStore(name), spaces = new IndexedWorkspaceStore(name);
  const plan = await backup.preview(fixture); await backup.execute(plan.planId, plan.checksum);
  return { name, backup, tasks, spaces, target: { kind: 'chat' as const, workspaceId: source.id, chatId: chat.id } };
}
test('BASE custom HTML and its existing bound draft stay legacy after import: reject atomically without a job', async () => {
  const { backup, tasks, spaces, target } = await legacy();
  const before = (await spaces.read(source.id, chat.id))!.draft;
  await expect(tasks.freezeChat(target, before.revision, basis)).rejects.toMatchObject({ code: 'legacy-knowledge' });
  expect((await spaces.read(source.id, chat.id))!.draft).toEqual(before);
  const after = JSON.parse(await backup.export()).payload;
  expect(after.jobs).toEqual([]);
  expect(after.templateRevisions[0]).toEqual(old.templateRevisions[0]);
});

import { IndexedTemplateStore } from '../../src/data/template-store';
import { digest } from '../../src/data/backup-format';
const identity = { outputProtocol: 'knowledge-json-v1' as const };
const content = { name: '交互知识', description: '已检查要求', requirements: '整理概括、分类、概念关系与问答', outputType: 'html' as const, defaultModelId: 'synthetic-a' };
async function converted() {
  const state = await legacy(), templates = new IndexedTemplateStore(state.name), prior = old.templates[0];
  const version = await templates.save(prior.id, prior.revision, { ...content, ...identity });
  return { ...state, templates, version };
}
test('explicit conversion and reselect allow JSON; old versions/draft stay fixed and newer edits never change the request retry', async () => {
  const { spaces, tasks, templates, target, version } = await converted();
  const before = (await spaces.read(source.id, chat.id))!.draft;
  expect(before).toEqual(chat.draft);
  expect(await templates.revision(old.templates[0].id, old.templateRevisions[0].revisionId)).toEqual(old.templateRevisions[0]);
  await expect(tasks.freezeChat(target, before.revision, basis)).rejects.toMatchObject({ code: 'legacy-knowledge' });
  await spaces.save(source.id, before.revision, { ...before, template: { templateId: version.id, revisionId: version.revisionId } }, chat.id);
  expect((await spaces.read(source.id, chat.id))!.draft.text).toBe(before.text);
  const job = await tasks.freezeChat(target, before.revision + 1, basis);
  expect(job.snapshot).toMatchObject({ knowledgeFormat: 1, input: before.text, templateSnapshot: { ...identity, revision: 2, requirements: content.requirements } });
  await tasks.finish(job.jobId, job.attempts[0].attemptId, 'stopped');
  await templates.save(version.id, version.revision, { ...content, outputType: 'markdown', requirements: '后来改为笔记' });
  const retry = await tasks.retry(job.jobId);
  expect(retry.snapshot).toEqual(job.snapshot);
  expect(await templates.revision(version.id, version.revisionId)).toEqual('input' in job.snapshot ? job.snapshot.templateSnapshot : undefined);
});
test('a newly created explicit knowledge template freezes normally, but omission remains legacy; unknown or mismatched protocol is rejected', async () => {
  const { name, tasks, spaces, target } = await legacy(), templates = new IndexedTemplateStore(name);
  const missing = await templates.create(content), draft = (await spaces.read(source.id, chat.id))!.draft;
  await spaces.save(source.id, draft.revision, { ...draft, template: { templateId: missing.id, revisionId: missing.revisionId } }, chat.id);
  await expect(tasks.freezeChat(target, draft.revision + 1, basis)).rejects.toMatchObject({ code: 'legacy-knowledge' });
  const fresh = await templates.create({ ...content, ...identity });
  const current = (await spaces.read(source.id, chat.id))!.draft;
  await spaces.save(source.id, current.revision, { ...current, template: { templateId: fresh.id, revisionId: fresh.revisionId } }, chat.id);
  expect((await tasks.freezeChat(target, current.revision + 1, basis)).snapshot).toMatchObject({ knowledgeFormat: 1, templateSnapshot: { ...identity, revision: 1 } });
  await expect(templates.create({ ...content, outputProtocol: 'unknown' } as any)).rejects.toMatchObject({ code: 'invalid-message' });
  await expect(templates.create({ ...content, ...identity, outputType: 'chat' })).rejects.toMatchObject({ code: 'invalid-message' });
});
test('v1/v2 legacy packages and format3 new identity round trip; conflict copies remap all frozen dependencies without upgrading old revisions', async () => {
  const { name, backup, spaces, tasks, target, version } = await converted();
  const draft = (await spaces.read(source.id, chat.id))!.draft;
  await spaces.save(source.id, draft.revision, { ...draft, template: { templateId: version.id, revisionId: version.revisionId } }, chat.id);
  const job = await tasks.freezeChat(target, draft.revision + 1, basis);
  await tasks.finish(job.jobId, job.attempts[0].attemptId, 'stopped');
  // Include an old-version bound draft alongside the new frozen request.
  const other = await spaces.createChat(source.id);
  await spaces.save(source.id, 0, { ...other.draft, text: '旧版本', outputType: 'html', modelId: 'synthetic-a', template: chat.draft.template }, other.chatId);
  const file = await backup.export(), importedName = crypto.randomUUID(), importer = new IndexedBackupStore(importedName);
  const first = await importer.preview(file); await importer.execute(first.planId, first.checksum);
  expect(JSON.parse(await importer.export()).payload.templateRevisions).toEqual(JSON.parse(file).payload.templateRevisions);
  // Force a conflicting template graph; copied Chats/requests must follow its mapped revisions.
  await new IndexedTemplateStore(importedName).save(version.id, version.revision, { ...content, ...identity, requirements: '本机修改' });
  const second = await importer.preview(file); await importer.execute(second.planId, second.checksum);
  const mapped = (id: string) => second.mapping.find(m => m.from === id)!.to;
  expect(mapped(version.id)).not.toBe(version.id);
  const copiedTasks = new IndexedGenerationStore(importedName), copied = (await copiedTasks.get(mapped(job.jobId)))!;
  expect(copied.snapshot).toMatchObject({ target: { chatId: mapped(chat.id) }, templateRevisionId: mapped(version.revisionId), templateSnapshot: { ...identity, templateId: mapped(version.id), revisionId: mapped(version.revisionId) } });
  const copiedSpaces = new IndexedWorkspaceStore(importedName), copiedOld = (await copiedSpaces.read(source.id, mapped(other.chatId)))!;
  expect(copiedOld.draft.template).toEqual({ templateId: mapped(version.id), revisionId: mapped(chat.draft.template.revisionId) });
  await expect(copiedTasks.freezeChat({ ...target, chatId: copiedOld.chatId }, copiedOld.draft.revision, basis)).rejects.toMatchObject({ code: 'legacy-knowledge' });
  await new IndexedBackupStore(crypto.randomUUID()).preview(await importer.export());
  const newPacket = JSON.parse(file);
  for (const mutate of [
    (p: any) => p.payload.templates[0].outputProtocol = 'unknown',
    (p: any) => p.manifest.formatVersion = 2,
    (p: any) => { delete p.payload.jobs[0].snapshot.templateSnapshot.outputProtocol; }
  ]) {
    const packet = structuredClone(newPacket); mutate(packet); packet.manifest.checksum = await digest(packet.payload);
    await expect(new IndexedBackupStore(crypto.randomUUID()).preview(JSON.stringify(packet))).rejects.toMatchObject({ code: 'invalid-message' });
  }
  const v1 = JSON.parse(fixture); v1.manifest.formatVersion = 1; v1.manifest.databaseVersion = 7;
  delete v1.payload.attachments; v1.manifest.types = v1.manifest.types.filter((t: string) => t !== 'attachments'); v1.manifest.checksum = await digest(v1.payload);
  const oldImporter = new IndexedBackupStore(crypto.randomUUID()), oldPlan = await oldImporter.preview(JSON.stringify(v1)); await oldImporter.execute(oldPlan.planId, oldPlan.checksum);
  expect(JSON.parse(await oldImporter.export()).payload.templateRevisions[0]).toEqual(old.templateRevisions[0]);
});
