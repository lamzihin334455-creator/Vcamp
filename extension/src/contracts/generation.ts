import {outputLimits} from './output-limits';
import { knowledgeContextSchema, type KnowledgeContext } from './knowledge';
import {webErrors,webEvidenceSchema,type WebEvidence,type WebOptions} from './web';
import { bindingSchema } from './video';
import { z } from 'zod';
import { visionStageSchema, type VisionStage } from './vision';
import { referenceSnapshotSchema, type ReferenceSnapshot } from './artifact';
import { roleRevisionSchema, type RoleRevision } from './role';
import { templateRevisionSchema, type TemplateRevision } from './template';
import { generationDiagnosticSchema, type GenerationDiagnostic } from './generation-diagnostic';
import { frozenEvidenceSchema, type FrozenEvidence } from './evidence';
import type { ProviderConnection } from './provider-config';
import type {StyleRevision} from './style';
// Shared vocabulary. Persistent snapshots deliberately exclude raw subtitles.
export interface SourceBinding {
  platform: 'bilibili'; videoId: string; partId: string;
  tabId: number; documentId: string; epoch: number;
}
export type RequestTarget =
  | { kind: 'chat'; workspaceId: string; chatId: string }
  | { kind: 'subtitle'; workspaceId: string; operation: 'translate' | 'enhance' };
export interface FrozenHistoryEntry {
  messageId: string; contentVersionId: string; role: 'user' | 'assistant';
  text: string; referenceSnapshotIds: readonly string[]; attachmentIds: readonly string[];
  knowledgeContext?: KnowledgeContext;
  referenceSnapshots?: readonly ReferenceSnapshot[];
  templateSnapshot?: TemplateRevision;
  roleSnapshot?: RoleRevision;
}
export interface ChatRequestSnapshot {
  providerConnection?: ProviderConnection;
  htmlStyle?:StyleRevision;
  mediaDuration?:number;
  historyOmitted?:number;
  web?:WebOptions;
  videoTitle?:string;
  videoPartTitle?:string;
  evidence?: FrozenEvidence;
  autoVision?: boolean;
  visionReview?: 1 | 2;
  visionOnly?: boolean;
  knowledgeFormat?: 1; htmlFormat?: 1;
  snapshotId: string; target: Extract<RequestTarget, { kind: 'chat' }>;
  analysisSource?: { kind: 'native'; locator: string; fingerprint: string } | { kind: 'enhanced' | 'version'; versionId: string; fingerprint: string };
  input: string; outputType: 'chat' | 'markdown' | 'html'; modelId: string; webEnabled: boolean;
  templateRevisionId: string | null; historyProjection: readonly FrozenHistoryEntry[];
  templateSnapshot?: TemplateRevision;
  roleSnapshot?: RoleRevision;
  referenceSnapshotIds: readonly string[]; attachmentIds: readonly string[];
  knowledgeContext?: KnowledgeContext;
  referenceSnapshots?: readonly ReferenceSnapshot[];
}
export interface SubtitleRequestSnapshot {
  providerConnection?: ProviderConnection;
  subtitleWorkflow?:2;webEnabled?:boolean;web?:WebOptions;videoTitle?:string;
  snapshotId: string; target: Extract<RequestTarget, { kind: 'subtitle' }>;
  source: { locator: string; fingerprint: string } | { subtitleVersionId: string };
  targetLanguage: string | null; requirements: string; modelId: string;
}
export interface JobEvent {
  protocolVersion: 1; jobId: string; attemptId: string; target: RequestTarget; seq: number;
  state: 'queued' | 'preparing' | 'awaiting-permission' | 'running' | 'committing' | 'completed' | 'stopped' | 'failed' | 'interrupted';
  delta?: string;
}

