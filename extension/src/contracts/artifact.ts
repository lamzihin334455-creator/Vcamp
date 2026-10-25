import {outputLimits} from './output-limits';
import { z } from 'zod';
import {webEvidenceSchema,type WebEvidence} from './web';
import {imageLimits} from './attachment';

export const artifactSchema = z.object({
  attachmentIds:z.array(z.string().uuid()).max(imageLimits.count).optional(),
  webEvidence:webEvidenceSchema.optional(),
  id: z.string().min(1), workspaceId: z.string().min(1), sourceChatId: z.string().min(1),
  type: z.literal('markdown'), title: z.string().min(1).max(1000), revision: z.number().int().positive(),
  revisionId: z.string().min(1), content: z.string().max(outputLimits.textChars), sourceDeleted: z.boolean()
}).strict();
export type MarkdownArtifact = z.infer<typeof artifactSchema>;
export const referenceSnapshotSchema = z.object({
  snapshotId: z.string(), artifactId: z.string(), revisionId: z.string(), revision: z.number().int().positive(), title: z.string().max(1000), content: z.string().max(outputLimits.textChars)
}).strict();
export type ReferenceSnapshot = z.infer<typeof referenceSnapshotSchema>;
export const artifactViewSchema = z.object({ artifacts: z.array(artifactSchema) }).strict();
export type ArtifactView = z.infer<typeof artifactViewSchema>;
export const artifactCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('artifact.query'), workspaceId: z.string().min(1), artifactId: z.string().min(1).optional(), sourceChatId: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal('artifact.save'), workspaceId: z.string().min(1), artifactId: z.string().min(1), expectedRevision: z.number().int().positive(), content: z.string().max(outputLimits.textChars) }).strict()
]);
export type ArtifactCommand = z.infer<typeof artifactCommandSchema>;
export interface ArtifactPort { command(command: ArtifactCommand): Promise<ArtifactView> }
export interface StoredArtifact {
  webEvidence?:WebEvidence;
  id: string; workspaceId: string; sourceChatId: string; type: 'markdown' | 'html' | 'html-page'; pageVersion?: 1; title: string;
  revision: number; revisionId: string; jobId: string; attemptId: string; deleted?: boolean; deletedAt?: number; managementRevision?: number;
}
export interface NoteRevision { id: string; artifactId: string; revision: number; content: string }
