import { ApplicationError } from '../contracts/application';
import { scribbleSchema, type Scribble } from '../contracts/scribble';
import type { StoredWorkspace } from './indexed-store';
import { databaseTransaction } from './database';

export class IndexedScribbleStore {
  constructor(private name = 'vcamp') {}
  list(workspaceId: string): Promise<Scribble[]> {
    return databaseTransaction(this.name, ['workspaces', 'scribbles'], 'readonly', (tx, done) => {
      const space = tx.objectStore('workspaces').get(workspaceId), request = tx.objectStore('scribbles').getAll(); request.onsuccess = () => done(!space.result || space.result.deleted ? [] : (request.result as Scribble[]).filter(row => row.workspaceId === workspaceId && !row.deleted).sort((a,b)=>(a.time??Infinity)-(b.time??Infinity)||(a.creationOrder??0)-(b.creationOrder??0)));
    });
  }
  create(workspaceId: string, text: string, time: number | null, origin?: { chatId: string; expectedRevision: number }): Promise<Scribble> {
    const parsed = scribbleSchema.safeParse({ id: crypto.randomUUID(), workspaceId, text, time, revision: 1 });
    if (!parsed.success) return Promise.reject(new ApplicationError('invalid-message'));
    return databaseTransaction(this.name, ['workspaces', 'scribbles'], 'readwrite', (tx, done, fail) => {
      const spaces = tx.objectStore('workspaces'), request = spaces.get(workspaceId), all = tx.objectStore('scribbles').getAll();
      all.onsuccess = () => {
        parsed.data.creationOrder = (all.result as Scribble[]).filter(r=>r.workspaceId===workspaceId).reduce((order,row)=>Math.max(order,row.creationOrder??0),0)+1;
        if(!Number.isSafeInteger(parsed.data.creationOrder))return fail(new ApplicationError('resource-limit'));
        const record: StoredWorkspace | undefined = request.result;
        if (!record || record.deleted) return fail(new ApplicationError('not-found'));
        if (origin) {
          const chat = record.chats.find(chat => chat.id === origin.chatId && !chat.deleted);
          if (!chat) return fail(new ApplicationError('not-found'));
          if (chat.draft.revision !== origin.expectedRevision) return fail(new ApplicationError('revision-conflict'));
          if (!chat.draft.scribble || chat.draft.scribble.text !== parsed.data.text || chat.draft.scribble.time !== time) return fail(new ApplicationError('forbidden'));
          const { scribble: _overlay, ...draft } = chat.draft;
          chat.draft = { ...draft, revision: draft.revision + 1 };
          chat.messages = [...(chat.messages ?? []), { messageId: crypto.randomUUID(), contentVersionId: crypto.randomUUID(), role: 'assistant', text: '已创建随笔', kind: 'scribble-operation', scribbleId: parsed.data.id, jobId: '', attemptId: null, state: 'completed', referenceSnapshotIds: [], attachmentIds: [] }];
          spaces.put(record);
        }
        tx.objectStore('scribbles').add(parsed.data); done(parsed.data);
      };
    });
  }
  save(workspaceId: string, id: string, expectedRevision: number, text: string): Promise<Scribble> {
    return databaseTransaction(this.name, ['workspaces', 'scribbles'], 'readwrite', (tx, done, fail) => {
      const rows = tx.objectStore('scribbles'), request = rows.get(id), space = tx.objectStore('workspaces').get(workspaceId);
      space.onsuccess = () => {
        const old: Scribble | undefined = request.result;
        if (!space.result || space.result.deleted || !old || old.deleted || old.workspaceId !== workspaceId) return fail(new ApplicationError('not-found'));
        if (old.revision !== expectedRevision) return fail(new ApplicationError('revision-conflict'));
        const parsed = scribbleSchema.safeParse({ ...old, text, revision: old.revision + 1 });
        if (!parsed.success) return fail(new ApplicationError('invalid-message'));
        rows.put(parsed.data); done(parsed.data);
      };
    });
  }
}
