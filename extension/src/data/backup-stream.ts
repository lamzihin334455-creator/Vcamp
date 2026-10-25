import { ApplicationError } from '../contracts/application';
import { BACKUP_CHUNK_CHARS, BACKUP_HEADER_MAX_BYTES, BACKUP_STREAM_MAX_BYTES, backupStreamManifestSchema, type BackupStreamManifest } from '../contracts/backup';
import type { PortablePreferences } from '../contracts/portable-preferences';
import { backupTables, canonical, digest, payloadSchema, type BackupPayload } from './backup-format';
import { validateImage } from './image-validation';

const encoder = new TextEncoder();
export async function hashPart(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

// JSON lines retain every record, including dependencies and tombstones. Only
// transport parts are split: no dependency graph is restored independently.
export async function encodeStream(payload: BackupPayload, preferences?: PortablePreferences) {
  const parts: string[] = [], descriptors: BackupStreamManifest['parts'] = [];
  let pending = '', total = 0;
  async function flush() {
    if (!pending) return;
    const bytes = encoder.encode(pending).byteLength;
    total += bytes;
    if (total > BACKUP_STREAM_MAX_BYTES || parts.length >= 8192) throw new ApplicationError('resource-limit');
    parts.push(pending); descriptors.push({ bytes, sha256: await hashPart(pending) }); pending = '';
  }
  for (const table of backupTables) for (const row of payload[table]) {
    const line = JSON.stringify([table, row]) + '\n';
    let offset = 0;
    while (offset < line.length) {
      let count = Math.min(BACKUP_CHUNK_CHARS - pending.length, line.length - offset);
      const last = line.charCodeAt(offset + count - 1);
      if (last >= 0xd800 && last <= 0xdbff) count--;
      if (!count) { await flush(); continue; }
      pending += line.slice(offset, offset + count); offset += count;
      if (pending.length >= BACKUP_CHUNK_CHARS - 1) await flush();
    }
  }
  await flush();
  const unsigned = { format: 'vcamp-backup-stream' as const, formatVersion: 1 as const, databaseVersion: 10 as const, createdAt: Date.now(), types: backupTables, parts: descriptors, ...(preferences ? { preferences } : {}) };
  const manifest = JSON.stringify({ ...unsigned, checksum: await digest(unsigned) });
  if (encoder.encode(manifest).byteLength > BACKUP_HEADER_MAX_BYTES) throw new ApplicationError('resource-limit');
  return { manifest, parts };
}

export async function readStreamManifest(text: string): Promise<BackupStreamManifest> {
  if (encoder.encode(text).byteLength > BACKUP_HEADER_MAX_BYTES) throw new ApplicationError('resource-limit');
  try {
    const raw = JSON.parse(text), manifest = backupStreamManifestSchema.parse(raw);
    const { checksum, ...unsigned } = manifest;
    if (canonical(raw) !== canonical(manifest) || canonical(manifest.types) !== canonical(backupTables) || await digest(unsigned) !== checksum) throw new Error();
    if (manifest.parts.reduce((n, part) => n + part.bytes, 0) > BACKUP_STREAM_MAX_BYTES) throw new ApplicationError('resource-limit');
    return manifest;
  } catch (error) { throw error instanceof ApplicationError ? error : new ApplicationError('invalid-message'); }
}

export async function checkPart(manifest: BackupStreamManifest, index: number, text: string) {
  const expected = manifest.parts[index];
  if (!expected || text.length > BACKUP_CHUNK_CHARS || encoder.encode(text).byteLength !== expected.bytes || await hashPart(text) !== expected.sha256) throw new ApplicationError('invalid-message');
}

export async function decodeStream(manifest: BackupStreamManifest, parts: readonly string[]): Promise<BackupPayload> {
  if (parts.length !== manifest.parts.length) throw new ApplicationError('invalid-message');
  const raw = Object.fromEntries(backupTables.map(table => [table, []])) as Record<string, unknown[]>;
  const pending: string[] = []; let records = 0;
  function accept(line: string) {
    const entry = JSON.parse(line);
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !Object.hasOwn(raw, entry[0])) throw new ApplicationError('invalid-message');
    if (++records > 20000) throw new ApplicationError('resource-limit');
    raw[entry[0]].push(entry[1]);
  }
  try {
    for (let index = 0; index < parts.length; index++) {
      const text = parts[index]; await checkPart(manifest, index, text);
      let offset = 0, end: number;
      while ((end = text.indexOf('\n', offset)) !== -1) {
        pending.push(text.slice(offset, end)); accept(pending.join('')); pending.length = 0; offset = end + 1;
      }
      if (offset < text.length) pending.push(text.slice(offset));
    }
    if (pending.length) throw new Error();
    const payload = payloadSchema.parse(raw);
    for (const image of payload.attachments) {
      const value = await validateImage(image);
      if (value.sha256 !== image.sha256 || value.bytes !== image.bytes) throw new Error();
    }
    return payload;
  } catch (error) { throw error instanceof ApplicationError ? error : new ApplicationError('invalid-message'); }
}
