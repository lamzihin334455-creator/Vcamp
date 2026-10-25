import {outputLimits} from '../contracts/output-limits';
import { ApplicationError } from '../contracts/application';
import type { MarkdownArtifact, NoteRevision, StoredArtifact } from '../contracts/artifact';
import { databaseTransaction } from './database';
import type { StoredWorkspace } from './indexed-store';

export class IndexedArtifactStore {
  constructor(private name = 'vcamp') {}
  // Public data behavior for deletion invalidation; no recycle-bin UI or restore.
  remove(workspaceId: string, artifactId: string): Promise<void> {
    return databaseTransaction(this.name, ['artifacts'], 'readwrite', (tx, done, fail) => {
      const rows = tx.objectStore('artifacts'), request = rows.get(artifactId);
      request.onsuccess = () => {
        const row: StoredArtifact | undefined = request.result;
        if (!row || row.workspaceId !== workspaceId) return fail(new ApplicationError('forbidden'));
        row.deleted = true; rows.put(row); done();
      };
    });
  }
  async save(workspaceId: string, artifactId: string, expectedRevision: number, content: string): Promise<MarkdownArtifact> {
    if (typeof content !== 'string' || content.length > outputLimits.markdownChars) throw new ApplicationError('invalid-message');
    return databaseTransaction(this.name, ['workspaces', 'artifacts', 'noteRevisions'], 'readwrite', (tx, done, fail) => {
      const rows = tx.objectStore('artifacts'), request = rows.get(artifactId), workspace = tx.objectStore('workspaces').get(workspaceId);
      workspace.onsuccess = () => {
        const row: StoredArtifact | undefined = request.result, record: StoredWorkspace | undefined = workspace.result;
        if (!row || row.deleted) return fail(new ApplicationError('not-found'));
        if (row.workspaceId !== workspaceId || row.type !== 'markdown') return fail(new ApplicationError('forbidden'));
        if (!record || record.deleted) return fail(new ApplicationError('not-found'));
        if (!record.chats.some(chat => chat.id === row.sourceChatId && !chat.deleted)) return fail(new ApplicationError('forbidden'));
        if (row.revision !== expectedRevision) return fail(new ApplicationError('revision-conflict'));
        const revision: NoteRevision = { id: crypto.randomUUID(), artifactId, revision: row.revision + 1, content };
        tx.objectStore('noteRevisions').add(revision);
        row.revision = revision.revision; row.revisionId = revision.id; rows.put(row);
        const attachmentIds=[...new Set(record.chats.find(chat=>chat.id===row.sourceChatId)?.messages?.filter(message=>message.jobId===row.jobId).flatMap(message=>message.attachmentIds)??[])].slice(0,6);
        done({ id: row.id, workspaceId, sourceChatId: row.sourceChatId, type: 'markdown' as const, title: row.title, revision: row.revision, revisionId: row.revisionId, content, ...(attachmentIds.length?{attachmentIds}:{}), ...(row.webEvidence?{webEvidence:row.webEvidence}:{}), sourceDeleted: !record.chats.some(chat => chat.id === row.sourceChatId && !chat.deleted) });
      };
    });
  }
  revisions(workspaceId: string, artifactId: string): Promise<NoteRevision[]> {
    return databaseTransaction(this.name, ['workspaces', 'artifacts', 'noteRevisions'], 'readonly', (tx, done, fail) => {
      const space = tx.objectStore('workspaces').get(workspaceId), row = tx.objectStore('artifacts').get(artifactId), revisions = tx.objectStore('noteRevisions').getAll();
      revisions.onsuccess = () => {
        if (!space.result || space.result.deleted || row.result?.deleted) return fail(new ApplicationError('not-found'));
        if (!row.result || row.result.workspaceId !== workspaceId) return fail(new ApplicationError('forbidden'));
        done((revisions.result as NoteRevision[]).filter(revision => revision.artifactId === artifactId).sort((a, b) => a.revision - b.revision));
      };
    });
  }
  list(workspaceId: string, sourceChatId?: string): Promise<MarkdownArtifact[]> {
    return databaseTransaction(this.name, ['workspaces', 'artifacts', 'noteRevisions'], 'readonly', (tx, done) => {
      const workspace = tx.objectStore('workspaces').get(workspaceId), rows = tx.objectStore('artifacts').getAll(), revisions = tx.objectStore('noteRevisions').getAll();
      revisions.onsuccess = () => {
        const record: StoredWorkspace | undefined = workspace.result;
        if (!record || record.deleted) { done([]); return; }
        const artifacts = (rows.result as StoredArtifact[]).filter(row => row.workspaceId === workspaceId && !row.deleted && row.type === 'markdown');
        done(artifacts.flatMap(row => {
          const revision = (revisions.result as NoteRevision[]).find(revision => revision.id === row.revisionId);
          const sourceDeleted = !record?.chats.some(chat => chat.id === row.sourceChatId && !chat.deleted);
          if (!revision || (sourceChatId !== undefined && (sourceDeleted || row.sourceChatId !== sourceChatId))) return [];
          const attachmentIds=[...new Set(record.chats.find(chat=>chat.id===row.sourceChatId)?.messages?.filter(message=>message.jobId===row.jobId).flatMap(message=>message.attachmentIds)??[])].slice(0,6);
          return [{ id: row.id, workspaceId, sourceChatId: row.sourceChatId, type: 'markdown' as const, title: row.title, revision: row.revision, revisionId: row.revisionId, content: revision.content, ...(attachmentIds.length?{attachmentIds}:{}), ...(row.webEvidence?{webEvidence:row.webEvidence}:{}), sourceDeleted }];
        }));
      };
    });
  }
}
