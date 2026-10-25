import { ApplicationError, draftSchema } from '../contracts/application';

// The sole upgrade entry: v3 added jobs/subtitleVersions; v4 adds artifacts
// and immutable noteRevisions; v5 adds templates, immutable template versions and
// space-owned scribbles; v6 adds folders and unique favorite relations. v7 adds temporary cacheEntries/cachePlans; v8 adds immutable attachments; v9 adds roles and immutable role versions; v10 adds styles and immutable style versions. All previous rows remain intact.
export function databaseTransaction<T>(name: string, stores: string[], mode: IDBTransactionMode,
  operation: (tx: IDBTransaction, result: (value: T) => void, fail: (error: ApplicationError) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let rejected = false;
    const open = indexedDB.open(name, 10);
    open.onupgradeneeded = event => {
      const db = open.result, oldVersion = (event as IDBVersionChangeEvent).oldVersion;
      if (oldVersion === 0) db.createObjectStore('workspaces', { keyPath: 'id' });
      else if (oldVersion === 1) {
        const cursor = open.transaction!.objectStore('workspaces').openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          try {
            const old = row.value;
            row.update({ id: old.id, source: old.source, recentChatId: old.chatId,
              chats: [{ id: old.chatId, title: '对话 01', draft: draftSchema.parse(old.draft) }] });
            row.continue();
          } catch { open.transaction!.abort(); }
        };
      }
      if (oldVersion < 3) {
        db.createObjectStore('jobs', { keyPath: 'jobId' });
        db.createObjectStore('subtitleVersions', { keyPath: 'id' });
      }
      if (oldVersion < 4) {
        db.createObjectStore('artifacts', { keyPath: 'id' });
        db.createObjectStore('noteRevisions', { keyPath: 'id' });
      }
      if (oldVersion < 5) {
        db.createObjectStore('templates', { keyPath: 'id' });
        db.createObjectStore('templateRevisions', { keyPath: 'revisionId' });
        db.createObjectStore('scribbles', { keyPath: 'id' });
      }
      if (oldVersion < 6) {
        db.createObjectStore('folders', { keyPath: 'id' });
        const favorites = db.createObjectStore('favorites', { keyPath: 'id' });
        favorites.createIndex('identity', ['folderId', 'target.workspaceId', 'target.entityType', 'target.id'], { unique: true });
        favorites.createIndex('folderId', 'folderId');
      }
      if (oldVersion < 7) {
        db.createObjectStore('cacheEntries', { keyPath: 'id' });
        db.createObjectStore('cachePlans', { keyPath: 'planId' });
      }
      if (oldVersion < 8) db.createObjectStore('attachments', { keyPath: 'id' });
      if (oldVersion < 9) {
        db.createObjectStore('roles', { keyPath: 'id' });
        db.createObjectStore('roleRevisions', { keyPath: 'revisionId' });
      }
      if(oldVersion<10){db.createObjectStore('styles',{keyPath:'id'});db.createObjectStore('styleRevisions',{keyPath:'revisionId'});}
    };
    open.onerror = () => reject(new ApplicationError('storage-failed'));
    open.onblocked = () => { rejected = true; reject(new ApplicationError('storage-failed')); };
    open.onsuccess = () => {
      const db = open.result;
      if (rejected) { db.close(); return; }
      db.onversionchange = () => db.close();
      const tx = db.transaction(stores, mode);
      let value: T, failure = new ApplicationError('storage-failed');
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onabort = () => { db.close(); reject(failure); };
      tx.onerror = () => {};
      const fail = (error: ApplicationError) => { failure = error; try { tx.abort(); } catch { /* already aborted */ } };
      try { operation(tx, result => { value = result; }, fail); }
      catch (error) { fail(error instanceof ApplicationError ? error : failure); }
    };
  });
}
