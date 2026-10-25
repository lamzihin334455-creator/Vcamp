import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { databaseTransaction } from '../../src/data/database';
import { createLibraryService } from '../../src/library/service';
import { libraryCommandSchema, libraryViewSchema, type LibraryCommand } from '../../src/contracts/library';
import { createBackupFile, previewBackupFile } from '../../src/library/backup-file';
import { seedBackup } from '../fixtures/t20-semantic';
import { digest } from '../../src/data/backup-format';
import { IndexedArtifactStore } from '../../src/data/artifact-store';
import { IndexedAttachmentStore } from '../../src/data/attachment-store';
import { png } from '../fixtures/png';
import { encodeStream } from '../../src/data/backup-stream';

function client(name: string, backup = new IndexedBackupStore(name)) {
  const service = createLibraryService(new IndexedLibraryStore(name), async () => {}, async () => {}, undefined, undefined, undefined, backup);
  return async (command: LibraryCommand) => libraryViewSchema.parse(await service.command(libraryCommandSchema.parse(command)));
}

test('a library larger than 64 MiB exports through bounded messages and restores completely', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name);
  const workspace = await spaces.open({ platform: 'bilibili', videoId: 'BVlargeBackup', partId: '1', title: '大容量备份合成样本' });
  const text = '合成资料🌸'.repeat(16666);
  await databaseTransaction(name, ['scribbles'], 'readwrite', (tx, done) => {
    for (let i = 0; i < 330; i++) tx.objectStore('scribbles').add({ id: `large-${i}`, workspaceId: workspace.id, text, time: i, revision: 1 });
    done(undefined);
  });
  const file = await createBackupFile(client(name));
  expect(file.size).toBeGreaterThan(64 * 1024 * 1024);
  const targetName = crypto.randomUUID(), target = new IndexedBackupStore(targetName);
  const plan = await previewBackupFile(new File([file], 'large.vcamp'), client(targetName, target));
  expect(plan.counts.scribbles).toBe(330);
  await target.execute(plan.planId, plan.checksum);
  const restored = await databaseTransaction<any[]>(targetName, ['scribbles'], 'readonly', (tx, done) => { const rows = tx.objectStore('scribbles').getAll(); rows.onsuccess = () => done(rows.result); });
  expect(restored).toHaveLength(330);
  expect(restored.every(row => row.text === text)).toBe(true);
}, 60000);

test('stream transfers reject missing, reordered, corrupt and repeated parts without writing any durable rows', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name);
  const workspace = await spaces.open({ platform: 'bilibili', videoId: 'BVparts', partId: '1', title: '分段校验' });
  await databaseTransaction(name, ['scribbles'], 'readwrite', (tx, done) => {
    for (let i = 0; i < 4; i++) tx.objectStore('scribbles').put({ id: `part-${i}`, workspaceId: workspace.id, text: '字🌸'.repeat(30000), time: i, revision: 1 }); done(undefined);
  });
  const source = new IndexedBackupStore(name), transfer = await source.beginExport(), target = new IndexedBackupStore(crypto.randomUUID());
  const incoming = await target.beginImport(transfer.manifest), part = source.exportPart(transfer.id, 0).data;
  await expect(target.finishImport(incoming.id)).rejects.toMatchObject({ code: 'invalid-message' });
  await expect(target.appendImport(incoming.id, 1, part)).rejects.toMatchObject({ code: 'invalid-message' });
  await expect(target.appendImport(incoming.id, 0, part.replace('part-0', 'oops-0'))).rejects.toMatchObject({ code: 'invalid-message' });
  await target.appendImport(incoming.id, 0, part);
  await expect(target.appendImport(incoming.id, 0, part)).rejects.toMatchObject({ code: 'invalid-message' });
  expect(JSON.parse(await target.export()).payload.workspaces).toEqual([]);
  target.releaseTransfer(incoming.id);
  await expect(target.finishImport(incoming.id)).rejects.toMatchObject({ code: 'plan-expired' });
  source.releaseTransfer(transfer.id);
  expect(() => source.exportPart(transfer.id, 0)).toThrow('plan-expired');
});

