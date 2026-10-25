import { z } from 'zod';
import { cueSchema } from './video';
import {subtitleProcessingLimits} from './subtitle-limits';
export const analysisSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('native'), language: z.string().min(1).optional() }).strict(),
  // `enhanced` is retained for existing databases and backups. New selections
  // use the neutral `version` kind because the main subtitle may be either a
  // translation or a corrected version.
  z.object({ kind: z.literal('enhanced'), versionId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('version'), versionId: z.string().min(1) }).strict()
]);
export type AnalysisSource = z.infer<typeof analysisSourceSchema>;
export const subtitleVersionSchema = z.object({
  id: z.string().min(1), workspaceId: z.string().min(1), jobId: z.string(), attemptId: z.string(),
  type: z.enum(['translate', 'enhance']), language: z.string(), createdAt: z.number().finite().nonnegative(),
  source: z.union([z.object({ locator: z.string(), fingerprint: z.string() }).strict(), z.object({ subtitleVersionId: z.string() }).strict()]),
  sourceFingerprint: z.string(), sourceLanguage: z.string().nullable(), alignment: z.literal('exact'),
  cues: z.array(cueSchema).min(1).max(subtitleProcessingLimits.cueCount).refine(cues => cues.every((cue, index) => cue.to > cue.from && !!cue.content.trim() && (!index || cue.from >= cues[index - 1].from)) && cues.reduce((size, cue) => size + cue.content.length, 0) <= subtitleProcessingLimits.savedChars), deleted: z.boolean().optional(), deletedAt: z.number().optional(), managementRevision: z.number().int().nonnegative().optional()
}).strict();
export type SubtitleVersion = z.infer<typeof subtitleVersionSchema>;
export const subtitlesViewSchema = z.object({ versions: z.array(subtitleVersionSchema), analysisSource: analysisSourceSchema, sourceRevision: z.number().int().nonnegative(), sourceValid: z.boolean() }).strict();
export type SubtitlesView = z.infer<typeof subtitlesViewSchema>;
export const subtitlesCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subtitles.query'), workspaceId: z.string().min(1), versionId: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal('subtitles.source.select'), workspaceId: z.string().min(1), source: analysisSourceSchema, expectedRevision: z.number().int().nonnegative() }).strict()
]);
export type SubtitlesCommand = z.infer<typeof subtitlesCommandSchema>;
export interface SubtitlesPort { command(command: SubtitlesCommand): Promise<SubtitlesView> }
