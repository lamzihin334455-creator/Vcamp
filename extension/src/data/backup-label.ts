import type { StoredWorkspace } from './indexed-store';

// Display only: original titles/content and frozen snapshots remain unchanged.
export const backupLabel = (space: StoredWorkspace, id: string, title: string) =>
  title + (space.chats.some(c => c.id === id && c.backupOriginalId) || space.backupImports?.some(record => record.mapping.some(m => m.to === id && m.from !== id)) ? '（导入副本）' : '');
