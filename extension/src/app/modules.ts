import type { ComponentType } from 'react';
import type { ApplicationClient, WorkspaceView } from '../contracts/application';

export type ModuleId = 'chat' | 'subtitle' | 'markdown' | 'html' | 'scribble' | 'library';
export interface ModuleView { id: ModuleId; title: string; empty: string }
export const modules: readonly ModuleView[] = [
  { id: 'chat', title: '问答', empty: '围绕视频，开始一段对话' },
  { id: 'subtitle', title: '字幕', empty: '暂无已保存字幕' },
  { id: 'markdown', title: '笔记', empty: '暂无笔记' },
  { id: 'html', title: 'HTML', empty: '暂无已保存页面' },
  { id: 'scribble', title: '随笔', empty: '暂无随笔' },
  { id: 'library', title: '资料库', empty: '暂无保存的资料' }
];
// Registration seam for subsequent authors; no renderer reaches into persistence.
export interface ModuleProps { onChromeChange?: (chrome: ModuleChrome) => void; subtitleVersionId?: string; onVideoOpen?: () => void; client: ApplicationClient; view: WorkspaceView; onKnowledgeFollowup?: (artifact: import('../contracts/knowledge').KnowledgeArtifact, entry: import('../contracts/knowledge').KnowledgeEntry, question: string) => Promise<boolean>; artifactId?: string; scribbleId?: string; registerLeaveGuard?: (guard: (() => Promise<boolean>) | null) => void; onSourceChat?: (chatId: string) => void }
export interface ModuleRegistration extends ModuleView { View: ComponentType<ModuleProps> }
export interface ModuleChrome {
  title?: string;
  items?: { id: string; title: string; select: () => void; disabled?: boolean }[];
  actions?: { label: string; run: () => void; disabled?: boolean; active?: boolean; iconOnly?:boolean;tooltip?:string }[];
  status?: string;
}
export interface ArtifactViewerProps {
  workspaceId: string; artifactId: string; mode: 'interactive' | 'readonly';
  client: ApplicationClient; onSourceChat?: (chatId: string) => void;
}
export type ArtifactViewer = ComponentType<ArtifactViewerProps>;