test('a single new-format file preserves the existing graph, preferences and legacy JSON compatibility', async () => {
  const sourceName = crypto.randomUUID(), seeded = await seedBackup(sourceName);
  await new IndexedArtifactStore(sourceName).save(seeded.a.id, seeded.note.id, 2, '长记录🌸\n'.repeat(70000));
  const space = (await new IndexedWorkspaceStore(sourceName).read(seeded.a.id, seeded.a.chatId))!;
  await new IndexedAttachmentStore(sourceName).add({ workspaceId: space.id, chatId: space.chatId }, { platform: 'bilibili', videoId: space.source.videoId, partId: space.source.partId, tabId: 1, documentId: 'synthetic', epoch: 1 }, space.draft.revision, { dataUrl: png(), width: 2, height: 2, time: 3 });
  const preferences = { accent: '#c95c81', webDefault: true }, stored = { value: {} as typeof preferences };
  const source = new IndexedBackupStore(sourceName, { read: async () => preferences, write: async () => {} });
  const file = await createBackupFile(client(sourceName, source)), targetName = crypto.randomUUID();
  const target = new IndexedBackupStore(targetName, { read: async () => stored.value, write: async value => { stored.value = value as typeof preferences; } });
  const plan = await previewBackupFile(new File([file], 'complete.vcamp'), client(targetName, target));
  expect(JSON.parse(await target.export()).payload.workspaces).toEqual([]);
  await target.execute(plan.planId, plan.checksum); expect(stored.value).toEqual(preferences);
  const original = JSON.parse(await source.export()).payload, restored = JSON.parse(await target.export()).payload;
  for (const table of Object.keys(original)) expect(restored[table].length, table).toBe(original[table].length);
  expect(restored.attachments[0].dataUrl).toBe(original.attachments[0].dataUrl);
  expect(restored.noteRevisions.map((r: { content: string }) => r.content)).toEqual(original.noteRevisions.map((r: { content: string }) => r.content));
  const thirdName = crypto.randomUUID(), third = new IndexedBackupStore(thirdName);
  const legacy = await previewBackupFile(new File([await source.export()], 'old.json'), client(thirdName, third));
  await expect(third.execute(legacy.planId, legacy.checksum)).resolves.toMatchObject({ added: legacy.added });
});

test('new-format restore rolls back a quota fault while retaining existing local materials', async () => {
  const sourceName = crypto.randomUUID(); await seedBackup(sourceName);
  const file = new File([await createBackupFile(client(sourceName))], 'rollback.vcamp');
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), backup = new IndexedBackupStore(name);
  await spaces.open({ platform: 'bilibili', videoId: 'BVlocalMaterial', partId: '1', title: '本机原资料' });
  const before = JSON.parse(await backup.export()).payload;
  const plan = await previewBackupFile(file, client(name, backup)), originalPut = IDBObjectStore.prototype.put;
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'scribbles') throw new DOMException('synthetic quota', 'QuotaExceededError');
    return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
  });
  try { await expect(backup.execute(plan.planId, plan.checksum)).rejects.toMatchObject({ code: 'storage-failed' }); } finally { fault.mockRestore(); }
  expect(JSON.parse(await backup.export()).payload).toEqual(before);
  await expect(backup.execute(plan.planId, plan.checksum)).resolves.toMatchObject({ added: plan.added });
});

