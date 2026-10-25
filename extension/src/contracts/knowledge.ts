import { z } from 'zod';
import {webEvidenceSchema} from './web';
import {outputLimits} from './output-limits';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
export const knowledgeEntrySchema = z.object({ id, title: text(160), body: text(2000), basis: z.enum(['video', 'explanation', 'inference']), question: text(400) }).strict();
export const knowledgeSchema = z.object({
  version: z.literal(1), title: text(160), summary: text(4000),
  groups: z.array(z.object({ id, title: text(160), items: z.array(knowledgeEntrySchema).min(1).max(40) }).strict()).min(1).max(12),
  concepts: z.array(knowledgeEntrySchema).max(50),
  relations: z.array(z.object({ from: id, to: id, label: text(160) }).strict()).max(100),
  questions: z.array(knowledgeEntrySchema).max(30)
}).strict().superRefine((value, ctx) => {
  const entries = knowledgeEntries(value), ids = [...value.groups.map(g => g.id), ...entries.map(e => e.id)];
  const entryIds = new Set(entries.map(e => e.id));
  if (entries.length > 120 || new Set(ids).size !== ids.length || JSON.stringify(value).length > 60000 || value.relations.some(r => !entryIds.has(r.from) || !entryIds.has(r.to)) || new Set(value.relations.map(r => JSON.stringify([r.from, r.to, r.label]))).size !== value.relations.length)
    ctx.addIssue({ code: 'custom', message: '内容过大、重复标识或关系指向不存在的条目' });
});
export type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>;
export interface KnowledgeDocument {
  version: 1;
  title: string;
  summary: string;
  groups: {
    id: string;
    title: string;
    items: KnowledgeEntry[];
  }[];
  concepts: KnowledgeEntry[];
  relations: {
    from: string;
    to: string;
    label: string;
  }[];
  questions: KnowledgeEntry[];
}
export function knowledgeEntries(value: KnowledgeDocument): KnowledgeEntry[] { return [...value.groups.flatMap(g => g.items), ...value.concepts, ...value.questions]; }
export function parseKnowledge(text: string): KnowledgeDocument {
  if (text.length > 60000)
    throw new Error('knowledge-format');
  const normalized = text.trim().replace(/^```json\s*\n([\s\S]*)\n```$/, '$1');
  return knowledgeSchema.parse(JSON.parse(normalized));
}
export const knowledgeSelectionSchema = z.object({ artifactId: z.string().min(1), revisionId: z.string().min(1), entryId: id }).strict();
export const knowledgeContextSchema = knowledgeSelectionSchema.extend({ snapshotId: z.string().min(1), title: text(160), entry: knowledgeEntrySchema }).strict();
export type KnowledgeContext = z.infer<typeof knowledgeContextSchema>;
export const knowledgeArtifactSchema = z.object({ webEvidence:webEvidenceSchema.optional(), id: z.string(), workspaceId: z.string(), sourceChatId: z.string(), revisionId: z.string(), type: z.literal('html'), title: z.string(), document: knowledgeSchema, sourceDeleted: z.boolean() }).strict();
export type KnowledgeArtifact = z.infer<typeof knowledgeArtifactSchema>;
export const htmlPageSchema = z.object({ id:z.string(), workspaceId:z.string(), sourceChatId:z.string(), revisionId:z.string(), type:z.literal('html-page'), pageVersion:z.literal(1), title:z.string(), source:z.string().max(outputLimits.htmlChars), sourceDeleted:z.boolean(), webEvidence:webEvidenceSchema.optional() }).strict();
export type HtmlPage = z.infer<typeof htmlPageSchema>;
export const knowledgeViewSchema = z.object({ artifacts: z.array(z.union([knowledgeArtifactSchema, htmlPageSchema])) }).strict();
export type KnowledgeView = z.infer<typeof knowledgeViewSchema>;
export const knowledgeCommandSchema = z.object({ type: z.literal('knowledge.query'), workspaceId: z.string().min(1), artifactId: z.string().min(1).optional() }).strict();
export type KnowledgeCommand = z.infer<typeof knowledgeCommandSchema>;
export interface KnowledgePort {
  command(command: KnowledgeCommand): Promise<KnowledgeView>;
}
