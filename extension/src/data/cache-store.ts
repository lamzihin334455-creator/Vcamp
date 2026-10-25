import { ApplicationError } from '../contracts/application';
import { cacheKindSchema, cacheSelectionSchema, type CacheCounts, type CacheKind, type CachePreview, type CacheSelection } from '../contracts/cache';
import { databaseTransaction } from './database';
import type { StoredWorkspace } from './indexed-store';

// Explicit rebuildable category, never inferred from a durable table's age.
// No production writer in T21. This public seam supports test-only fixtures.
export type CacheEntry = { id: string; platform: 'bilibili'; videoId: string; kind: CacheKind; data: Uint8Array; lastAccessedAt: number; revision: number };
type Plan = CachePreview & { selection: CacheSelection; cutoff: number; items: { id: string; stamp: string }[]; result?: CacheCounts };
type Rows = { cacheEntries: CacheEntry[]; cachePlans: Plan[]; workspaces: StoredWorkspace[]; favorites: { id: string; target: { workspaceId: string } }[] };
const tables = ['cacheEntries', 'cachePlans', 'workspaces', 'favorites'];
const videoKey = (row: { platform: string; videoId: string }) => JSON.stringify([row.platform, row.videoId]);
const counts = (rows: CacheEntry[]): CacheCounts => ({ count: rows.length, bytes: rows.reduce((bytes, row) => bytes + row.data.byteLength, 0), videoCount: new Set(rows.map(videoKey)).size });

export class IndexedCacheStore {
  constructor(private name = 'vcamp', private clock = () => Date.now()) {}
  private transaction<T>(mode: IDBTransactionMode, operation: (rows: Rows, tx: IDBTransaction) => T): Promise<T> {
    return databaseTransaction(this.name, tables, mode, (tx, done, fail) => {
      const rows = {} as Rows; let left = tables.length;
      for (const key of tables) { const request = tx.objectStore(key).getAll(); request.onsuccess = () => {
        (rows as Record<string, unknown>)[key] = request.result;
        if (!--left) { try { done(operation(rows, tx)); } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); } }
      }; }
    });
  }
  private eligible(row: CacheEntry, rows: Rows, selection: CacheSelection, cutoff: number) {
    if (!cacheKindSchema.safeParse(row.kind).success || !selection.types.includes(row.kind) || !(row.data instanceof Uint8Array) || !Number.isFinite(row.lastAccessedAt) || row.lastAccessedAt >= cutoff) return false;
    const spaces = rows.workspaces.filter(space => videoKey(space.source) === videoKey(row));
    if (spaces.some(space => space.deleted || (space.lastOpenedAt ?? 0) >= cutoff)) return false;
    return !rows.favorites.some(favorite => spaces.some(space => space.id === favorite.target.workspaceId));
  }
  private stamp(row: CacheEntry, rows: Rows) {
    return JSON.stringify([row.revision, row.kind, row.platform, row.videoId, row.lastAccessedAt, row.data.byteLength,
      rows.workspaces.filter(space => videoKey(space.source) === videoKey(row)).map(space => [space.id, space.lastOpenedAt ?? 0, space.managementRevision ?? 0]).sort()]);
  }
  put(value: Omit<CacheEntry, 'revision'>, expectedRevision = 0): Promise<void> {
    if (!cacheKindSchema.safeParse(value.kind).success || value.platform !== 'bilibili' || !value.id || !value.videoId || !(value.data instanceof Uint8Array) || !Number.isFinite(value.lastAccessedAt)) return Promise.reject(new ApplicationError('invalid-message'));
    return this.transaction('readwrite', (rows, tx) => {
      const old = rows.cacheEntries.find(row => row.id === value.id);
      if ((old?.revision ?? 0) !== expectedRevision) throw new ApplicationError('revision-conflict');
      tx.objectStore('cacheEntries').put({ ...value, revision: expectedRevision + 1 });
    });
  }
  touch(id: string): Promise<void> {
    return this.transaction('readwrite', (rows, tx) => {
      const row = rows.cacheEntries.find(row => row.id === id);
      if (!row) throw new ApplicationError('not-found');
      row.lastAccessedAt = this.clock(); row.revision++; tx.objectStore('cacheEntries').put(row);
    });
  }
  inventory(): Promise<CacheCounts> { return this.transaction('readonly', rows => counts(rows.cacheEntries.filter(row => cacheKindSchema.safeParse(row.kind).success && row.data instanceof Uint8Array))); }
  preview(selection: CacheSelection = { olderThanDays: 30, types: ['video-metadata', 'derived-preview'] }): Promise<CachePreview> {
    if (!cacheSelectionSchema.safeParse(selection).success) return Promise.reject(new ApplicationError('invalid-message'));
    return this.transaction('readwrite', (rows, tx) => {
      const now = this.clock(), cutoff = now - selection.olderThanDays * 86400000;
      const candidates = rows.cacheEntries.filter(row => this.eligible(row, rows, selection, cutoff));
      const preview = { planId: crypto.randomUUID(), expiresAt: now + 10 * 60000, ...counts(candidates) };
      tx.objectStore('cachePlans').add({ ...preview, selection, cutoff, items: candidates.map(row => ({ id: row.id, stamp: this.stamp(row, rows) })) });
      return preview;
    });
  }
  execute(planId: string): Promise<CacheCounts> {
    return this.transaction('readwrite', (rows, tx) => {
      const plan = rows.cachePlans.find(row => row.planId === planId);
      if (!plan) throw new ApplicationError('plan-expired');
      if (plan.result) return plan.result;
      if (this.clock() >= plan.expiresAt) throw new ApplicationError('plan-expired');
      const candidates = plan.items.map(item => rows.cacheEntries.find(row => row.id === item.id));
      if (candidates.some((row, index) => !row || !this.eligible(row, rows, plan.selection, plan.cutoff) || this.stamp(row, rows) !== plan.items[index].stamp)) throw new ApplicationError('plan-expired');
      const result = counts(candidates as CacheEntry[]);
      for (const row of candidates as CacheEntry[]) tx.objectStore('cacheEntries').delete(row.id);
      tx.objectStore('cachePlans').put({ ...plan, result });
      return result;
    });
  }
}
