import { ApplicationError } from '../contracts/application';
import { knowledgeEntries, parseKnowledge, type KnowledgeArtifact, type KnowledgeContext, type HtmlPage } from '../contracts/knowledge';
import type { StoredArtifact, NoteRevision } from '../contracts/artifact';
import { databaseTransaction } from './database';
import type { StoredWorkspace } from './indexed-store';
export function selectedKnowledge(artifacts: StoredArtifact[], revisions: NoteRevision[], workspaceId: string, chatId: string, selection: {
  artifactId: string;
  revisionId: string;
  entryId: string;
}): KnowledgeContext {
  const artifact = artifacts.find(a => a.id === selection.artifactId);
  if (!artifact || artifact.deleted || artifact.type !== 'html' || artifact.workspaceId !== workspaceId || artifact.sourceChatId !== chatId || artifact.revisionId !== selection.revisionId)
    throw new ApplicationError('forbidden');
  const revision = revisions.find(r => r.id === selection.revisionId && r.artifactId === artifact.id);
  if (!revision)
    throw new ApplicationError('not-found');
  const doc = parseKnowledge(revision.content), entry = knowledgeEntries(doc).find(e => e.id === selection.entryId);
  if (!entry)
    throw new ApplicationError('forbidden');
  return { artifactId: selection.artifactId, revisionId: selection.revisionId, entryId: selection.entryId, snapshotId: crypto.randomUUID(), title: doc.title, entry };
}
export class IndexedKnowledgeStore {
  constructor(private name = 'vcamp') { }
  list(workspaceId:string, artifactId?:string):Promise<KnowledgeArtifact[]>;
  list(workspaceId:string, artifactId:string|undefined, includePages:true):Promise<(KnowledgeArtifact|HtmlPage)[]>;
  list(workspaceId: string, artifactId?: string, includePages=false): Promise<(KnowledgeArtifact | HtmlPage)[]> {
    return databaseTransaction(this.name, ['workspaces', 'artifacts', 'noteRevisions'], 'readonly', (tx, done, fail) => {
      const ws = tx.objectStore('workspaces').get(workspaceId), as = tx.objectStore('artifacts').getAll(), rs = tx.objectStore('noteRevisions').getAll();
      rs.onsuccess = () => {
        try {
          const space: StoredWorkspace | undefined = ws.result;
          if (!space || space.deleted) {
            done([]);
            return;
          }
          done((as.result as StoredArtifact[]).filter(a => a.workspaceId === workspaceId && !a.deleted && (a.type === 'html' || includePages && a.type === 'html-page') && (!artifactId || a.id === artifactId)).map(a => { const r = (rs.result as NoteRevision[]).find(r => r.id === a.revisionId && r.artifactId === a.id); if (!r)
            throw new ApplicationError('not-found'); if(a.type==='html-page') { if(a.pageVersion!==1) throw new ApplicationError('invalid-message'); return {id:a.id,workspaceId,sourceChatId:a.sourceChatId,revisionId:a.revisionId,type:'html-page' as const,pageVersion:1 as const,title:a.title,source:r.content,sourceDeleted:!space.chats.some(c=>c.id===a.sourceChatId&&!c.deleted),...(a.webEvidence?{webEvidence:a.webEvidence}:{})}; } return { id: a.id, workspaceId, sourceChatId: a.sourceChatId, revisionId: a.revisionId, type: 'html' as const, title: a.title, document: parseKnowledge(r.content), ...(a.webEvidence?{webEvidence:a.webEvidence}:{}), sourceDeleted: !space.chats.some(c => c.id === a.sourceChatId && !c.deleted) }; }));
        }
        catch {
          fail(new ApplicationError('knowledge-format'));
        }
      };
    });
  }
}
