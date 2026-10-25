import {mediaDisplay} from '../shared/media-labels';
import { ApplicationError, saveSchema, chatCommandSchema, videoKeySchema, type ApplicationSession, type VideoKey, type WorkspaceView } from '../contracts/application';
import type { WorkspaceRecord, WorkspaceStore } from '../data/indexed-store';

const view = (record: WorkspaceRecord | undefined, mode: WorkspaceView['mode']): WorkspaceView => ({
  mode, workspaceId: record?.id ?? null, chatId: record?.chatId ?? null,
  title: record ? mediaDisplay(record.source).fullTitle : '打开视频，开始学习', draft: mode === 'interactive' ? record?.draft ?? null : null, chats: record?.chats ?? []
});

export function createApplication(store: WorkspaceStore) {
  function session(id: string | null, mode: WorkspaceView['mode'], chatId?: string): ApplicationSession {
    return {
      query: async () => {
        const empty = id && !chatId ? await store.emptySpace?.(id) : undefined;
        if (empty) return { mode, workspaceId: empty.id, chatId: null, title: mediaDisplay(empty.source).fullTitle, draft: null, chats: [] };
        const record = id ? await store.read(id, chatId) : undefined;
        if (id && !record) {
          const deletedWorkspace = await store.deletedSpace?.(id);
          if (deletedWorkspace && mode === 'interactive') return { ...view(undefined, mode), title: deletedWorkspace.title, deletedWorkspace };
          if (deletedWorkspace) throw new ApplicationError('not-found');
        }
        chatId ??= record?.chatId;
        return view(record, mode);
      },
      command: async command => {
        if (mode === 'readonly') throw new ApplicationError('forbidden');
        const chatCommand = chatCommandSchema.safeParse(command);
        if (chatCommand.success) {
          if (!id) throw new ApplicationError('unbound');
          if (chatCommand.data.workspaceId !== id) throw new ApplicationError('forbidden');
          const record = chatCommand.data.type === 'chat.create' ? await store.createChat(id) : await store.selectChat(id, chatCommand.data.chatId);
          chatId = record.chatId;
          return view(record, mode);
        }
        const parsed = saveSchema.safeParse(command);
        if (!parsed.success) throw new ApplicationError('invalid-message');
        if (!id) throw new ApplicationError('unbound');
        const target = parsed.data.target;
        const saveId = target?.workspaceId ?? id;
        return view(await store.save(saveId, parsed.data.expectedRevision, parsed.data.draft, target?.chatId ?? chatId), mode);
      }
    };
  }
  return {
    openPanel: async (source: VideoKey | null) => {
      if (source && !videoKeySchema.safeParse(source).success) throw new ApplicationError('invalid-message');
      const id = source ? JSON.stringify([source.platform, source.videoId, source.partId]) : null;
      if (id && await store.deletedSpace?.(id)) return session(id, 'interactive');
      if (id && await store.emptySpace?.(id)) return session(id, 'interactive');
      const record = source ? await store.open(source) : undefined;
      return session(record?.id ?? null, 'interactive', record?.chatId);
    },
    openReader: (id: string, chatId?: string) => session(id, 'readonly', chatId),
    openTarget: (id: string, chatId?: string) => session(id, 'interactive', chatId)
  };
}
