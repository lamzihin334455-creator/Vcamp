import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { expect, test } from 'vitest';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { createLibraryService } from '../../src/library/service';
import { libraryCommandSchema, libraryViewSchema, type LibraryCommand } from '../../src/contracts/library';
import { createBackupFile, previewBackupFile } from '../../src/library/backup-file';
import { backupTables } from '../../src/data/backup-format';
import { databaseTransaction } from '../../src/data/database';
import type { PortablePreferences } from '../../src/contracts/portable-preferences';

// Private local replay only. Never embed file bytes, personal text or raw errors
// in assertions/logs. All writes go to a fresh isolated fake IndexedDB database.
test.skipIf(!process.env.VCAMP_BACKUP_FILE)('a private stream backup restores, deduplicates and exports a portable copy', async () => {
  let preferences: PortablePreferences = {};
  const path = process.env.VCAMP_BACKUP_FILE!, name = crypto.randomUUID(), backup = new IndexedBackupStore(name, { read: async () => preferences, write: async value => { preferences = value; } });
  const service = createLibraryService(new IndexedLibraryStore(name), async () => {}, async () => {}, undefined, undefined, undefined, backup);
  let failedStage = 'file';
  const call = async (command: LibraryCommand) => {
    try { return libraryViewSchema.parse(await service.command(libraryCommandSchema.parse(command))); }
    catch (error) { failedStage = command.type; throw error; }
  };
  const file = new File([await readFile(path)], basename(path));
  let plan;
  try { plan = await previewBackupFile(file, call); }
  catch { throw new Error(`Private replay failed at ${failedStage}`); }
  expect(plan).toHaveProperty('planId');
  await expect(backup.execute(plan.planId, plan.checksum)).resolves.toMatchObject({ preferencesRestored: true });
  const counts = await databaseTransaction<Record<string, number>>(name, backupTables, 'readonly', (tx, done) => {
    const result: Record<string, number> = {}; let remaining = backupTables.length;
    for (const table of backupTables) { const count = tx.objectStore(table).count(); count.onsuccess = () => { result[table] = count.result; if (!--remaining) done(result); }; }
  });
  for (const table of backupTables) expect(counts[table] === plan.counts[table], `${table} row count`).toBe(true);
  const repeat = await previewBackupFile(file, call); expect(repeat.added).toBe(0);
  const copy = new File([await createBackupFile(call)], 'private-copy.vcamp');
  const nextName = crypto.randomUUID(), next = new IndexedBackupStore(nextName);
  const nextService = createLibraryService(new IndexedLibraryStore(nextName), async () => {}, async () => {}, undefined, undefined, undefined, next);
  await expect(previewBackupFile(copy, command => nextService.command(command))).resolves.toHaveProperty('planId');
}, 180000);
