import { ApplicationError } from '../contracts/application';
import type { BackupPlan } from '../contracts/backup';
import { terminal } from '../contracts/generation';
import { backupTables, canonical, digest, rowKey, type BackupPayload } from './backup-format';

type Row = Record<string, any>;
type Item = { table: keyof BackupPayload | 'chats'; row: Row; workspaceId?: string };
type Mapping = BackupPlan['mapping'];
const links = new Set(['id', 'jobId', 'attemptId', 'artifactId', 'sourceChatId', 'chatId', 'revisionId', 'templateId', 'roleId', 'styleId', 'templateRevisionId', 'versionId', 'subtitleVersionId', 'snapshotId', 'messageId', 'contentVersionId', 'recentChatId', 'attachmentId', 'attachmentIds', 'historyAttachmentIds', 'reuseAttachmentIds', 'referenceSnapshotIds', 'referenceIds', 'subtitleVersionIds']);
function rewrite(value: any, map: Map<string, string>, key = ''): any {
  if (key === 'webEvidence'||key === 'entry' || key === 'backupImports' || key === 'backupOriginalId') return structuredClone(value);
  if (typeof value === 'string') return links.has(key) ? map.get(value) ?? value : value;
  if (Array.isArray(value)) return value.map(v => rewrite(v, map, key));
  if (value && typeof value === 'object') {
    const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, map, k)]));
    // htmlStyle is also a two-ID draft selection; provenance belongs only to frozen revisions.
    if ((key === 'templateSnapshot' || key === 'roleSnapshot'||key==='htmlStyle'&&typeof value.revision==='number') && map.has(value.revisionId)) result.backupOriginalId = value.backupOriginalId ?? value.revisionId;
    return result;
  }
  return value;
}
const favoriteId = (r: Row) => JSON.stringify([r.folderId, r.target.workspaceId, r.target.entityType, r.target.id]);
function mapped(item: Item, map: Map<string, string>, copy: boolean): Item {
  const row = rewrite(item.row, map);
  if (item.table === 'favorites') { row.folderId = map.get(item.row.folderId) ?? item.row.folderId; row.id = favoriteId(row); }
  if ((item.table === 'chats' || item.table === 'folders') && copy) row.backupOriginalId = item.row.backupOriginalId ?? item.row.id;
  if ((item.table === 'templates' || item.table === 'templateRevisions' || item.table === 'roles' || item.table === 'roleRevisions'||item.table==='styles'||item.table==='styleRevisions') && copy) row.backupOriginalId = item.row.backupOriginalId ?? rowKey(item.table, item.row);
  return { ...item, row };
}
function normalized(payload: BackupPayload): BackupPayload {
  const data = structuredClone(payload);
  const states = new Map<string, string>();
  for (const job of data.jobs) for (const attempt of job.attempts) {
    if (!terminal(attempt.state)) { states.set(attempt.attemptId, 'interrupted'); attempt.importedState = attempt.state; attempt.state = 'interrupted'; attempt.error = 'executor-lost'; if(attempt.webEvidence?.status==='searching')attempt.webEvidence.status='failed'; }
  }
  for (const ws of data.workspaces) for (const chat of ws.chats) for (const message of chat.messages ?? []) if (message.attemptId && states.has(message.attemptId)) { message.state = 'interrupted'; if(message.webEvidence?.status==='searching')message.webEvidence.status='failed'; }
  return data;
}
function ownJobIds(jobs: Row[]) { return jobs.flatMap(j => [j.jobId, j.snapshot.snapshotId, ...j.attempts.map((a: Row) => a.attemptId)]); }
function snapshotIds(value: any): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(snapshotIds);
  return [...(typeof value.snapshotId === 'string' ? [value.snapshotId] : []), ...Object.values(value).flatMap(snapshotIds)];
}

