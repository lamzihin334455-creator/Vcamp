import { z } from 'zod';
export const scribbleSchema = z.object({ creationOrder:z.number().int().nonnegative().optional(), id: z.string().min(1), workspaceId: z.string().min(1), text: z.string().min(1).max(100000).refine(value => !!value.trim()), time: z.number().finite().nonnegative().nullable(), revision: z.number().int().positive(), deleted: z.boolean().optional(), deletedAt: z.number().optional(), managementRevision: z.number().int().nonnegative().optional() }).strict();
export type Scribble = z.infer<typeof scribbleSchema>;
export const scribbleViewSchema = z.object({ scribbles: z.array(scribbleSchema) }).strict();
export type ScribbleView = z.infer<typeof scribbleViewSchema>;
export const scribbleCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scribble.query'), workspaceId: z.string().min(1), scribbleId: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal('scribble.create'), workspaceId: z.string().min(1), text: scribbleSchema.shape.text, time: scribbleSchema.shape.time, origin: z.object({ chatId: z.string().min(1), expectedRevision: z.number().int().nonnegative() }).strict().optional() }).strict(),
  z.object({ type: z.literal('scribble.save'), workspaceId: z.string().min(1), scribbleId: z.string().min(1), expectedRevision: z.number().int().positive(), text: scribbleSchema.shape.text }).strict()
]);
export type ScribbleCommand = z.infer<typeof scribbleCommandSchema>;
export interface ScribblePort { command(command: ScribbleCommand): Promise<ScribbleView> }
