import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedAttachmentStore } from '../../src/data/attachment-store';
import { IndexedRoleStore } from '../../src/data/role-store';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { encodeStream } from '../../src/data/backup-stream';
import { encode } from '../../src/data/backup-format';
import { previewBackupFile } from '../../src/library/backup-file';
import { createLibraryService } from '../../src/library/service';
import { png } from '../fixtures/png';

async function sample(withImages = false, nextType: 'markdown' | 'html' | 'chat' = 'markdown', imageCount = 1) {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), jobs = new IndexedGenerationStore(name);
  const space = await spaces.open({ platform: 'bilibili', videoId: 'BVprojectedHistory', partId: '1', title: '历史片段合成样本' });
  const role = await new IndexedRoleStore(name).create({ name: '合成角色', description: '', instructions: '合成角色指令' });
  const target = { kind: 'chat' as const, workspaceId: space.id, chatId: space.chatId };
  const binding = { platform: 'bilibili' as const, videoId: 'BVprojectedHistory', partId: '1', tabId: 1, documentId: 'synthetic', epoch: 1 };
  if (withImages) for (let index = 0; index < imageCount; index++) await new IndexedAttachmentStore(name).add(target, binding, index, { dataUrl: png(), width: 2, height: 2, time: index });
  const draft = (await spaces.read(space.id, space.chatId))!.draft;
  await spaces.save(space.id, draft.revision, { ...draft, text: '第一轮带角色的请求', modelId: 'fixture', role: { roleId: role.id, revisionId: role.revisionId } }, space.chatId);
  const basis = { binding, locator: 'synthetic', fingerprint: 'synthetic', language: 'zh', cueCount: 1 };
  const first = await jobs.freezeChat(target, draft.revision + 1, basis, withImages);
  await jobs.finish(first.jobId, first.attempts[0].attemptId, 'failed', 'network');
  const next = (await spaces.read(space.id, space.chatId))!.draft;
  await spaces.save(space.id, next.revision, { ...next, text: '第二轮生成资料', outputType: nextType }, space.chatId);
  const second = await jobs.freezeChat(target, next.revision + 1, basis, withImages);
  await jobs.finish(second.jobId, second.attempts[0].attemptId, 'failed', 'network');
  const backup = new IndexedBackupStore(name), packet = JSON.parse(await backup.export());
  return { name, backup, packet, secondId: second.jobId };
}

async function previewPacket(packet: any, name = crypto.randomUUID()) {
  const encoded = await encodeStream(packet.payload, packet.preferences), backup = new IndexedBackupStore(name);
  const service = createLibraryService(new IndexedLibraryStore(name), async () => {}, async () => {}, undefined, undefined, undefined, backup);
  const file = new File([encoded.manifest + '\n', ...encoded.parts], 'history.vcamp');
  const plan = await previewBackupFile(file, command => service.command(command));
  return { backup, plan, name };
}

test.each([{ withImages: false, nextType: 'markdown' as const }, { withImages: true, nextType: 'markdown' as const }, { withImages: false, nextType: 'html' as const }, { withImages: true, nextType: 'html' as const }])('real artifact generation restores without changing saved history ($nextType, images=$withImages)', async ({ withImages, nextType }) => {
  const { packet, secondId } = await sample(withImages, nextType);
  const history = packet.payload.jobs.find((job: any) => job.jobId === secondId).snapshot.historyProjection[0];
  expect(history.roleSnapshot).toBeUndefined(); expect(history.attachmentIds).toHaveLength(withImages?1:0);
  const { backup, plan, name } = await previewPacket(packet);
  await backup.execute(plan.planId, plan.checksum);
  const restored = JSON.parse(await backup.export()).payload;
  const entry = restored.jobs.find((job: any) => job.jobId === secondId).snapshot.historyProjection[0];
  expect(entry).toEqual(history);
  expect(restored.workspaces[0].chats[0].messages[0].roleSnapshot).toBeDefined();
  if (withImages) expect(restored.workspaces[0].chats[0].messages[0].attachmentIds).toHaveLength(1);
  expect((await previewPacket(packet, name)).plan.added).toBe(0);
});

