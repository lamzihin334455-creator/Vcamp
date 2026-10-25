import { ApplicationError } from '../contracts/application';
import { subtitleVersionSchema, type AnalysisSource, type SubtitlesView, type SubtitleVersion } from '../contracts/subtitles';
import { databaseTransaction } from './database';
import type { StoredWorkspace } from './indexed-store';

const sameSource=(left:AnalysisSource,right:AnalysisSource)=>left.kind==='native'&&right.kind==='native'?(left.language??null)===(right.language??null):left.kind!=='native'&&right.kind!=='native'&&left.versionId===right.versionId;

export function validVersion(rows: SubtitleVersion[], workspaceId: string, versionId: string, enhancedOnly = false) {
  const row = rows.find(row => row.id === versionId);
  if (!row || row.deleted || row.workspaceId !== workspaceId || (enhancedOnly && row.type !== 'enhance') || !subtitleVersionSchema.safeParse(row).success) throw new ApplicationError('source-changed');
  return row;
}
export class IndexedSubtitleStore {
  constructor(private name = 'vcamp') {}
  query(workspaceId: string, versionId?: string): Promise<SubtitlesView> {
    return databaseTransaction(this.name, ['workspaces', 'subtitleVersions'], 'readonly', (tx, done, fail) => {
      const space = tx.objectStore('workspaces').get(workspaceId), rows = tx.objectStore('subtitleVersions').getAll();
      rows.onsuccess = () => {
        try {
          const record: StoredWorkspace | undefined = space.result;
          if (!record || record.deleted) throw new ApplicationError('not-found');
          const versions = (rows.result as SubtitleVersion[]).filter(row => row.workspaceId === workspaceId && !row.deleted && subtitleVersionSchema.safeParse(row).success);
          if (versionId && !versions.some(row => row.id === versionId)) throw new ApplicationError('not-found');
          const stored = record.analysisSource ?? { kind: 'native' as const };
          const source: AnalysisSource = stored.kind === 'enhanced' ? { kind: 'version', versionId: stored.versionId } : stored;
          done({ versions: versionId ? versions.filter(row => row.id === versionId) : versions, analysisSource: source, sourceRevision: record.analysisSourceRevision ?? 0, sourceValid: source.kind === 'native' || versions.some(row => row.id === source.versionId) });
        } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); }
      };
    });
  }
  select(workspaceId: string, expectedRevision: number, source: AnalysisSource): Promise<void> {
    return databaseTransaction(this.name, ['workspaces', 'subtitleVersions'], 'readwrite', (tx, done, fail) => {
      const spaces = tx.objectStore('workspaces'), space = spaces.get(workspaceId), rows = tx.objectStore('subtitleVersions').getAll();
      rows.onsuccess = () => {
        try {
          const record: StoredWorkspace | undefined = space.result;
          if (!record || record.deleted) throw new ApplicationError('not-found');
          const current=record.analysisSource??{kind:'native' as const};
          if ((record.analysisSourceRevision ?? 0) !== expectedRevision) {
            if(!sameSource(current,source))throw new ApplicationError('revision-conflict');
            if(source.kind!=='native')validVersion(rows.result,workspaceId,source.versionId);
            done();return;
          }
          if (source.kind !== 'native') validVersion(rows.result, workspaceId, source.versionId);
          record.analysisSource = source; record.analysisSourceRevision = expectedRevision + 1; spaces.put(record); done();
        } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); }
      };
    });
  }
  // T19 may invalidate retained versions. Selection deliberately stays invalid
  // until the user explicitly chooses another basis; old requests retain IDs.
  invalidate(workspaceId: string, versionId: string): Promise<void> {
    return databaseTransaction(this.name, ['subtitleVersions'], 'readwrite', (tx, done, fail) => {
      const rows = tx.objectStore('subtitleVersions'), request = rows.get(versionId);
      request.onsuccess = () => { const row: SubtitleVersion | undefined = request.result; if (!row || row.workspaceId !== workspaceId) return fail(new ApplicationError('not-found')); rows.put({ ...row, deleted: true }); done(); };
    });
  }
}