test('truncated, appended and tampered files are rejected; cancelled reads release transfers', async () => {
  const name = crypto.randomUUID(); await new IndexedWorkspaceStore(name).open({ platform: 'bilibili', videoId: 'BVdamage', partId: '1', title: '完整性' });
  const file = await createBackupFile(client(name)), targetName = crypto.randomUUID(), target = new IndexedBackupStore(targetName), call = client(targetName, target);
  await expect(previewBackupFile(new File([file.slice(0, file.size - 1)], 'missing.vcamp'), call)).rejects.toMatchObject({ code: 'invalid-message' });
  await expect(previewBackupFile(new File([file, 'x'], 'extra.vcamp'), call)).rejects.toMatchObject({ code: 'invalid-message' });
  const text = await file.text(), end = text.indexOf('\n'), header = JSON.parse(text.slice(0, end));
  header.checksum = '0'.repeat(64);
  await expect(previewBackupFile(new File([JSON.stringify(header), text.slice(end)], 'bad.vcamp'), call)).rejects.toMatchObject({ code: 'invalid-message' });
  const controller = new AbortController(), calls: string[] = [];
  await expect(previewBackupFile(new File([file], 'cancel.vcamp'), async command => {
    calls.push(command.type); const view = await call(command);
    if (command.type === 'library.backup.import.append') controller.abort(); return view;
  }, () => {}, controller.signal)).rejects.toMatchObject({ code: 'plan-expired' });
  expect(calls.at(-1)).toBe('library.backup.release');
  expect(JSON.parse(await target.export()).payload.workspaces).toEqual([]);
});

test('expired transfers, excess sessions and overlarge declarations fail without evicting an active transfer', async () => {
  const name = crypto.randomUUID(); await new IndexedWorkspaceStore(name).open({ platform: 'bilibili', videoId: 'BVexpiry', partId: '1', title: '过期保护' });
  const backup = new IndexedBackupStore(name), first = await backup.beginExport(), second = await backup.beginExport();
  await expect(backup.beginExport()).rejects.toMatchObject({ code: 'resource-limit' });
  expect(backup.exportPart(first.id, 0).data).toBeTruthy(); backup.releaseTransfer(second.id);
  const raw = JSON.parse(first.manifest); raw.parts = Array.from({ length: 600 }, () => ({ bytes: 1024 * 1024, sha256: '0'.repeat(64) }));
  const { checksum: _checksum, ...unsigned } = raw; raw.checksum = await digest(unsigned);
  await expect(backup.beginImport(JSON.stringify(raw))).rejects.toMatchObject({ code: 'resource-limit' });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600001);
  try { expect(() => backup.exportPart(first.id, 0)).toThrow('plan-expired'); } finally { clock.mockRestore(); }
});

test('an empty library can export and preview without inventing a transport part', async () => {
  const file = await createBackupFile(client(crypto.randomUUID())), name = crypto.randomUUID(), target = new IndexedBackupStore(name);
  const plan = await previewBackupFile(new File([file], 'empty.vcamp'), client(name, target));
  expect(plan.counts.attachments).toBe(0); expect(plan.counts.workspaces).toBe(0);
  await expect(target.execute(plan.planId, plan.checksum)).resolves.toMatchObject({ added: 0 });
});

test('valid transport checksums do not bypass PNG integrity validation', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name);
  const space = await spaces.open({ platform: 'bilibili', videoId: 'BVimageIntegrity', partId: '1', title: '图片校验' });
  await new IndexedAttachmentStore(name).add({ workspaceId: space.id, chatId: space.chatId }, { platform: 'bilibili', videoId: 'BVimageIntegrity', partId: '1', tabId: 1, documentId: 'synthetic', epoch: 1 }, 0, { dataUrl: png(), width: 2, height: 2, time: 0 });
  const packet = JSON.parse(await new IndexedBackupStore(name).export()); packet.payload.attachments[0].sha256 = '0'.repeat(64);
  const forged = await encodeStream(packet.payload), targetName = crypto.randomUUID(), target = new IndexedBackupStore(targetName);
  const file = new File([forged.manifest + '\n', ...forged.parts], 'forged.vcamp');
  await expect(previewBackupFile(file, client(targetName, target))).rejects.toMatchObject({ code: 'invalid-message' });
  expect(JSON.parse(await target.export()).payload.attachments).toEqual([]);
});