test('filtered history remains compatible with the legacy JSON importer', async () => {
  const { packet, secondId } = await sample(true);
  // Historical versions could omit images from the projected request without
  // deleting the original message. The importer must still accept those files.
  packet.payload.jobs.find((job:any)=>job.jobId===secondId).snapshot.historyProjection[0].attachmentIds=[];
  const file=await encode(packet.payload,packet.preferences);
  await expect(new IndexedBackupStore(crypto.randomUUID()).preview(file)).resolves.toHaveProperty('planId');
});

test('history can retain a nonempty ordered subset of the original screenshots', async () => {
  const { packet, secondId } = await sample(true, 'chat', 3);
  const original = packet.payload.workspaces[0].chats[0].messages[0];
  const history = packet.payload.jobs.find((job: any) => job.jobId === secondId).snapshot.historyProjection[0];
  history.attachmentIds = [original.attachmentIds[0], original.attachmentIds[2]];
  const { backup, plan } = await previewPacket(packet);
  await backup.execute(plan.planId, plan.checksum);
  const restored = JSON.parse(await backup.export()).payload.jobs.find((job: any) => job.jobId === secondId).snapshot.historyProjection[0];
  expect(restored.attachmentIds).toEqual(history.attachmentIds);
});

test('reordered history screenshots still conflict with the original version', async () => {
  const { packet, secondId } = await sample(true, 'chat', 3);
  const original = packet.payload.workspaces[0].chats[0].messages[0];
  packet.payload.jobs.find((job: any) => job.jobId === secondId).snapshot.historyProjection[0].attachmentIds = [original.attachmentIds[2], original.attachmentIds[0]];
  await expect(previewPacket(packet)).rejects.toMatchObject({ code: 'invalid-message' });
});

test('changed text under the same history version remains invalid', async () => {
  const { packet, secondId } = await sample();
  packet.payload.jobs.find((job: any) => job.jobId === secondId).snapshot.historyProjection[0].text = '伪造的不同正文';
  await expect(previewPacket(packet)).rejects.toMatchObject({ code: 'invalid-message' });
});

test('chat requests cannot silently omit an original history role', async () => {
  const { packet, secondId } = await sample(false, 'chat');
  delete packet.payload.jobs.find((job: any) => job.jobId === secondId).snapshot.historyProjection[0].roleSnapshot;
  await expect(previewPacket(packet)).rejects.toMatchObject({ code: 'invalid-message' });
});

test('an unrelated owned screenshot cannot replace the original history attachments', async () => {
  const { packet, secondId } = await sample(true);
  const extra = { ...packet.payload.attachments[0], id: crypto.randomUUID() }; packet.payload.attachments.push(extra);
  packet.payload.jobs.find((job: any) => job.jobId === secondId).snapshot.historyProjection[0].attachmentIds = [extra.id];
  await expect(previewPacket(packet)).rejects.toMatchObject({ code: 'invalid-message' });
});

test('a different valid role cannot replace the original history role', async () => {
  const { packet, secondId, name, backup } = await sample();
  const other = await new IndexedRoleStore(name).create({ name: '另一个合成角色', description: '', instructions: '不同的合成角色指令' });
  const withRoles = JSON.parse(await backup.export());
  const entry = withRoles.payload.jobs.find((job: any) => job.jobId === secondId).snapshot.historyProjection[0];
  entry.roleSnapshot = withRoles.payload.roleRevisions.find((revision: any) => revision.revisionId === other.revisionId);
  expect(packet.payload.jobs.length).toBe(withRoles.payload.jobs.length);
  await expect(previewPacket(withRoles)).rejects.toMatchObject({ code: 'invalid-message' });
});
