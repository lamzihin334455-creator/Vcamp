import { z } from 'zod';

export const roleFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  instructions: z.string().trim().min(1).max(4000)
}).strict();
export type RoleFields = z.infer<typeof roleFieldsSchema>;
export const roleRevisionSchema = roleFieldsSchema.extend({ roleId: z.string().min(1), revisionId: z.string().min(1), revision: z.number().int().positive(), backupOriginalId: z.string().min(1).optional() });
export type RoleRevision = z.infer<typeof roleRevisionSchema>;
export const roleSchema = roleFieldsSchema.extend({ id: z.string().min(1), revisionId: z.string().min(1), revision: z.number().int().positive(), builtin: z.boolean(), deleted: z.boolean().optional(), backupOriginalId: z.string().min(1).optional() });
export type PromptRole = z.infer<typeof roleSchema>;
export const roleSelectionSchema = z.object({ roleId: z.string().min(1), revisionId: z.string().min(1) }).strict();
export type RoleSelection = z.infer<typeof roleSelectionSchema>;
export const roleViewSchema = z.object({ roles: z.array(roleSchema), revisions: z.array(roleRevisionSchema).optional() }).strict();
export type RoleView = z.infer<typeof roleViewSchema>;
export const roleCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('role.query'), selected: roleSelectionSchema.optional() }).strict(),
  z.object({ type: z.literal('role.create'), fields: roleFieldsSchema }).strict(),
  z.object({ type: z.literal('role.save'), roleId: z.string().min(1), expectedRevision: z.number().int().positive(), fields: roleFieldsSchema }).strict(),
  z.object({ type: z.literal('role.delete'), roleId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict()
]);
export type RoleCommand = z.infer<typeof roleCommandSchema>;
export interface RolePort { command(command: RoleCommand): Promise<RoleView> }
