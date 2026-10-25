import {styleCommandSchema,type StylePort} from '../contracts/style';
import {mediaDisplay} from '../shared/media-labels';
import { knowledgeCommandSchema, type KnowledgePort } from '../contracts/knowledge';
import type { AttachmentPort } from '../contracts/attachment';
import { subtitlesCommandSchema, type SubtitlesPort } from '../contracts/subtitles';
import { scribbleCommandSchema, type ScribblePort } from '../contracts/scribble';
import { instructionCommandSchema, type InstructionPort } from '../contracts/instructions';
import { roleCommandSchema, type RolePort } from '../contracts/role';
import { templateCommandSchema, type TemplatePort } from '../contracts/template';
import { providerCommandSchema, type ProviderService } from '../contracts/provider';
import { ApplicationError, envelopeSchema, type VideoKey } from '../contracts/application';
import { createApplication } from './application';
import type { WorkspaceStore } from '../data/indexed-store';
import { sameBinding, type VideoView } from '../contracts/video';
import { generationCommandSchema, type GenerationPort, type SourceBinding } from '../contracts/generation';
import { artifactCommandSchema, type ArtifactPort } from '../contracts/artifact';
import { libraryCommandSchema, type LibraryPort } from '../contracts/library';

export interface Sender { id?: string; url?: string; frameId?: number; documentId?: string; tab?: { id?: number } }
export interface PanelVideo {
  current(windowId?: number): Promise<VideoView & { source: VideoKey | null; localSource?: VideoKey | null }>;
  retry(binding: SourceBinding): Promise<void>;
  seek(binding: SourceBinding, time: number, policy: 'preserve'): Promise<unknown>;
}
export function createMessageRouter(store: WorkspaceStore, extensionId: string, binding: () => Promise<VideoKey | null>, video?: PanelVideo, provider?: ProviderService, generation?: GenerationPort & { currentVideo(windowId?: number): Promise<VideoView> }, artifacts?: ArtifactPort, templates?: TemplatePort, scribbles?: ScribblePort, subtitles?: SubtitlesPort, library?: LibraryPort, attachments?:AttachmentPort, knowledge?:KnowledgePort, roles?: RolePort, instructions?: InstructionPort,styles?:StylePort) {
  const app = createApplication(store);
  const origin = `chrome-extension://${extensionId}`;
  const selected = new Map<string, { workspaceId: string; chatId: string }>();
  function authorize(sender: Sender) {
    if (sender.id !== extensionId || !sender.url || (sender.frameId !== undefined && sender.frameId !== 0)) throw new ApplicationError('forbidden');
    let url: URL;
    try { url = new URL(sender.url); }
    catch { throw new ApplicationError('forbidden'); }
    if (`${url.protocol}//${url.host}` !== origin || !['/sidepanel.html', '/reader.html'].includes(url.pathname)) throw new ApplicationError('forbidden');
    return url;
  }
  return {
    authorize,
    async handle(message: unknown, sender: Sender) {
      const parsed = envelopeSchema.safeParse(message);
      const requestId = parsed.success ? parsed.data.requestId : '00000000-0000-4000-8000-000000000000';
      try {
        const url = authorize(sender);
        if (!parsed.success) throw new ApplicationError('invalid-message');
        const op = parsed.data.operation;
        const reader = url.pathname === '/reader.html';
        const fixedLibrary = reader && url.searchParams.get('library') === '1';
        if (reader && !fixedLibrary && url.searchParams.has('knowledgeId') && !['workspace.query','knowledge.query','library.locate','library.export'].includes(op.type)) throw new ApplicationError('forbidden');
        if(op.type==='attachment.read'||op.type==='attachment.capture'||op.type==='attachment.upload'||op.type==='attachment.remove'){
          if(!attachments)throw new ApplicationError('unsupported-capability');
          if(reader&&(op.type!=='attachment.read'||op.target.workspaceId!==url.searchParams.get('workspaceId')||(url.searchParams.get('library')!=='1'&&op.target.chatId!==url.searchParams.get('chatId'))||!op.historyOnly))throw new ApplicationError('forbidden');
          const attachment=await attachments.command(op);
          return {version:1 as const,requestId,ok:true as const,view:{mode:reader?'readonly' as const:'interactive' as const,workspaceId:null,chatId:null,title:'截图',draft:null,attachment}};
        }

        const libraryOp = libraryCommandSchema.safeParse(op);
        if (libraryOp.success) {
          if(reader){
            const command=libraryOp.data,space=url.searchParams.get('workspaceId');
            const explicit=!fixedLibrary&&([['html','knowledgeId'],['markdown','artifactId'],['chat','chatId'],['scribble','scribbleId'],['subtitle','subtitleVersionId']] as const).find(([,key])=>url.searchParams.has(key));
            const permitted=(target:{workspaceId:string;entityType:string;id?:string})=>target.workspaceId===space&&(!explicit||(target.entityType===explicit[0]&&target.id===url.searchParams.get(explicit[1])));
            if(command.type==='library.locate'){
              if(!permitted(command.target))throw new ApplicationError('forbidden');
              // Readonly always uses the existing source-open path, never active seek.
              if(!library)throw new ApplicationError('unsupported-capability');
              const result=await library.command({type:'library.open',target:command.target,action:'video',time:command.time});
              return {version:1 as const,requestId,ok:true as const,view:{mode:'readonly' as const,workspaceId:null,chatId:null,title:'来源视频',draft:null,library:result}};
            }
            if(command.type==='library.export'){
              if((!fixedLibrary&&!explicit)||command.selection.some(p=>!permitted(p.target)))throw new ApplicationError('forbidden');
            }else if(!fixedLibrary||command.type!=='library.read'||command.workspaceId!==space||command.scope)throw new ApplicationError('forbidden');
          }
          if (!library) throw new ApplicationError('unsupported-capability');
          const result = await library.command(libraryOp.data,parsed.data.windowId,{readonly:reader});
          if (!reader && libraryOp.data.type === 'library.open' && libraryOp.data.action === 'video') selected.delete(sender.documentId ?? `${sender.tab?.id ?? 'panel'}-${parsed.data.windowId ?? 'default'}`);
          if (libraryOp.data.type === 'library.trash.move') { for (const [key, value] of selected) if (value.workspaceId === libraryOp.data.target.workspaceId && (libraryOp.data.target.entityType === 'workspace' || value.chatId === libraryOp.data.target.id)) selected.delete(key); }
          return { version: 1 as const, requestId, ok: true as const, view: { mode: reader ? 'readonly' as const : 'interactive' as const, workspaceId: null, chatId: null, title: '资料库', draft: null, library: result } };
        }
        if (fixedLibrary) {
          const workspaceId = url.searchParams.get('workspaceId') ?? '';
          const fixed = await app.openReader(workspaceId).query();
          if (fixed.workspaceId !== workspaceId) throw new ApplicationError('not-found');
          const result = (extra: object) => ({ version: 1 as const, requestId, ok: true as const, view: { ...fixed, draft: null, ...extra } });
          if (op.type === 'workspace.query') {
            if (op.target && op.target.workspaceId !== workspaceId) throw new ApplicationError('forbidden');
            return result({ ...(await app.openReader(workspaceId, op.target?.chatId ?? url.searchParams.get('chatId') ?? undefined).query()), draft: null });
          }
          if (op.type === 'generation.query' && generation && op.target.kind === 'chat' && op.target.workspaceId === workspaceId) {
            await app.openReader(workspaceId, op.target.chatId).query();
            return result({ generation: await generation.command(op, parsed.data.windowId) });
          }
          if ('workspaceId' in op && op.workspaceId === workspaceId) {
            if (op.type === 'knowledge.query' && knowledge) return result({ knowledge: await knowledge.command(op) });
            if (library && (op.type === 'artifact.query' && op.artifactId || op.type === 'scribble.query' && op.scribbleId || op.type === 'subtitles.query' && op.versionId)) {
              const detail = await library.command({ type: 'library.read', workspaceId },undefined,{readonly:true});
              const entityType = op.type === 'artifact.query' ? 'markdown' : op.type === 'scribble.query' ? 'scribble' : 'subtitle';
              const id = op.type === 'artifact.query' ? op.artifactId : op.type === 'scribble.query' ? op.scribbleId : op.type === 'subtitles.query' ? op.versionId : '';
              if (!detail.entities.some(row => row.entityType === entityType && row.id === id)) throw new ApplicationError('forbidden');
            }
            if (op.type === 'artifact.query' && artifacts) return result({ artifacts: await artifacts.command(op) });
            if (op.type === 'scribble.query' && scribbles) return result({ scribbles: await scribbles.command(op) });
            if (op.type === 'subtitles.query' && subtitles) return result({ subtitles: await subtitles.command(op) });
          }
          throw new ApplicationError('forbidden');
        }
        if (reader && url.searchParams.has('knowledgeId') && op.type !== 'workspace.query' && op.type !== 'knowledge.query') throw new ApplicationError('forbidden');
        if (reader && op.type === 'workspace.query' && url.searchParams.has('knowledgeId')) {
          if (!knowledge) throw new ApplicationError('unsupported-capability');
          const workspaceId=url.searchParams.get('workspaceId')??'', artifactId=url.searchParams.get('knowledgeId')??'';
          const result=await knowledge.command({type:'knowledge.query',workspaceId,artifactId});
          if (!result.artifacts.length) throw new ApplicationError('not-found');
          return {version:1 as const,requestId,ok:true as const,view:{mode:'readonly' as const,workspaceId,chatId:null,title:result.artifacts[0].title,draft:null,knowledge:result}};
        }
        const knowledgeOp=knowledgeCommandSchema.safeParse(op);
        if (knowledgeOp.success) {
          if (!knowledge) throw new ApplicationError('unsupported-capability');
          if (reader && (knowledgeOp.data.workspaceId!==url.searchParams.get('workspaceId')||knowledgeOp.data.artifactId!==url.searchParams.get('knowledgeId')||!knowledgeOp.data.artifactId)) throw new ApplicationError('forbidden');
          return {version:1 as const,requestId,ok:true as const,view:{mode:reader?'readonly' as const:'interactive' as const,workspaceId:null,chatId:null,title:'交互知识',draft:null,knowledge:await knowledge.command(knowledgeOp.data)}};
        }
        if (reader && url.searchParams.has('subtitleVersionId') && op.type !== 'workspace.query' && op.type !== 'subtitles.query' && op.type !== 'knowledge.query') throw new ApplicationError('forbidden');
        if (reader && op.type !== 'workspace.query' && op.type !== 'generation.query' && op.type !== 'artifact.query' && op.type !== 'scribble.query' && op.type !== 'subtitles.query' && op.type !== 'knowledge.query') throw new ApplicationError('forbidden');
        if (reader && url.searchParams.has('subtitleVersionId') && op.type === 'workspace.query') {
          if (!subtitles) throw new ApplicationError('unsupported-capability');
          const workspaceId = url.searchParams.get('workspaceId') ?? '', versionId = url.searchParams.get('subtitleVersionId') ?? '';
          const result = await subtitles.command({ type: 'subtitles.query', workspaceId, versionId });
          return { version: 1 as const, requestId, ok: true as const, view: { mode: 'readonly' as const, workspaceId, chatId: null, title: '已保存 AI 字幕', draft: null, subtitles: result } };
        }
        const subtitleOp = subtitlesCommandSchema.safeParse(op);
        if (subtitleOp.success) {
          if (!subtitles) throw new ApplicationError('unsupported-capability');
          if (reader && (subtitleOp.data.type !== 'subtitles.query' || subtitleOp.data.workspaceId !== url.searchParams.get('workspaceId') || !url.searchParams.get('subtitleVersionId') || subtitleOp.data.versionId !== url.searchParams.get('subtitleVersionId'))) throw new ApplicationError('forbidden');
          const result = await subtitles.command(subtitleOp.data);
          return { version: 1 as const, requestId, ok: true as const, view: { mode: reader ? 'readonly' as const : 'interactive' as const, workspaceId: null, chatId: null, title: 'AI 字幕', draft: null, subtitles: result } };
        }
        if (reader && url.searchParams.has('artifactId') && op.type === 'workspace.query') {
          if (!artifacts) throw new ApplicationError('unsupported-capability');
          const workspaceId = url.searchParams.get('workspaceId') ?? '', artifactId = url.searchParams.get('artifactId') ?? '';
          const result = await artifacts.command({ type: 'artifact.query', workspaceId, artifactId });
          const note = result.artifacts[0];
          if (!note) throw new ApplicationError('not-found');
          // Artifact navigation has no current Chat. A deleted source must not
          // make its preserved document unreadable or select another Chat.
          return { version: 1 as const, requestId, ok: true as const, view: { mode: 'readonly' as const, workspaceId, chatId: null, title: note.title, draft: null, artifacts: result } };
        }
        if (reader && url.searchParams.has('scribbleId') && op.type === 'workspace.query') {
          if (!scribbles) throw new ApplicationError('unsupported-capability');
          const workspaceId = url.searchParams.get('workspaceId') ?? '', scribbleId = url.searchParams.get('scribbleId') ?? '';
          const result = await scribbles.command({ type: 'scribble.query', workspaceId, scribbleId });
          if (!result.scribbles[0]) throw new ApplicationError('not-found');
          return { version: 1 as const, requestId, ok: true as const, view: { mode: 'readonly' as const, workspaceId, chatId: null, title: '随笔', draft: null, scribbles: result } };
        }
        const scribbleOp = scribbleCommandSchema.safeParse(op);
        if (scribbleOp.success) {
          if (!scribbles) throw new ApplicationError('unsupported-capability');
          if (reader && (scribbleOp.data.type !== 'scribble.query' || scribbleOp.data.workspaceId !== url.searchParams.get('workspaceId') || !url.searchParams.get('scribbleId') || scribbleOp.data.scribbleId !== url.searchParams.get('scribbleId'))) throw new ApplicationError('forbidden');
          const result = await scribbles.command(scribbleOp.data);
          return { version: 1 as const, requestId, ok: true as const, view: { mode: reader ? 'readonly' as const : 'interactive' as const, workspaceId: null, chatId: null, title: '随笔', draft: null, scribbles: result } };
        }
        const instructionOp = instructionCommandSchema.safeParse(op);
        if (instructionOp.success) {
          if (reader || !instructions) throw new ApplicationError('forbidden');
          const result = await instructions.command(instructionOp.data);
          return { version: 1 as const, requestId, ok: true as const, view: { mode: 'interactive' as const, workspaceId: null, chatId: null, title: '本次 AI 指令', draft: null, instructions: result } };
        }
        const styleOp=styleCommandSchema.safeParse(op);
        if(styleOp.success){if(reader||!styles)throw new ApplicationError('forbidden');return {version:1 as const,requestId,ok:true as const,view:{mode:'interactive' as const,workspaceId:null,chatId:null,title:'风格',draft:null,styles:await styles.command(styleOp.data)}};}
        const roleOp = roleCommandSchema.safeParse(op);
        if (roleOp.success) {
          if (reader || !roles) throw new ApplicationError('forbidden');
          const result = await roles.command(roleOp.data);
          return { version: 1 as const, requestId, ok: true as const, view: { mode: 'interactive' as const, workspaceId: null, chatId: null, title: '角色', draft: null, roles: result } };
        }
        const templateOp = templateCommandSchema.safeParse(op);
        if (templateOp.success) {
          if (reader || !templates) throw new ApplicationError('forbidden');
          const result = await templates.command(templateOp.data);
          return { version: 1 as const, requestId, ok: true as const, view: { mode: 'interactive' as const, workspaceId: null, chatId: null, title: '模板', draft: null, templates: result } };
        }
        const artifactOp = artifactCommandSchema.safeParse(op);
        if (artifactOp.success) {
          if (!artifacts) throw new ApplicationError('unsupported-capability');
          if (reader && (artifactOp.data.workspaceId !== url.searchParams.get('workspaceId') || !url.searchParams.get('artifactId') || artifactOp.data.type !== 'artifact.query' || artifactOp.data.artifactId !== url.searchParams.get('artifactId'))) throw new ApplicationError('forbidden');
          const result = await artifacts.command(artifactOp.data);
          return { version: 1 as const, requestId, ok: true as const, view: { mode: reader ? 'readonly' as const : 'interactive' as const, workspaceId: null, chatId: null, title: 'Markdown 笔记', draft: null, artifacts: result } };
        }
        const generationOp = generationCommandSchema.safeParse(op);
        if (generationOp.success) {
          if (!generation) throw new ApplicationError('forbidden');
          if (reader) {
            if (url.searchParams.has('subtitleVersionId')) throw new ApplicationError('forbidden');
            const target = generationOp.data.type === 'generation.query' ? generationOp.data.target : null;
            if (!target || target.workspaceId !== url.searchParams.get('workspaceId') || (target.kind === 'chat' && url.searchParams.has('chatId') && target.chatId !== url.searchParams.get('chatId'))) throw new ApplicationError('forbidden');
          }
          const result = await generation.command(generationOp.data, parsed.data.windowId);
          return { version: 1 as const, requestId, ok: true as const, view: { mode: reader ? 'readonly' as const : 'interactive' as const, workspaceId: null, chatId: null, title: '生成任务', draft: null, generation: result } };
        }
        const providerOp = providerCommandSchema.safeParse(op);
        if (providerOp.success) {
          if (reader || !provider) throw new ApplicationError('forbidden');
          const configuration = await provider.command(providerOp.data);
          return { version: 1 as const, requestId, ok: true as const, view: { mode: 'interactive' as const, workspaceId: null, chatId: null, title: '模型服务', draft: null, provider: configuration } };
        }
        if (video && op.type === 'draft.save' && !op.target) throw new ApplicationError('invalid-message');
        const observed = !reader && video ? await video.current(parsed.data.windowId) : undefined;
        if (op.type === 'video.retry' || op.type === 'video.seek') {
          if (!video || !sameBinding(observed?.binding ?? null, op.binding)) throw new ApplicationError('stale-binding');
          if (op.type === 'video.retry') await video.retry(op.binding);
          else await video.seek(op.binding, op.time, op.policy);
        }
        const localTarget = observed&&!observed.binding&&['loading','read-failed'].includes(observed.status)?null:observed?.source ?? observed?.localSource ?? null;
        const clientId = sender.documentId ?? `${sender.tab?.id ?? 'panel'}-${parsed.data.windowId ?? 'default'}`;
        const panel = reader ? app.openReader(url.searchParams.get('workspaceId') ?? '', url.searchParams.get('chatId') ?? undefined)
          : op.type === 'draft.save' && op.target ? app.openTarget(op.target.workspaceId, op.target.chatId)
          : await app.openPanel(observed ? localTarget : await binding());
        const initial = await panel.query();
        const preference = op.type === 'workspace.query' && op.target ? op.target : selected.get(clientId);
        const inaccessiblePage = !!observed && !localTarget && ['unsupported', 'read-failed', 'permission-denied'].includes(observed.status);
        const canRestoreSelection = !!preference && (inaccessiblePage || preference.workspaceId === initial.workspaceId && initial.chats?.some(chat => chat.id === preference.chatId));
        const session = !reader && op.type !== 'draft.save' && canRestoreSelection
          ? app.openTarget(preference.workspaceId, preference.chatId) : panel;
        const write = op.type === 'draft.save' || op.type === 'chat.create' || op.type === 'chat.select';
        const view = write ? await session.command(op) : await session.query();
        if (observed && op.type !== 'draft.save') {
          const latest = await video!.current(parsed.data.windowId);
          if (!sameBinding(observed.binding, latest.binding) && (observed.binding || latest.binding)) throw new ApplicationError('stale-binding');
          const latestTarget = !latest.binding&&['loading','read-failed'].includes(latest.status)?null:latest.source ?? latest.localSource ?? null;
          const key = (source: VideoKey | null) => source && JSON.stringify([source.platform, source.videoId, source.partId]);
          if (key(localTarget) !== key(latestTarget)) throw new ApplicationError('stale-binding');
          view.title = latestTarget ? mediaDisplay(latestTarget).fullTitle : view.title;
          view.video = { binding: latest.binding, status: latest.status, cues: latest.cues, language: latest.language, tracks: latest.tracks, playback: latest.playback };
        }
        if (!reader && !observed && generation && op.type !== 'draft.save') view.video = await generation.currentVideo(parsed.data.windowId);
        if (!reader && op.type !== 'draft.save') {
          if (view.workspaceId && view.chatId) selected.set(clientId, { workspaceId: view.workspaceId, chatId: view.chatId });
          else selected.delete(clientId);
        }
        return { version: 1 as const, requestId, ok: true as const, view };
      } catch (error) {
        return { version: 1 as const, requestId, ok: false as const, code: error instanceof ApplicationError ? error.code : 'storage-failed' as const };
      }
    }
  };
}
