import { visionPreferenceKey } from '../../src/app/vision-preference';
/** Dev-only UI fixture. Reuses production application/stores in an isolated DB.
 * No credentials, video capture, or model transport is available here. */
import { createApplication } from '../../src/app/application';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedArtifactStore } from '../../src/data/artifact-store';
import { IndexedScribbleStore } from '../../src/data/scribble-store';
import { IndexedTemplateStore } from '../../src/data/template-store';
import { databaseTransaction } from '../../src/data/database';
import { ApplicationError, type ApplicationClient } from '../../src/contracts/application';
import type { GenerationView } from '../../src/contracts/generation';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { IndexedManagementStore } from '../../src/data/management-store';
import { createLibraryService } from '../../src/library/service';

export async function previewClient(): Promise<ApplicationClient> {
  const db = 'vcamp-opt-ui-preview';
  const store = new IndexedWorkspaceStore(db), artifacts = new IndexedArtifactStore(db), scribbles = new IndexedScribbleStore(db), templates = new IndexedTemplateStore(db);
  const session = await createApplication(store).openPanel({ platform: 'bilibili', videoId: 'rectification-fixture', partId: '1', title: '从 0 到 1：构建现代前端应用的完整流程' });
  const initial = await session.query();
  await databaseTransaction(db, ['artifacts', 'noteRevisions'], 'readwrite', (tx, done) => {
    const request = tx.objectStore('artifacts').get('preview-note');
    request.onsuccess = () => { if (!request.result) {
      tx.objectStore('artifacts').put({ id: 'preview-note', workspaceId: initial.workspaceId!, sourceChatId: initial.chatId!, type: 'markdown', title: '渲染方式学习笔记', revision: 1, revisionId: 'preview-note:v1', jobId: 'preview', attemptId: 'preview' });
      tx.objectStore('noteRevisions').put({ id: 'preview-note:v1', artifactId: 'preview-note', revision: 1, content: '# 渲染方式学习笔记\n\n## 从内容到交互\n\nSSR 在服务器生成首屏内容。CSR 由浏览器完成页面渲染。\n\n- 内容展示：关注首屏与可读性\n- 复杂交互：关注状态与响应\n\n> 示例资料，仅用于界面核对。' });
    } done(undefined); };
  });
  if (!(await scribbles.list(initial.workspaceId!)).length) await scribbles.create(initial.workspaceId!, '先明确页面目标，再决定渲染方式。\n首屏展示与后续交互需要分别考虑。', 125);
  const cues = [{ from: 0, to: 18, content: '今天从一个页面开始，理解现代前端应用的完整流程。' }, { from: 18, to: 40, content: '服务端渲染会先生成页面内容，客户端渲染在浏览器完成交互。' }, { from: 40, to: 65, content: '选择渲染方式时，需要结合首屏速度、内容组织与页面状态。' }];
  const video = { binding: null, status: 'ready' as const, language: 'zh', cues, tracks: [{ language: 'zh', label: '中文', status: 'ready' as const, cues }], playback: { time: 125, duration: 600, paused: true } };
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach(listener => listener());
  for (let index = 1; index <= 12; index++) {
    await store.open({ platform: 'bilibili', videoId: `opt-sample-${index}`, partId: '1', title: `${index} · 前端学习：组件状态与页面交互`, videoTitle: `${index} · 前端学习：组件状态与页面交互`, partTitle: '组件状态与页面交互', pageNumber: 1, partCount: index === 12 ? 3 : 1 });
    if (index === 12) await store.open({ platform: 'bilibili', videoId: `opt-sample-${index}`, partId: '2', title: '多P第二章', videoTitle: `${index} · 前端学习：组件状态与页面交互`, partTitle: '第二章：界面状态', pageNumber: 2, partCount: 3 });
  }
  const library = new IndexedLibraryStore(db);
  if (!(await library.query()).folders?.length) { await library.createFolder('学习收藏'); await library.createFolder('稍后复习'); }
  const announce = (value: string) => { document.getElementById('preview-action')!.textContent = value; };
  const libraryService = createLibraryService(library, async url => announce(`示例打开资料：${url}`), async (source, time) => announce(`示例打开视频：${source.videoId} / P${source.pageNumber ?? '?'} / ${time}秒`), new IndexedManagementStore(db));
  const preference = (key: string, fallback: string) => ({ read: async () => localStorage.getItem(`rectify-preview.${key}`) ?? fallback, write: async (value: string) => { localStorage.setItem(`rectify-preview.${key}`, value); } });
  const booleanPreference = (key: string) => ({ read: async () => localStorage.getItem(`rectify-preview.${key}`) === 'true', write: async (value: boolean) => { localStorage.setItem(`rectify-preview.${key}`, String(value)); } });
  let taskState = new URLSearchParams(location.search).get('task') ?? 'completed';
  const withVideo = async () => ({ ...await session.query(), video });
  return {
    query: withVideo,
    libraryPreferences: { read: async () => localStorage.getItem('opt-preview.layout') === 'grid' ? 'grid' : 'list', write: async value => { localStorage.setItem('opt-preview.layout', value); } },
    async library(command) { const result = await libraryService.command(command); if (command.type !== 'library.query' && command.type !== 'library.read') changed(); return result; },
    async command(command) { const view = await session.command(command); changed(); return { ...view, video }; },
    subscribe(listener, connection) { listeners.add(listener); connection('connected'); queueMicrotask(listener); return () => { listeners.delete(listener); }; },
    appearancePreferences: preference('accent', '#2f8f62'), autoVisionPreferences: {read: async target => localStorage.getItem(visionPreferenceKey(target)) === 'true', write: async (enabled,target) => {localStorage.setItem(visionPreferenceKey(target),String(enabled));}}, webPreferences: booleanPreference('web'),
    subtitlePreferences: { read: async () => Number(localStorage.getItem('rectify-preview.font') ?? 16), write: async value => { localStorage.setItem('rectify-preview.font', String(value)); } },
    async provider(command) { if (command.type !== 'provider.query') throw new ApplicationError('forbidden'); return { providerId: 'deepseek', revision: 0, hasKey: false, status: 'key-required', defaultModelId: null, models: [{ id: 'example-model', name: '示例文本模型', text: 'declared', vision: 'unknown', web: 'unknown' }, { id: 'example-vision', name: '示例视觉模型', text: 'declared', vision: 'declared', web: 'unknown' }] }; },
    async generation(command) {
      if (command.type === 'generation.stop') { taskState = 'stopped'; changed(); }
      else if (command.type === 'generation.retry') { taskState = 'running'; changed(); }
      else if (command.type !== 'generation.query') throw new ApplicationError('forbidden');
      const current = await session.query();
      const target = command.type === 'generation.query' ? command.target : {kind:'chat' as const,workspaceId:current.workspaceId!,chatId:current.chatId!};
      const sample = new URLSearchParams(location.search).get('sample') !== 'empty' && target.kind === 'chat' && target.chatId === initial.chatId;
      const messages: GenerationView['messages'] = sample ? [
        { messageId: 'sample-user', contentVersionId: '1', role: 'user', text: 'SSR 和 CSR 的核心区别是什么？', referenceSnapshotIds: [], attachmentIds: [], jobId: 'sample', attemptId: null, state: 'completed' },
        { messageId: 'sample-answer', contentVersionId: '1', role: 'assistant', text: '### SSR 和 CSR 的核心区别\n\n简单来说，SSR（服务端渲染）会先在服务器生成页面内容再返回给浏览器；CSR（客户端渲染）则主要由浏览器执行 JavaScript 后完成页面渲染。\n\n两者的差异主要体现在首屏速度、SEO 和交互方式上：\n\n- **SSR** 更适合内容型页面、需要 SEO 或希望更快展示首屏内容的场景。\n- **CSR** 更适合交互较复杂、页面状态变化频繁的应用。\n- 实际项目里也可以混合使用，不一定只能二选一。\n\n所以如果视频里的场景更强调官网、内容站或首屏体验，我会优先考虑 SSR；如果更像后台工具或复杂 Web App，CSR 通常会更灵活。', referenceSnapshotIds: [], attachmentIds: [], jobId: 'sample', attemptId: null, state: 'completed' }
      ] : [];
      if (sample && ['failed','running','stopped'].includes(taskState)) {
        const state = taskState as 'failed' | 'running' | 'stopped';
        messages[1] = {...messages[1],jobId:'11111111-1111-4111-8111-111111111111',attemptId:'22222222-2222-4222-8222-222222222222',text:state === 'running' ? '本地演示：生成进行中…' : '本地演示：这次请求未完成。',state};
        return {target,messages,jobs:[{jobId:messages[1].jobId,attemptId:messages[1].attemptId!,target,seq:Date.now(),state,text:messages[1].text,error:state==='failed'?'network':null,coverage:{total:3,covered:1,ranges:[]},diagnostics:[{purpose:'answer' as const,cause:'transport' as const,maxTokens:1000,outputChars:12,responseBytes:18,usage:{}}]}]};
      }
      return { target, messages, jobs: [] };
    },
    async artifacts(command) { if (command.type === 'artifact.save') { await artifacts.save(command.workspaceId, command.artifactId, command.expectedRevision, command.content); changed(); } return { artifacts: (await artifacts.list(command.workspaceId, 'sourceChatId' in command ? command.sourceChatId : undefined)).filter(note => !command.artifactId || note.id === command.artifactId) }; },
    async scribbles(command) { if (command.type === 'scribble.create') { await scribbles.create(command.workspaceId, command.text, command.time, command.origin); changed(); } if (command.type === 'scribble.save') { await scribbles.save(command.workspaceId, command.scribbleId, command.expectedRevision, command.text); changed(); } return { scribbles: await scribbles.list(command.workspaceId) }; },
    async templates(command) { if (command.type === 'template.create') { await templates.create(command.fields); changed(); } if (command.type === 'template.save') { await templates.save(command.templateId, command.expectedRevision, command.fields); changed(); } return { templates: await templates.list(), ...(command.type === 'template.query' && command.selected ? { revisions: [await templates.revision(command.selected.templateId, command.selected.revisionId)] } : {}) }; },
    async subtitles(command) { if (command.type !== 'subtitles.query') throw new ApplicationError('forbidden'); return { versions: [], analysisSource: { kind: 'native' }, sourceRevision: 0, sourceValid: true }; },
    async knowledge() { return { artifacts: [] }; }
  };
}
