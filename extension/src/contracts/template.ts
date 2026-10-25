import { z } from 'zod';
import { configurableDataSourceSchema, type ConfigurableDataSource } from './evidence';

export const templateFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200), description: z.string().max(2000), requirements: z.string().trim().min(1).max(8000),
  outputType: z.enum(['chat', 'markdown', 'html']), outputProtocol: z.enum(['knowledge-json-v1','html-page-v1']).optional(), defaultModelId: z.string().min(1).max(200).nullable(),
  requiredSources: z.array(configurableDataSourceSchema).max(7).optional()
}).strict().refine(fields => !fields.outputProtocol || fields.outputType === 'html', { message: 'Knowledge protocol requires html output' });
export type TemplateFields = z.infer<typeof templateFieldsSchema>;
export const requiredTemplateSources = (template: Pick<TemplateFields, 'requiredSources'> | undefined): readonly ConfigurableDataSource[] => template?.requiredSources ?? [];
export const templateRevisionSchema = templateFieldsSchema.safeExtend({ templateId: z.string().min(1), revisionId: z.string().min(1), revision: z.number().int().positive(), backupOriginalId: z.string().min(1).optional() });
export type TemplateRevision = z.infer<typeof templateRevisionSchema>;
export const templateSchema = templateFieldsSchema.safeExtend({ id: z.string().min(1), revisionId: z.string().min(1), revision: z.number().int().positive(), builtin: z.boolean(), deleted: z.boolean().optional(), backupOriginalId: z.string().min(1).optional(), sortIndex: z.number().int().nonnegative().optional() });
export type Template = z.infer<typeof templateSchema>;
// Missing identity preserves pre-T09 free-HTML semantics, including imported copies.
export const isLegacyHtmlTemplate = (template: Pick<TemplateFields, 'outputType' | 'outputProtocol'> | undefined) => template?.outputType === 'html' && !template.outputProtocol;
export const isRetiredGenerationTemplate = (template: Pick<TemplateFields, 'outputType' | 'outputProtocol'> | undefined) => isLegacyHtmlTemplate(template) || template?.outputProtocol === 'knowledge-json-v1';
export const templateViewSchema = z.object({ templates: z.array(templateSchema), revisions: z.array(templateRevisionSchema).optional() }).strict();
export type TemplateView = z.infer<typeof templateViewSchema>;
export const templateCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('template.query'), selected: z.object({ templateId: z.string().min(1), revisionId: z.string().min(1) }).strict().optional() }).strict(),
  z.object({ type: z.literal('template.reorder'), ids: z.array(z.string().min(1)).max(10000).refine(ids => new Set(ids).size === ids.length) }).strict(),
  z.object({ type: z.literal('template.create'), fields: templateFieldsSchema }).strict(),
  z.object({ type: z.literal('template.delete'), templateId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('template.save'), templateId: z.string().min(1), expectedRevision: z.number().int().positive(), fields: templateFieldsSchema }).strict()
]);
export type TemplateCommand = z.infer<typeof templateCommandSchema>;
export interface TemplatePort { command(command: TemplateCommand): Promise<TemplateView> }