// A component is accepted only when ALL mapped contents and relationships are
// equal or absent. Any changed member makes a new copy of the complete component.
export async function mergeBackup(input: BackupPayload, local: BackupPayload) {
  const incoming = normalized(input), map = new Map<string, string>(), mapping: Mapping = [], writes: Item[] = [];
  let conflicts = 0, skipped = 0, added = 0;
  const current = structuredClone(local) as unknown as Record<string, Row[]>;
  const locate = (item: Item): Row | undefined => item.table === 'chats'
    ? current.workspaces.find(w => w.id === item.workspaceId)?.chats.find((c: Row) => c.id === item.row.id)
    : current[item.table].find(r => rowKey(item.table as keyof BackupPayload, r) === rowKey(item.table as keyof BackupPayload, item.row));
  const fits = (items: Item[]) => items.every(item => {
    if (item.table === 'chats' && current.workspaces.some(w => w.id !== item.workspaceId && w.chats.some((c: Row) => c.id === item.row.id))) return false;
    const key = item.table === 'chats' ? item.row.id : rowKey(item.table, item.row);
    if (backupTables.some(t => t !== item.table && current[t].some(r => rowKey(t, r) === key))) return false;
    const old = locate(item); return !old || canonical(old) === canonical(item.row);
  });
  async function group(kind: string, items: Item[], ids: string[], forceCopy = false) {
    if (!items.length) return;
    ids = [...new Set(ids)];
    let selected = items.map(item => mapped(item, map, false)), copied = false;
    if (forceCopy || !fits(selected)) {
      conflicts++; copied = true;
      const fingerprint = await digest(selected);
      let found = false;
      for (let suffix = 0; suffix < 100; suffix++) {
        const candidate = new Map(map);
        await Promise.all(ids.map(async original => {
          const hash = await digest([kind, fingerprint, original, suffix]);
          candidate.set(original, `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`);
        }));
        selected = items.map(item => mapped(item, candidate, true));
        if (fits(selected)) { for (const original of ids) map.set(original, candidate.get(original)!); found = true; break; }
      }
      if (!found) throw new ApplicationError('resource-limit');
    }
    for (const id of ids) mapping.push({ kind, from: id, to: map.get(id) ?? id });
    for (const item of selected) {
      if (locate(item)) skipped++;
      else { writes.push(item); added++; if (item.table === 'chats') current.workspaces.find(w => w.id === item.workspaceId)!.chats.push(item.row); else current[item.table].push(item.row); }
    }
    return copied;
  }
  for (const template of incoming.templates) {
    const revisions = incoming.templateRevisions.filter(r => r.templateId === template.id);
    await group('template', [{ table: 'templates', row: { ...template, builtin: false } }, ...revisions.map(row => ({ table: 'templateRevisions' as const, row }))], [template.id, ...revisions.map(r => r.revisionId)], template.builtin);
  }
  for (const role of incoming.roles) {
    const revisions = incoming.roleRevisions.filter(r => r.roleId === role.id);
    await group('role', [{ table: 'roles', row: { ...role, builtin: false } }, ...revisions.map(row => ({ table: 'roleRevisions' as const, row }))], [role.id, ...revisions.map(r => r.revisionId)], role.builtin);
  }
  for (const style of incoming.styles) {
    const revisions = incoming.styleRevisions.filter(r => r.styleId === style.id);
    await group('style', [{ table: 'styles', row: { ...style, builtin: false } }, ...revisions.map(row => ({ table: 'styleRevisions' as const, row }))], [style.id, ...revisions.map(r => r.revisionId)], style.builtin);
  }
  for (const ws of incoming.workspaces) {
    const mappingStart = mapping.length, addedStart = added;
    let old = current.workspaces.find(r => r.id === ws.id);
    if (!old) { old = { ...ws, chats: [] }; current.workspaces.push(old); added++; }
    else skipped++;
    const deletionConflict = !!old.deleted !== !!ws.deleted || (old.deleted && (old.deletedAt !== ws.deletedAt || old.managementRevision !== ws.managementRevision));
    const inheritedDeletion = (row: Row): Row => ws.deleted && !old!.deleted && !row.deleted ? { ...row, deleted: true, deletedAt: ws.deletedAt ?? 0, managementRevision: (row.managementRevision ?? 0) + 1 } : row;
    for (const scribble of incoming.scribbles.filter(r => r.workspaceId === ws.id)) await group('scribble', [{ table: 'scribbles', row: inheritedDeletion(scribble) }], [scribble.id], deletionConflict);
    const subtitles = incoming.subtitleVersions.filter(r => r.workspaceId === ws.id), subtitleJobs = incoming.jobs.filter(j => j.snapshot.target.kind === 'subtitle' && j.snapshot.target.workspaceId === ws.id);
    await group('subtitle', [...subtitles.map(row => ({ table: 'subtitleVersions' as const, row: inheritedDeletion(row) })), ...subtitleJobs.map(row => ({ table: 'jobs' as const, row }))], [...subtitles.map(r => r.id), ...ownJobIds(subtitleJobs)], deletionConflict);
    for (const chat of ws.chats) {
      const jobs = incoming.jobs.filter(j => j.snapshot.target.kind === 'chat' && j.snapshot.target.workspaceId === ws.id && j.snapshot.target.chatId === chat.id);
      const artifacts = incoming.artifacts.filter(r => r.workspaceId === ws.id && r.sourceChatId === chat.id), revisions = incoming.noteRevisions.filter(r => artifacts.some(a => a.id === r.artifactId));
      const attachments=incoming.attachments.filter(a=>a.workspaceId===ws.id&&a.chatId===chat.id);
      const historyIds = jobs.flatMap(j => 'historyProjection' in j.snapshot ? j.snapshot.historyProjection.flatMap(h => [h.messageId, h.contentVersionId]) : []);
      const ids = [chat.id, ...attachments.map(a=>a.id), ...(chat.messages ?? []).flatMap(m => [m.messageId, m.contentVersionId]), ...historyIds, ...ownJobIds(jobs), ...artifacts.map(a => a.id), ...revisions.map(r => r.id), ...snapshotIds(jobs), ...snapshotIds(chat.messages)];
      await group('chat', [{ table: 'chats', workspaceId: ws.id, row: inheritedDeletion(chat) }, ...attachments.map(row=>({table:'attachments' as const,row})), ...jobs.map(row => ({ table: 'jobs' as const, row })), ...artifacts.map(row => ({ table: 'artifacts' as const, row: inheritedDeletion(row) })), ...revisions.map(row => ({ table: 'noteRevisions' as const, row }))], ids, deletionConflict);
    }
    // Preserve original workspace tombstone and imported alternatives to local
    // singleton choices, with mapped IDs. They remain part of subsequent exports.
    const fingerprint = await digest(ws);
    const imports = old.backupImports ?? [];
    const originalDeletions = [...ws.chats.map(row => ({ kind: 'chat', row })), ...incoming.artifacts.filter(r => r.workspaceId === ws.id).map(row => ({ kind: row.type, row })), ...incoming.scribbles.filter(r => r.workspaceId === ws.id).map(row => ({ kind: 'scribble', row })), ...subtitles.map(row => ({ kind: 'subtitle', row }))].map(({ kind, row }) => ({ kind, id: row.id, ...(row.deleted !== undefined ? { deleted: row.deleted } : {}), ...(row.deletedAt !== undefined ? { deletedAt: row.deletedAt } : {}), ...(row.managementRevision !== undefined ? { managementRevision: row.managementRevision } : {}) }));
    const record = { fingerprint, originalWorkspaceId: ws.id, source: ws.source, ...(ws.lastOpenedAt !== undefined ? { lastOpenedAt: ws.lastOpenedAt } : {}), ...(ws.analysisSourceRevision !== undefined ? { analysisSourceRevision: ws.analysisSourceRevision } : {}), originalDeletions, ...(ws.deleted !== undefined ? { deleted: ws.deleted } : {}), ...(ws.deletedAt !== undefined ? { deletedAt: ws.deletedAt } : {}), ...(ws.managementRevision !== undefined ? { managementRevision: ws.managementRevision } : {}), recentChatId: map.get(ws.recentChatId) ?? ws.recentChatId, ...(ws.analysisSource ? { analysisSource: rewrite(ws.analysisSource, map) } : {}), ...(ws.watchPosition ? { watchPosition: ws.watchPosition } : {}), mapping: [...mapping.slice(0, mappingStart).filter(m => m.kind === 'template' || m.kind === 'role'), ...mapping.slice(mappingStart)].filter(m => m.from !== m.to) };
    if (!local.workspaces.some(w => w.id === ws.id)) {
      old.recentChatId = map.get(ws.recentChatId) ?? ws.recentChatId;
      if (ws.analysisSource) old.analysisSource = rewrite(ws.analysisSource, map);
      if (ws.subtitleVersionIds) old.subtitleVersionIds = ws.subtitleVersionIds.map(id => map.get(id) ?? id);
      if (record.mapping.length && !imports.some((r: Row) => canonical(r) === canonical(record))) old.backupImports = [...imports, record];
    } else {
      if (subtitles.length) old.subtitleVersionIds = [...new Set([...(old.subtitleVersionIds ?? []), ...subtitles.map(s => map.get(s.id) ?? s.id)])];
      const localWs = local.workspaces.find(w => w.id === ws.id)!;
      const choicesDiffer = canonical([localWs.source, localWs.recentChatId, localWs.analysisSource, localWs.watchPosition, localWs.deleted, localWs.deletedAt, localWs.managementRevision]) !== canonical([ws.source, ws.recentChatId, ws.analysisSource, ws.watchPosition, ws.deleted, ws.deletedAt, ws.managementRevision]);
      if ((added > addedStart || choicesDiffer) && !imports.some((r: Row) => canonical(r) === canonical(record))) { old.backupImports = [...imports, record]; if (added === addedStart) added++; }
    }
  }
  for (const folder of incoming.folders) {
    const favorites = incoming.favorites.filter(f => f.folderId === folder.id);
    await group('folder', [{ table: 'folders', row: folder }, ...favorites.map(row => ({ table: 'favorites' as const, row }))], [folder.id]);
  }
  // Workspaces embed Chats; write each changed aggregate once, without touching
  // any local job, execution slot, selected Chat or draft.
  const output: Record<string, Row[]> = Object.fromEntries(backupTables.map(t => [t, writes.filter(i => i.table === t).map(i => i.row)]));
  output.workspaces = current.workspaces.filter(w => canonical(w) !== canonical(local.workspaces.find(s => s.id === w.id)));
  for (const job of output.jobs) {
    job.basis.binding = { ...job.basis.binding, tabId: -1, documentId: 'backup-history', epoch: -1 };
    job.attempts = job.attempts.map((a: Row) => ({ ...a, executor: null, claimed: false, completionToken: null }));
  }
  return { writes: output, added, skipped, conflicts, mapping };
}
