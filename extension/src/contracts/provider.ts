import { z } from 'zod';
import { providerIdSchema, baseUrlSchema } from './provider-config';

export const modelIdSchema = z.string().regex(/^[A-Za-z0-9_.:/-]{1,160}$/);
export const providerModelSchema = z.object({ id: modelIdSchema, name: z.string().min(1).max(160),
  maxOutputTokens: z.number().int().positive().max(1048576).optional(),
  text: z.enum(['declared', 'unknown', 'unsupported']), vision: z.enum(['declared', 'unknown', 'unsupported']),
  web: z.literal('unknown') }).strict();
export const providerStatusSchema = z.enum(['idle', 'loading', 'ready', 'key-required', 'authentication', 'rate-limited', 'network', 'timeout', 'empty', 'protocol', 'unavailable']);
const profileIdSchema = z.string().uuid();
export const providerProfileSchema = z.object({ id: profileIdSchema, label: z.string().min(1).max(40), providerId: providerIdSchema, baseUrl: baseUrlSchema.optional(), modelCount: z.number().int().nonnegative(), catalogCount: z.number().int().nonnegative(), models: z.array(providerModelSchema).max(1000).optional() }).strict();
export const providerViewSchema = z.object({ providerId: providerIdSchema, baseUrl: baseUrlSchema.optional(), revision: z.number().int().nonnegative(),
  profileId: profileIdSchema.optional(), profileLabel: z.string().min(1).max(40).optional(), profiles: z.array(providerProfileSchema).max(50).optional(), catalog: z.array(providerModelSchema).max(1000).optional(),
  hasKey: z.boolean(), models: z.array(providerModelSchema).max(1000), defaultModelId: modelIdSchema.nullable(),
  status: providerStatusSchema }).strict();
const keySchema = z.string().regex(/^[\x21-\x7e]{1,256}$/);
const storedProfileSchema = z.object({ id: profileIdSchema, label: z.string().min(1).max(40), providerId: providerIdSchema, baseUrl: baseUrlSchema.optional(), key: keySchema, catalog: z.array(providerModelSchema).max(1000), models: z.array(providerModelSchema).max(1000), defaultModelId: modelIdSchema.nullable() }).strict();
export const providerCredentialSchema = providerViewSchema.omit({ hasKey: true, profiles: true }).extend({ key: keySchema.nullable(), savedProfiles: z.array(storedProfileSchema).max(50).optional() });
export type ProviderView = z.infer<typeof providerViewSchema>;
export const providerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('provider.query') }).strict(),
  z.object({ type: z.literal('provider.select-profile'), profileId: profileIdSchema, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('provider.delete-profile'), profileId: profileIdSchema, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('provider.select-model'), profileId: profileIdSchema, modelId: modelIdSchema, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('provider.rename-profile'), label: z.string().trim().min(1).max(40), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('provider.import-models'), modelIds: z.array(modelIdSchema).max(1000).refine(ids => new Set(ids).size === ids.length), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('provider.configure'), providerId: providerIdSchema, baseUrl: baseUrlSchema, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('provider.add-model'), expectedRevision: z.number().int().nonnegative(), modelId: modelIdSchema }).strict(),
  z.object({ type: z.literal('provider.save-key'), providerId: providerIdSchema, expectedRevision: z.number().int().nonnegative(), key: z.string().regex(/^[\x21-\x7e]{1,256}$/) }).strict(),
  z.object({ type: z.literal('provider.delete-key'), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('provider.fetch'), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('provider.default'), expectedRevision: z.number().int().nonnegative(), modelId: modelIdSchema }).strict()
]);
export type ProviderCommand = z.infer<typeof providerCommandSchema>;
export interface ProviderService { command(command: ProviderCommand): Promise<ProviderView> }
