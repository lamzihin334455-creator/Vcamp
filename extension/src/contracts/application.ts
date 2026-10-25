import {coverUrl} from '../video/cover';
import { knowledgeSelectionSchema, knowledgeCommandSchema, knowledgeViewSchema, type KnowledgeCommand, type KnowledgeView } from './knowledge';
import {webErrors} from './web';
import { subtitlesCommandSchema, subtitlesViewSchema, type SubtitlesCommand, type SubtitlesView } from './subtitles';
import { scribbleCommandSchema, scribbleViewSchema, type ScribbleCommand, type ScribbleView } from './scribble';
import { instructionCommandSchema, instructionViewSchema, type InstructionCommand, type InstructionView } from './instructions';
import { roleCommandSchema, roleViewSchema, roleSelectionSchema, type RoleCommand, type RoleView } from './role';
import { templateCommandSchema, templateViewSchema, type TemplateCommand, type TemplateView } from './template';
import { z } from 'zod';
import {styleSelectionSchema,styleCommandSchema,styleViewSchema,type StyleCommand,type StyleView} from './style';
import type {libraryUiSchema} from './portable-preferences';
import { providerCommandSchema, providerViewSchema, type ProviderCommand, type ProviderView } from './provider';
import { videoViewSchema, videoCommandSchema, type VideoCommand } from './video';
import type { Playback } from './video';
import type { SourceBinding } from './generation';
import { generationCommandSchema, generationViewSchema, type GenerationCommand, type GenerationView } from './generation';
import { artifactCommandSchema, artifactViewSchema, type ArtifactCommand, type ArtifactView } from './artifact';
import { libraryCommandSchema, libraryViewSchema, type LibraryCommand, type LibraryView } from './library';
import { attachmentCommandSchema, attachmentViewSchema, type AttachmentCommand, type AttachmentPort } from './attachment';
// MV3 forbids runtime code generation; skip Zod's optional eval/JIT probe.
z.config({ jitless: true });

