import { ApplicationError, type ApplicationClient } from '../contracts/application';
import { BACKUP_CHUNK_CHARS, BACKUP_HEADER_MAX_BYTES, BACKUP_MAX_BYTES, BACKUP_STREAM_MAX_BYTES, backupStreamManifestSchema, type BackupPlan } from '../contracts/backup';

type Call = NonNullable<ApplicationClient['library']>;
type Progress = (text: string) => void;
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const invalid = () => new ApplicationError('invalid-message');
const check = (signal?: AbortSignal) => { if (signal?.aborted) throw new ApplicationError('plan-expired'); };

export async function createBackupFile(call: Call, progress: Progress = () => {}, signal?: AbortSignal): Promise<Blob> {
  let transferId: string | undefined;
  try {
    check(signal); progress('正在准备资料备份…');
    const transfer = (await call({ type: 'library.backup.export', segmented: true })).backup?.transfer;
    if (!transfer?.manifest) throw invalid();
    transferId = transfer.id;
    const manifest = backupStreamManifestSchema.parse(JSON.parse(transfer.manifest));
    const parts: BlobPart[] = [transfer.manifest + '\n'];
    for (let index = 0; index < manifest.parts.length; index++) {
      check(signal);
      const data = (await call({ type: 'library.backup.part', transferId, index })).backup?.transfer?.data;
      if (data === undefined || data.length > BACKUP_CHUNK_CHARS || bytes(data) !== manifest.parts[index].bytes) throw invalid();
      parts.push(data); progress(`正在导出备份…${Math.round((index + 1) / manifest.parts.length * 100)}%`);
    }
    check(signal); return new Blob(parts, { type: 'application/octet-stream' });
  } finally {
    if (transferId) await call({ type: 'library.backup.release', transferId }).catch(() => {});
  }
}

export async function previewBackupFile(file: File, call: Call, progress: Progress = () => {}, signal?: AbortSignal): Promise<BackupPlan> {
  check(signal);
  if (file.size > BACKUP_STREAM_MAX_BYTES + BACKUP_HEADER_MAX_BYTES + 1) throw new ApplicationError('resource-limit');
  const first = await file.slice(0, BACKUP_HEADER_MAX_BYTES + 1).text(), newline = first.indexOf('\n');
  let header: ReturnType<typeof backupStreamManifestSchema.parse> | undefined;
  if (newline >= 0) {
    try {
      const candidate = JSON.parse(first.slice(0, newline));
      if (candidate.format === 'vcamp-backup-stream') header = backupStreamManifestSchema.parse(candidate);
    } catch { /* Legacy JSON is verified by the existing strict decoder. */ }
  }
  if (!header) {
    if (file.name.endsWith('.vcamp')) throw invalid();
    if (file.size > BACKUP_MAX_BYTES) throw new ApplicationError('resource-limit');
    check(signal); progress('正在校验备份…');
    const text = await file.text(); check(signal);
    const plan = (await call({ type: 'library.backup.preview', file: text })).backup?.plan;
    if (!plan) throw invalid(); return plan;
  }
  const manifest = first.slice(0, newline), headerBytes = bytes(manifest + '\n');
  if (headerBytes > BACKUP_HEADER_MAX_BYTES || file.size !== headerBytes + header.parts.reduce((n, part) => n + part.bytes, 0)) throw invalid();
  let transferId: string | undefined;
  try {
    check(signal);
    const transfer = (await call({ type: 'library.backup.import.begin', manifest })).backup?.transfer;
    if (!transfer) throw invalid(); transferId = transfer.id;
    let offset = headerBytes;
    for (let index = 0; index < header.parts.length; index++) {
      check(signal);
      const part = header.parts[index], data = await file.slice(offset, offset + part.bytes).text();
      if (data.length > BACKUP_CHUNK_CHARS || bytes(data) !== part.bytes) throw invalid();
      check(signal); await call({ type: 'library.backup.import.append', transferId, index, data }); offset += part.bytes;
      progress(`正在读取备份…${Math.round((index + 1) / header.parts.length * 100)}%`);
    }
    check(signal); progress('正在校验资料和恢复关系…');
    const plan = (await call({ type: 'library.backup.import.preview', transferId })).backup?.plan;
    if (!plan) throw invalid(); return plan;
  } finally {
    if (transferId) await call({ type: 'library.backup.release', transferId }).catch(() => {});
  }
}
