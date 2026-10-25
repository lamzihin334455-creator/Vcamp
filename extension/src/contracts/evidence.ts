import { z } from 'zod';

export const configurableDataSourceSchema = z.enum([
  'full_subtitles',
  'video_description',
  'video_chapters',
  'hot_comments',
  'video_frames',
  'conversation_history',
  'web'
]);
export type ConfigurableDataSource = z.infer<typeof configurableDataSourceSchema>;

export const supplementalSourceSchema = z.enum([
  'video_chapters',
  'video_description',
  'hot_comments',
  'conversation_history'
]);
export type SupplementalSource = z.infer<typeof supplementalSourceSchema>;

export const sourceRequirementSchema = z.object({
  source: configurableDataSourceSchema,
  reason: z.string().trim().min(1).max(300)
}).strict();

export const requestRequirementsSchema = z.object({
  version: z.literal(1),
  interpretedIntent: z.string().trim().min(1).max(1000),
  additionalSources: z.array(sourceRequirementSchema).max(7),
  outputRequirements: z.array(z.string().trim().min(1).max(500)).max(8)
}).strict().superRefine((value, context) => {
  const sources = value.additionalSources.map(item => item.source);
  if (new Set(sources).size !== sources.length) context.addIssue({ code: 'custom', message: 'duplicate supplemental source' });
});
export type RequestRequirements = z.infer<typeof requestRequirementsSchema>;

export const sourceManifestEntrySchema = z.object({
  source: configurableDataSourceSchema,
  policy: z.enum(['core', 'auto', 'required', 'explicit']),
  availability: z.enum(['available', 'unavailable']),
  selection: z.enum(['included', 'omitted', 'unavailable']),
  reason: z.string().trim().min(1).max(500)
}).strict();
export type SourceManifestEntry = z.infer<typeof sourceManifestEntrySchema>;

const chapterSchema = z.object({
  title: z.string().trim().min(1).max(300),
  from: z.number().finite().nonnegative(),
  to: z.number().finite().positive().optional()
}).strict().refine(value => value.to === undefined || value.to > value.from);

const hotCommentSchema = z.object({
  content: z.string().trim().min(1).max(1000),
  likes: z.number().int().nonnegative()
}).strict();

export const frozenEvidenceSchema = z.object({
  version: z.literal(1),
  planningMode: z.enum(['planned', 'fallback', 'local']),
  plan: requestRequirementsSchema,
  includedSources: z.array(configurableDataSourceSchema).max(7),
  unavailableSources: z.array(configurableDataSourceSchema).max(7),
  sourceManifest: z.array(sourceManifestEntrySchema).length(7).optional(),
  videoDescription: z.string().trim().min(1).max(12000).optional(),
  chapters: z.array(chapterSchema).max(100).optional(),
  hotComments: z.array(hotCommentSchema).max(20).optional()
}).strict().superRefine((value, context) => {
  if (new Set(value.includedSources).size !== value.includedSources.length || new Set(value.unavailableSources).size !== value.unavailableSources.length) {
    context.addIssue({ code: 'custom', message: 'duplicate evidence source' });
  }
  if (value.includedSources.some(source => value.unavailableSources.includes(source))) context.addIssue({ code: 'custom', message: 'source cannot be included and unavailable' });
  if (Boolean(value.videoDescription) !== value.includedSources.includes('video_description')) context.addIssue({ code: 'custom', message: 'description/source mismatch' });
  if (Boolean(value.chapters?.length) !== value.includedSources.includes('video_chapters')) context.addIssue({ code: 'custom', message: 'chapters/source mismatch' });
  if (Boolean(value.hotComments?.length) !== value.includedSources.includes('hot_comments')) context.addIssue({ code: 'custom', message: 'comments/source mismatch' });
});
export type FrozenEvidence = z.infer<typeof frozenEvidenceSchema>;

// Capability discovery and model/template recommendations never grant consent.
export function withWebPermission(evidence: FrozenEvidence, enabled: boolean): FrozenEvidence {
  if (enabled) return evidence;
  const selected = evidence.includedSources.includes('web') || evidence.unavailableSources.includes('web');
  return {...evidence,
    includedSources: evidence.includedSources.filter(source => source !== 'web'),
    unavailableSources: [...evidence.unavailableSources.filter(source => source !== 'web'), ...(selected ? ['web' as const] : [])],
    ...(evidence.sourceManifest ? {sourceManifest: evidence.sourceManifest.map(entry => entry.source === 'web' ? {...entry, availability:'unavailable' as const, selection:selected?'unavailable' as const:'omitted' as const, reason:'当前对话未开启联网；模板和模型不能授权检索'} : entry)} : {})
  };
}

export interface RequestPlanningContext {
  request: string;
  outputType: 'chat' | 'markdown' | 'html';
  modelId: string;
  templateRequirements?: string;
  requiredSources?: readonly ConfigurableDataSource[];
  explicitSources?: readonly ConfigurableDataSource[];
  hasConversationHistory: boolean;
  hasFullSubtitles?: boolean;
  canUseVideoFrames?: boolean;
  canUseWeb?: boolean;
}
