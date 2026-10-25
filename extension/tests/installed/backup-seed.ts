import { seedBackup } from '../fixtures/t20-semantic';
import { seedImport } from '../fixtures/w25-import';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedArtifactStore } from '../../src/data/artifact-store';
import { IndexedTemplateStore } from '../../src/data/template-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { IndexedCacheStore } from '../../src/data/cache-store';
const spaces = new IndexedWorkspaceStore(), notes = new IndexedArtifactStore(), tasks = new IndexedGenerationStore();
const proof = {
  seed: seedBackup,
  seedImport,
  openLocal: (source: Parameters<IndexedWorkspaceStore['open']>[0]) => spaces.open(source),
  exported: () => new IndexedBackupStore().export(),
  async mutate(workspaceId: string, chatId: string, text: string) {
    const row = (await spaces.read(workspaceId, chatId))!;
    return spaces.save(workspaceId, row.draft.revision, { ...row.draft, text }, chatId);
  },
  async conflict(f: Awaited<ReturnType<typeof seedBackup>>) {
    await this.mutate(f.a.id, f.a.chatId, '本机冲突草稿');
    await notes.save(f.a.id, f.note.id, 2, '# 本机冲突正文');
    const templates = new IndexedTemplateStore();
    await templates.save(f.template.id, 2, { name: '本机冲突模板', description: '', requirements: '本机要求', outputType: 'markdown', defaultModelId: 'fixture' });
    return true;
  },
  job: (id: string) => tasks.get(id),
  notes: (workspaceId: string, chatId?: string) => notes.list(workspaceId, chatId),
  space: (id: string, chatId?: string) => spaces.read(id, chatId),
  async cache() {
    await new IndexedCacheStore().put({ id: 'backup-cache-excluded', platform: 'bilibili', videoId: 'BVbackupA', kind: 'derived-preview', data: new TextEncoder().encode('SYNTHETIC_CACHE_NOT_BACKED'), lastAccessedAt: 0 });
    return new IndexedLibraryStore().query();
  }
};
(window as unknown as { backupProof: typeof proof }).backupProof = proof;
