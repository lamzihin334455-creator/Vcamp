import { ApplicationError } from '../contracts/application';
import type { LibraryTarget } from '../contracts/library';
import { terminal, type GenerationJob } from '../contracts/generation';
import { databaseTransaction } from './database';
import { mediaLabels } from './library-store';
import type { StoredWorkspace } from './indexed-store';
import { backupLabel } from './backup-label';

export type DeletionState = { deleted?: boolean; deletedAt?: number; managementRevision?: number };
export type TrashEntry = { target: LibraryTarget; title: string; deletedAt: number; revision: number; parentDeleted: boolean };
export type DeletePreview = { target: LibraryTarget; title: string; revision: number; activeJobs: number };
const tables = ['workspaces', 'jobs', 'artifacts', 'scribbles', 'subtitleVersions'];
type Rows = Record<string, any[]>;
const tableFor = { workspace: 'workspaces', chat: 'workspaces', markdown: 'artifacts', html: 'artifacts', scribble: 'scribbles', subtitle: 'subtitleVersions' };

export class IndexedManagementStore {
  constructor(private name = 'vcamp') {}
  private transaction<T>(mode: IDBTransactionMode, operation: (rows: Rows, tx: IDBTransaction) => T): Promise<T> {
    return databaseTransaction(this.name, tables, mode, (tx, done, fail) => {
      const rows: Rows = {}; let left = tables.length;
      for (const key of tables) { const request = tx.objectStore(key).getAll(); request.onsuccess = () => {
        rows[key] = request.result;
        if (!--left) { try { done(operation(rows, tx)); } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); } }
      }; }
    });
  }
  private resolve(rows: Rows, target: LibraryTarget) {
    const space = rows.workspaces.find(row => row.id === target.workspaceId) as StoredWorkspace | undefined;
    if (!space) throw new ApplicationError('not-found');
    const row = target.entityType === 'workspace' ? target.id === space.id && space : target.entityType === 'chat' ? space.chats.find(chat => chat.id === target.id) : rows[tableFor[target.entityType]].find(row => row.id === target.id && row.workspaceId === space.id);
    if (!row || (target.entityType === 'markdown' || target.entityType === 'html') && row.type !== target.entityType && !(target.entityType==='html'&&row.type==='html-page')) throw new ApplicationError('not-found');
    const title = target.entityType === 'workspace' ? mediaLabels(space.source).partTitle : row.title ?? row.text?.slice(0, 60) ?? `${row.type} · ${row.language}`;
    return { row, space, title: backupLabel(space, target.id, title as string) };
  }
  private affected(job: GenerationJob, target: LibraryTarget) {
    const request = job.snapshot.target;
    return request.workspaceId === target.workspaceId && (target.entityType === 'workspace' || target.entityType === 'chat' && request.kind === 'chat' && request.chatId === target.id);
  }
  preview(target: LibraryTarget): Promise<DeletePreview> {
    return this.transaction('readonly', rows => {
      const { row, space, title } = this.resolve(rows, target);
      if (space.deleted || row.deleted) throw new ApplicationError('not-found');
      return { target, title, revision: row.managementRevision ?? 0, activeJobs: rows.jobs.filter(job => this.affected(job, target) && !terminal(job.attempts.at(-1).state)).length };
    });
  }
  move(target: LibraryTarget, expectedRevision: number): Promise<GenerationJob[]> {
    return this.transaction('readwrite', (rows, tx) => {
      const { row, space } = this.resolve(rows, target);
      if (space.deleted || row.deleted) throw new ApplicationError('not-found');
      if ((row.managementRevision ?? 0) !== expectedRevision) throw new ApplicationError('revision-conflict');
      row.deleted = true; row.deletedAt = Date.now(); row.managementRevision = expectedRevision + 1;
      if (target.entityType === 'chat') row.draft.revision++;
      if (target.entityType === 'workspace') for (const chat of space.chats) chat.draft.revision++;
      if (target.entityType === 'chat' && space.recentChatId === target.id) space.recentChatId = space.chats.find(chat => !chat.deleted)?.id ?? '';
      tx.objectStore(tableFor[target.entityType]).put(target.entityType === 'chat' ? space : row);
      const stopped: GenerationJob[] = [];
      for (const job of rows.jobs as GenerationJob[]) {
        const attempt = job.attempts.at(-1)!;
        if (!this.affected(job, target) || terminal(attempt.state)) continue;
        attempt.state = 'stopped'; if(attempt.webEvidence?.status==='searching')attempt.webEvidence.status='failed'; job.seq++;
        if (job.snapshot.target.kind === 'chat') {
          const chatId = job.snapshot.target.chatId, chat = space.chats.find(chat => chat.id === chatId);
          // Keep frozen request/history intact; only the live attempt projection changes.
          for (const message of chat?.messages ?? []) if (message.attemptId === attempt.attemptId) { message.state = 'stopped'; if(message.webEvidence?.status==='searching')message.webEvidence.status='failed'; }
        }
        tx.objectStore('jobs').put(job); stopped.push(job);
      }
      if (target.entityType === 'chat' || target.entityType === 'workspace') tx.objectStore('workspaces').put(space);
      return stopped;
    });
  }
  trash(): Promise<{ entries: TrashEntry[] }> {
    return this.transaction('readonly', rows => {
      const entries: TrashEntry[] = [];
      for (const space of rows.workspaces as StoredWorkspace[]) {
        const candidates: LibraryTarget[] = [{ workspaceId: space.id, entityType: 'workspace', id: space.id }, ...space.chats.map(chat => ({ workspaceId: space.id, entityType: 'chat' as const, id: chat.id }))];
        for (const [entityType, table] of [['markdown', 'artifacts'], ['scribble', 'scribbles'], ['subtitle', 'subtitleVersions']] as const) {
          for (const row of rows[table].filter(row => row.workspaceId === space.id)) {
            // Both HTML storage formats use the public `html` target type.
            const kind = table === 'artifacts' ? (row.type === 'html-page' ? 'html' : row.type) : entityType;
            candidates.push({ workspaceId: space.id, entityType: kind, id: row.id });
          }
        }
        for (const target of candidates) {
          const { row, title } = this.resolve(rows, target);
          if (row.deleted) entries.push({ target, title, deletedAt: row.deletedAt ?? 0, revision: row.managementRevision ?? 0, parentDeleted: target.entityType !== 'workspace' && !!space.deleted });
        }
      }
      return { entries: entries.sort((a, b) => b.deletedAt - a.deletedAt) };
    });
  }
  restore(target: LibraryTarget, expectedRevision: number): Promise<void> {
    return this.transaction('readwrite', (rows, tx) => {
      const { row, space } = this.resolve(rows, target);
      if (target.entityType !== 'workspace' && space.deleted) throw new ApplicationError('parent-deleted');
      if (!row.deleted) throw new ApplicationError('not-found');
      if ((row.managementRevision ?? 0) !== expectedRevision) throw new ApplicationError('revision-conflict');
      row.deleted = false; row.managementRevision = expectedRevision + 1;
      if (target.entityType === 'chat' && !space.recentChatId) space.recentChatId = target.id;
      // Never touch children, jobs, snapshots or favorite/folder relations.
      tx.objectStore(tableFor[target.entityType]).put(target.entityType === 'chat' ? space : row);
    });
  }
}
