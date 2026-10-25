import {z} from 'zod';
export const styleFieldsSchema=z.object({name:z.string().trim().min(1).max(200),description:z.string().trim().min(1).max(4000)}).strict();
export type StyleFields=z.infer<typeof styleFieldsSchema>;
export const styleRevisionSchema=styleFieldsSchema.extend({styleId:z.string().min(1),revisionId:z.string().min(1),revision:z.number().int().positive(),backupOriginalId:z.string().min(1).optional()});
export type StyleRevision=z.infer<typeof styleRevisionSchema>;
export const styleSchema=styleFieldsSchema.extend({id:z.string().min(1),revisionId:z.string().min(1),revision:z.number().int().positive(),builtin:z.boolean(),deleted:z.boolean().optional(),backupOriginalId:z.string().min(1).optional(),sortIndex:z.number().int().nonnegative().optional()});
export type PromptStyle=z.infer<typeof styleSchema>;
export const styleSelectionSchema=z.object({styleId:z.string().min(1),revisionId:z.string().min(1)}).strict();
export const styleViewSchema=z.object({styles:z.array(styleSchema),revisions:z.array(styleRevisionSchema).optional()}).strict();
export type StyleView=z.infer<typeof styleViewSchema>;
export const styleCommandSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('style.query'),selected:styleSelectionSchema.optional()}).strict(),
 z.object({type:z.literal('style.reorder'),ids:z.array(z.string().min(1)).max(10000).refine(ids=>new Set(ids).size===ids.length)}).strict(),
 z.object({type:z.literal('style.create'),fields:styleFieldsSchema}).strict(),
 z.object({type:z.literal('style.save'),styleId:z.string().min(1),expectedRevision:z.number().int().positive(),fields:styleFieldsSchema}).strict(),
 z.object({type:z.literal('style.delete'),styleId:z.string().min(1),expectedRevision:z.number().int().positive()}).strict()
]);
export type StyleCommand=z.infer<typeof styleCommandSchema>;
export interface StylePort{command(command:StyleCommand):Promise<StyleView>}