export const chatTargetSchema = z.object({ kind: z.literal('chat'), workspaceId: z.string().min(1), chatId: z.string().min(1) }).strict();
export const subtitleTargetSchema = z.object({ kind: z.literal('subtitle'), workspaceId: z.string().min(1), operation: z.enum(['translate', 'enhance']) }).strict();
export const targetSchema = z.discriminatedUnion('kind', [chatTargetSchema, subtitleTargetSchema]);
export const jobStateSchema = z.enum(['queued', 'preparing', 'awaiting-permission', 'running', 'committing', 'completed', 'stopped', 'failed', 'interrupted']);
export type JobState = JobEvent['state'];
export const terminal = (state: JobState) => ['completed', 'stopped', 'failed', 'interrupted'].includes(state);
export const generationErrors = [...webErrors,'html-format', 'knowledge-format', 'legacy-knowledge', 'network', 'auth', 'request-rejected', 'rate-limit', 'context-limit', 'protocol', 'timeout', 'output-limit', 'executor-lost', 'source-changed', 'storage', 'model-unavailable'] as const;
export type GenerationFailure = typeof generationErrors[number];
export interface SubtitleBasis {
  locator: string; fingerprint: string; timingFingerprint?: string; language: string | null;
  binding: SourceBinding; cueCount: number; subtitleVersionId?: string; visionOnly?: true; mediaDuration?: number;
}
export interface Coverage {
  total: number; covered: number;
  ranges: { firstCue: number; lastCue: number }[];
}
export interface Attempt {
  subtitlePhase?:'terms'|'searching'|'processing'|'reconciling';
  diagnostics?: GenerationDiagnostic[];
  webEvidence?:WebEvidence;
  visual?: VisionStage;
  attemptId: string; state: JobState; text: string; error: GenerationFailure | null;
  importedState?: JobState;
  executor: { tabId: number } | null; claimed: boolean; completionToken: string | null;
  coverage: Coverage;
}
export interface GenerationJob {
  jobId: string; snapshot: ChatRequestSnapshot | SubtitleRequestSnapshot;
  basis: SubtitleBasis; attempts: Attempt[]; seq: number;
}
export interface ChatMessage extends FrozenHistoryEntry {
  webEvidence?:WebEvidence;
  jobId: string; attemptId: string | null; state: JobState;
  kind?: 'scribble-operation'; scribbleId?: string;
  outputType?: 'chat' | 'markdown' | 'html'; artifactId?: string;
}
export const messageSchema = z.object({
  webEvidence:webEvidenceSchema.optional(),
  knowledgeContext: knowledgeContextSchema.optional(),
  messageId: z.string(), contentVersionId: z.string(), role: z.enum(['user', 'assistant']), text: z.string().max(outputLimits.textChars),
  referenceSnapshotIds: z.array(z.string()), attachmentIds: z.array(z.string()), jobId: z.string(), attemptId: z.string().nullable(), state: jobStateSchema,
  kind: z.literal('scribble-operation').optional(), scribbleId: z.string().optional(),
  outputType: z.enum(['chat', 'markdown', 'html']).optional(), artifactId: z.string().optional(), referenceSnapshots: z.array(referenceSnapshotSchema).max(100).optional(), templateSnapshot: templateRevisionSchema.optional(), roleSnapshot: roleRevisionSchema.optional()
}).strict();
const coverageSchema = z.object({ total: z.number().int().nonnegative(), covered: z.number().int().nonnegative(), ranges: z.array(z.object({ firstCue: z.number().int().nonnegative(), lastCue: z.number().int().nonnegative() }).strict()) }).strict();
export const jobViewSchema = z.object({
  subtitlePhase:z.enum(['terms','searching','processing','reconciling']).optional(),
  mediaDuration:z.number().finite().positive().optional(),
  diagnostics: z.array(generationDiagnosticSchema).max(18).optional(),
  webEvidence:webEvidenceSchema.optional(),
  visual: visionStageSchema.optional(),
  jobId: z.string().uuid(), attemptId: z.string().uuid(), target: targetSchema, seq: z.number().int().nonnegative(), state: jobStateSchema,
  text: z.string().max(outputLimits.textChars), error: z.enum(generationErrors).nullable(), coverage: coverageSchema,
  evidence: frozenEvidenceSchema.optional()
}).strict();
export type JobView = z.infer<typeof jobViewSchema>;
export const generationViewSchema = z.object({ target: targetSchema, messages: z.array(messageSchema), jobs: z.array(jobViewSchema) }).strict();
export type GenerationView = z.infer<typeof generationViewSchema>;
export const generationCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('generation.query'), target: targetSchema }).strict(),
  z.object({ type: z.literal('generation.send'), target: chatTargetSchema, expectedRevision: z.number().int().nonnegative(), binding: bindingSchema.optional(), preauthorize: z.literal(true).optional(), subtitleOnly: z.literal(true).optional() }).strict(),
  z.object({ type: z.literal('generation.vision.decide'), jobId: z.string().uuid(), choice: z.enum(['images', 'subtitle', 'keep']) }).strict(),
  z.object({ type: z.literal('generation.subtitle.send'), target: subtitleTargetSchema, subtitleWorkflow:z.literal(2).optional(),webEnabled:z.boolean().optional(),binding: bindingSchema.optional(), sourceVersionId: z.string().min(1).optional(), sourceLanguage: z.string().min(1).max(80).optional(), targetLanguage: z.string().trim().min(1).max(80).nullable(), requirements: z.string().max(2000).optional(), modelId: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal('generation.stop'), jobId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('generation.retry'), jobId: z.string().uuid() }).strict()
]);
export type GenerationCommand = z.infer<typeof generationCommandSchema>;
export interface GenerationPort { command(command: GenerationCommand, windowId?: number): Promise<GenerationView> }
export const jobView = (job: GenerationJob): JobView => {
  const attempt = job.attempts.at(-1)!;
  return { ...(attempt.subtitlePhase?{subtitlePhase:attempt.subtitlePhase}:{}),...(job.basis.mediaDuration?{mediaDuration:job.basis.mediaDuration}:{}), jobId: job.jobId, attemptId: attempt.attemptId, target: job.snapshot.target, seq: job.seq, state: attempt.state, text: attempt.text, error: attempt.error, coverage: attempt.coverage, ...('evidence' in job.snapshot && job.snapshot.evidence ? { evidence: job.snapshot.evidence } : {}), ...(attempt.diagnostics ? { diagnostics: attempt.diagnostics } : {}), ...(attempt.webEvidence?{webEvidence:attempt.webEvidence}:{}), ...(attempt.visual ? { visual: attempt.visual } : {}) };
};
