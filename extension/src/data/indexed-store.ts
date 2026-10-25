import { IndexedManagementStore, type DeletionState } from './management-store';
import type { AnalysisSource } from '../contracts/subtitles';
import { ApplicationError, emptyDraft, draftSchema, type ChatSummary, type Draft, type VideoKey } from '../contracts/application';
import { databaseTransaction } from './database';
import type { ChatMessage } from '../contracts/generation';
import type { RoleSelection } from '../contracts/role';
import type { z } from 'zod';
import type { importRecordSchema } from './backup-format';

// Existing consumers still receive the selected Chat/draft projection.
export interface WorkspaceRecord { id: string; chatId: string; source: VideoKey; draft: Draft; chats: ChatSummary[] }
export interface WorkspaceStore {
  deletedSpace?(id: string): Promise<{ id: string; title: string } | undefined>;
  emptySpace?(id: string): Promise<{ id: string; source: VideoKey } | undefined>;
  open(source: VideoKey): Promise<WorkspaceRecord>;
  read(id: string, chatId?: string): Promise<WorkspaceRecord | undefined>;
  save(id: string, expectedRevision: number, draft: Draft, chatId?: string): Promise<WorkspaceRecord>;
  createChat(id: string): Promise<WorkspaceRecord>;
  selectChat(id: string, chatId: string): Promise<WorkspaceRecord>;
}
export type StoredChat = ChatSummary & DeletionState & { draft: Draft; messages?: ChatMessage[]; backupOriginalId?: string };
export type StoredWorkspace = DeletionState & { id: string; source: VideoKey; recentChatId: string; chats: StoredChat[]; lastOpenedAt?: number; watchPosition?: { time: number; observedAt: number }; subtitleVersionIds?: string[]; analysisSource?: AnalysisSource; analysisSourceRevision?: number; backupImports?: z.infer<typeof importRecordSchema>[] };
const identity = (source: VideoKey) => JSON.stringify([source.platform, source.videoId, source.partId]);
const newChat = (index: number,web=false,role:RoleSelection|null=null): StoredChat => ({ id: crypto.randomUUID(), title: `对话 ${String(index).padStart(2, '0')}`, draft: {...emptyDraft(),...(web?{webEnabled:true}:{}),...(role?{role}:{})} });
const project = (record: StoredWorkspace, chatId = record.recentChatId): WorkspaceRecord => {
  if (record.deleted) throw new ApplicationError('not-found');
  const chat = record.chats.find(chat => chat.id === chatId);
  if (chat?.deleted) throw new ApplicationError('not-found');
  if (!chat) throw new ApplicationError('forbidden');
  return { id: record.id, source: record.source, chatId: chat.id, draft: chat.draft, chats: record.chats.filter(chat => !chat.deleted).map(({ id, title, backupOriginalId }) => ({ id, title: title + (backupOriginalId ? '（导入副本）' : '') })) };
};

// One database, v5 reserved by W4-T08T10-01. Per-workspace transactions serialize
// mutations; each Chat's draft revision remains independent of recent selection.
export class IndexedWorkspaceStore implements WorkspaceStore {
  constructor(private name = 'vcamp',private webDefault:()=>Promise<boolean>=async()=>false,private roleDefault:()=>Promise<RoleSelection|null>=async()=>null) {}
  deletedSpace(id: string): Promise<{ id: string; title: string } | undefined> {
    return this.transaction('readonly', (store, done) => { const request = store.get(id); request.onsuccess = () => done(request.result?.deleted ? { id, title: request.result.source.title } : undefined); });
  }
  emptySpace(id: string): Promise<{ id: string; source: VideoKey } | undefined> {
    return this.transaction('readonly', (store, done) => {
      const request = store.get(id); request.onsuccess = () => { const row: StoredWorkspace | undefined = request.result; done(row && !row.deleted && !row.chats.some(chat => !chat.deleted) ? { id: row.id, source: row.source } : undefined); };
    });
  }
  async removeChat(id: string, chatId: string): Promise<void> {
    const management = new IndexedManagementStore(this.name), target = { workspaceId: id, entityType: 'chat' as const, id: chatId };
    await management.move(target, (await management.preview(target)).revision);
  }
  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, result: (value: T) => void, fail: (error: ApplicationError) => void) => void): Promise<T> {
    return databaseTransaction(this.name, ['workspaces'], mode, (tx, result, fail) => operation(tx.objectStore('workspaces'), result, fail));
  }
  private mutate(id: string, update: (record: StoredWorkspace) => WorkspaceRecord): Promise<WorkspaceRecord> {
    return this.transaction('readwrite', (store, result, fail) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const record: StoredWorkspace | undefined = request.result;
          if (!record || record.deleted) throw new ApplicationError('not-found');
          const value = update(record);
          store.put(record);
          result(value);
        } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); }
      };
    });
  }
  async open(source: VideoKey): Promise<WorkspaceRecord> {
    const [web,role]=await Promise.all([this.webDefault(),this.roleDefault()]);
    return this.transaction('readwrite', (store, result, fail) => {
      const id = identity(source);
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const chat = request.result ? undefined : newChat(1,web,role);
          const record: StoredWorkspace = request.result ?? { id, source, recentChatId: chat!.id, chats: [chat!] };
          if (record.deleted) throw new ApplicationError('not-found');
          if (!request.result) { record.lastOpenedAt = Date.now(); store.add(record); }
          else { record.source = {...source,...(source.coverUrl??record.source.coverUrl?{coverUrl:source.coverUrl??record.source.coverUrl}:{})}; record.lastOpenedAt = Date.now(); store.put(record); }
          result(project(record));
        } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); }
      };
    });
  }
  read(id: string, chatId?: string): Promise<WorkspaceRecord | undefined> {
    return this.transaction('readonly', (store, result, fail) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try { result(request.result && !request.result.deleted ? project(request.result, chatId) : undefined); }
        catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); }
      };
    });
  }
  save(id: string, expectedRevision: number, draft: Draft, chatId?: string): Promise<WorkspaceRecord> {
    return this.mutate(id, record => {
      const selected = project(record, chatId);
      if (selected.draft.revision !== expectedRevision) throw new ApplicationError('revision-conflict');
      const parsed = draftSchema.safeParse(draft);
      if (!parsed.success) throw new ApplicationError('invalid-message');
      if (parsed.data.references?.some(item => item.workspaceId !== id || item.sourceChatId !== selected.chatId)
        || parsed.data.attachments?.some(item => item.workspaceId !== id || item.chatId !== selected.chatId)) throw new ApplicationError('forbidden');
      if (parsed.data.references?.some(item => !parsed.data.referenceIds.includes(item.artifactId))
        || parsed.data.attachments?.some(item => !parsed.data.attachmentIds.includes(item.attachmentId))) throw new ApplicationError('invalid-message');
      record.chats.find(chat => chat.id === selected.chatId)!.draft = { ...parsed.data, revision: selected.draft.revision + 1 };
      return project(record, selected.chatId);
    });
  }
  async createChat(id: string): Promise<WorkspaceRecord> {
    const [web,role]=await Promise.all([this.webDefault(),this.roleDefault()]);
    return this.mutate(id, record => {
      const chat = newChat(record.chats.length + 1,web,role);
      record.chats.push(chat); record.recentChatId = chat.id;
      return project(record);
    });
  }
  selectChat(id: string, chatId: string): Promise<WorkspaceRecord> {
    return this.mutate(id, record => {
      const selected = project(record, chatId);
      record.recentChatId = chatId;
      return selected;
    });
  }
}