export const videoKeySchema = z.object({ platform: z.literal('bilibili'), videoId: z.string().min(1), partId: z.string().min(1), title: z.string().min(1).max(1000), coverUrl:z.string().max(2048).refine(v=>coverUrl(v)===v).optional(), videoTitle: z.string().min(1).max(1000).optional(), partTitle: z.string().max(1000).optional(), pageNumber: z.number().int().positive().optional(), partCount: z.number().int().positive().optional() }).strict();
export type VideoKey = z.infer<typeof videoKeySchema>;
export const draftSchema = z.object({
  webEnabled:z.boolean().optional(),
  knowledgeFollowup: knowledgeSelectionSchema.extend({ question: z.string().max(8000) }).strict().optional(),
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  text: z.string().max(100000), outputType: z.enum(['chat', 'markdown', 'html']),
  htmlStyle: styleSelectionSchema.optional(),
  role: roleSelectionSchema.nullable().optional(),
  visionEnabled: z.boolean().optional(),
  template: z.object({ templateId: z.string(), revisionId: z.string() }).strict().nullable(),
  referenceIds: z.array(z.string()).max(100), attachmentIds: z.array(z.string()).max(100),
  modelId: z.string().nullable(),
  scribble: z.object({ text: z.string().max(100000), time: z.number().finite().nonnegative().nullable() }).strict().optional(),
  // Optional, compatible v1 additions. Descriptions are UI metadata, never a
  // substitute for T07/T15's entity validation when preparing a request.
  references: z.array(z.object({ artifactId: z.string().min(1), workspaceId: z.string().min(1), sourceChatId: z.string().min(1), title: z.string().max(1000), type: z.literal('markdown') }).strict()).max(100).optional(),
  attachments: z.array(z.object({ attachmentId: z.string().min(1), workspaceId: z.string().min(1), chatId: z.string().min(1), name: z.string().max(1000), mimeType: z.string().min(1).max(200), time: z.number().finite().nonnegative().optional() }).strict()).max(100).optional()
}).strict();
export type Draft = z.infer<typeof draftSchema>;
export const emptyDraft = (): Draft => ({ schemaVersion: 1, revision: 0, text: '', outputType: 'chat', template: null, referenceIds: [], attachmentIds: [], modelId: null });
export const saveSchema = z.object({ type: z.literal('draft.save'), target: z.object({ workspaceId: z.string().min(1), chatId: z.string().min(1) }).strict().optional(), expectedRevision: z.number().int().nonnegative(), draft: draftSchema }).strict();
export type SaveDraft = z.infer<typeof saveSchema>;
export const chatCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat.create'), workspaceId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('chat.select'), workspaceId: z.string().min(1), chatId: z.string().min(1) }).strict()
]);
export type ApplicationCommand = StyleCommand | AttachmentCommand | KnowledgeCommand | SaveDraft | z.infer<typeof chatCommandSchema> | VideoCommand | ProviderCommand | GenerationCommand | ArtifactCommand | TemplateCommand | RoleCommand | InstructionCommand | ScribbleCommand | SubtitlesCommand | LibraryCommand;
export const chatSummarySchema = z.object({ id: z.string().min(1), title: z.string().min(1) }).strict();
export type ChatSummary = z.infer<typeof chatSummarySchema>;
export const viewSchema = z.object({
  deletedWorkspace: z.object({ id: z.string(), title: z.string() }).strict().optional(),
  attachment: attachmentViewSchema.optional(),
  library: libraryViewSchema.optional(),
  mode: z.enum(['interactive', 'readonly']), workspaceId: z.string().nullable(), chatId: z.string().nullable(),
  title: z.string(), draft: draftSchema.nullable(), chats: z.array(chatSummarySchema).optional(), video: videoViewSchema.optional(), provider: providerViewSchema.optional(), generation: generationViewSchema.optional(), artifacts: artifactViewSchema.optional(), templates: templateViewSchema.optional(), roles: roleViewSchema.optional(), styles:styleViewSchema.optional(), instructions: instructionViewSchema.optional(), scribbles: scribbleViewSchema.optional(), knowledge: knowledgeViewSchema.optional(), subtitles: subtitlesViewSchema.optional()
}).strict();
export type WorkspaceView = z.infer<typeof viewSchema>;
export const errorCodes = [...webErrors,'html-format','knowledge-format', 'legacy-knowledge', 'invalid-message', 'forbidden', 'unbound', 'not-found', 'revision-conflict', 'storage-failed', 'disconnected', 'stale-binding', 'permission-denied', 'read-failed', 'model-unavailable', 'task-busy', 'unsupported-capability', 'context-limit', 'resource-limit', 'source-changed', 'parent-deleted', 'plan-expired', 'capture-empty', 'capture-tainted'] as const;
export class ApplicationError extends Error {
  constructor(public code: typeof errorCodes[number]) { super(code); }
}
export interface ApplicationSession {
  query(): Promise<WorkspaceView>;
  command(command: ApplicationCommand): Promise<WorkspaceView>;
}
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';
export interface ApplicationClient extends ApplicationSession {
  subscribePreferences?(listener:(keys:string[])=>void):()=>void;
  appearancePreferences?: { read(): Promise<string>; write(color: string): Promise<void> };
  rolePreferences?: { read(): Promise<z.infer<typeof roleSelectionSchema> | null>; write(role: z.infer<typeof roleSelectionSchema> | null): Promise<void> };
  roleOutputPreferences?: {read():Promise<boolean>;write(enabled:boolean):Promise<void>};
  styles?(command:StyleCommand):Promise<StyleView>;
  webPreferences?: {read():Promise<boolean>;write(enabled:boolean):Promise<void>};
  autoVisionPreferences?: { read(target: { workspaceId: string; chatId: string }): Promise<boolean>; write(enabled: boolean, target: { workspaceId: string; chatId: string }): Promise<void> };
  attachment?: AttachmentPort['command'];
  library?(command: LibraryCommand): Promise<LibraryView>;
  libraryPreferences?: { read(): Promise<'list' | 'grid'>; write(layout: 'list' | 'grid'): Promise<void> };
  libraryUiPreferences?:{read():Promise<z.infer<typeof libraryUiSchema>|undefined>;write(value:z.infer<typeof libraryUiSchema>):Promise<void>};
  knowledge?(command: KnowledgeCommand): Promise<KnowledgeView>;
  subscribePlayback?(binding: SourceBinding, listener: (value: Playback | null) => void): () => void;
  htmlStylePreferences?: {read():Promise<z.infer<typeof styleSelectionSchema>|null>;write(style:z.infer<typeof styleSelectionSchema>|null):Promise<void>};
  subtitlePreferences?: { read(): Promise<number>; write(fontSize: number): Promise<void>;readOptions?():Promise<{auxiliaryFontSize:number;autoReturn:boolean}>;writeOptions?(options:{auxiliaryFontSize?:number;autoReturn?:boolean}):Promise<void> };
  provider?(command: ProviderCommand): Promise<ProviderView>;
  generation?(command: GenerationCommand): Promise<GenerationView>;
  subtitles?(command: SubtitlesCommand): Promise<SubtitlesView>;
  scribbles?(command: ScribbleCommand): Promise<ScribbleView>;
  instructions?(command: InstructionCommand): Promise<InstructionView>;
  roles?(command: RoleCommand): Promise<RoleView>;
  templates?(command: TemplateCommand): Promise<TemplateView>;
  artifacts?(command: ArtifactCommand): Promise<ArtifactView>;
  // Subscription acknowledgement precedes snapshot queries. Returns disposal.
  subscribe(listener: () => void, connection: (state: ConnectionState) => void): () => void;
}
export const envelopeSchema = z.object({ version: z.literal(1), requestId: z.string().uuid(), windowId: z.number().int().nonnegative().optional(),
  operation: z.union([z.object({ type: z.literal('workspace.query'), target: saveSchema.shape.target }).strict(), saveSchema, knowledgeCommandSchema, chatCommandSchema, videoCommandSchema, providerCommandSchema, generationCommandSchema, artifactCommandSchema, templateCommandSchema, roleCommandSchema, styleCommandSchema, instructionCommandSchema, scribbleCommandSchema, subtitlesCommandSchema, libraryCommandSchema, attachmentCommandSchema])
}).strict();
export const responseSchema = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(1), requestId: z.string().uuid(), ok: z.literal(true), view: viewSchema }).strict(),
  z.object({ version: z.literal(1), requestId: z.string().uuid(), ok: z.literal(false), code: z.enum(errorCodes) }).strict()
]);
