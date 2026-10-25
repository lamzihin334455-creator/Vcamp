import { IndexedCacheStore } from '../../src/data/cache-store';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedScribbleStore } from '../../src/data/scribble-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
const cache = new IndexedCacheStore(), spaces = new IndexedWorkspaceStore(), scribbles = new IndexedScribbleStore(), tasks = new IndexedGenerationStore();
const proof = {
  async seedCache() {
    const old = Date.now() - 60 * 86400000, actualNow = Date.now;
    let protectedSpace;
    Date.now = () => old;
    try {
      protectedSpace = await spaces.open({ platform: 'bilibili', videoId: 'BV_CACHE_PROTECTED', partId: '1', title: 'Test-only protected video' });
      await spaces.open({ platform: 'bilibili', videoId: 'BV_CACHE_PROTECTED', partId: '2', title: 'Test-only protected video P2' });
      await spaces.open({ platform: 'bilibili', videoId: 'BV_CACHE_CLEAR', partId: '1', title: 'Test-only cleanable video' });
    } finally { Date.now = actualNow; }
    const note = await scribbles.create(protectedSpace.id, 'Test-only concrete favorite', null);
    for (const [id, videoId, bytes] of [['protected-p1', 'BV_CACHE_PROTECTED', 100], ['protected-p2', 'BV_CACHE_PROTECTED', 200], ['clear', 'BV_CACHE_CLEAR', 11]] as const) await cache.put({ id, platform: 'bilibili', videoId, kind: 'derived-preview', data: new Uint8Array(bytes), lastAccessedAt: old });
    return { target: { workspaceId: protectedSpace.id, entityType: 'scribble', id: note.id }, count: 3, bytes: 311 };
  },
  async getJob(jobId: string) { return tasks.get(jobId); },
  async late(jobId: string, attemptId: string) {
    const job = await tasks.get(jobId);
    await tasks.checkpoint(jobId, attemptId, 99, 'LATE_MUST_NOT_COMMIT', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 1 }] });
    return tasks.finish(jobId, attemptId, 'completed', null, 'LATE_RESULT', job?.snapshot.target.kind === 'subtitle' ? { kind: 'subtitle', cues: [{ from: 0, to: 2, content: 'late' }, { from: 2, to: 4, content: 'late' }] } : undefined);
  }
};
(window as unknown as { managementProof: typeof proof }).managementProof = proof;
