import { ApplicationError } from '../contracts/application';
import { databaseTransaction } from './database';

type OrderedRow = { id: string; sortIndex?: number; deleted?: boolean };

export function orderedPrompts<T extends OrderedRow>(presets: readonly T[], stored: readonly T[]): T[] {
  return [...new Map([...presets, ...stored].map(row => [row.id, row])).values()]
    .filter(row => !row.deleted)
    .sort((a, b) => (a.sortIndex ?? Number.MAX_SAFE_INTEGER) - (b.sortIndex ?? Number.MAX_SAFE_INTEGER));
}

// Ordering is presentation metadata. Never create a content revision for a move.
export function reorderPrompts<T extends OrderedRow>(name: string, table: string, presets: readonly T[], ids: string[]): Promise<void> {
  if (new Set(ids).size !== ids.length) return Promise.reject(new ApplicationError('invalid-message'));
  return databaseTransaction(name, [table], 'readwrite', (tx, done) => {
    const store = tx.objectStore(table), request = store.getAll();
    request.onsuccess = () => {
      const rows = orderedPrompts(presets, request.result), byId = new Map(rows.map(row => [row.id, row]));
      const requested = ids.filter(id => byId.has(id)), included = new Set(requested);
      // Concurrent additions survive; stale/deleted identities cannot be resurrected.
      [...requested, ...rows.filter(row => !included.has(row.id)).map(row => row.id)]
        .forEach((id, sortIndex) => store.put({ ...byId.get(id)!, sortIndex }));
      done(undefined);
    };
  });
}
