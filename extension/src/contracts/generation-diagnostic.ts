import { z } from 'zod';
import { providerIdSchema } from './provider-config';

// Fixed provider codes only; arbitrary service prose and credentials never persist.
export const providerServiceErrorCodeSchema = z.enum([
  'InvalidApiKey', 'invalid_api_key', 'authentication_error', 'InvalidAccessToken', 'AuthorizationNotFound',
  'AccessDenied', 'access_denied', 'AccessDenied.Unpurchased', 'Model.AccessDenied',
  'Workspace.AccessDenied', 'App.AccessDenied', 'Endpoint.AccessDenied',
  'AllocationQuota.FreeTierOnly', 'Arrearage', 'InsufficientBalance', 'insufficient_balance',
  'insufficient_quota', 'QuotaExceeded', 'FREE_QUOTA_EXHAUSTED', 'ModelNotFound', 'model_not_found', 'model_not_supported',
  'InvalidParameter', 'invalid_request_error', 'context_length_exceeded', 'DataInspectionFailed', 'other'
]);
export type ProviderServiceErrorCode = z.infer<typeof providerServiceErrorCodeSchema>;

export const generationPurposeSchema = z.enum(['answer', 'html-page', 'markdown', 'knowledge', 'subtitle', 'summary', 'vision-plan', 'vision-review', 'requirements-plan', 'web-search', 'web-query']);
export type GenerationPurpose = z.infer<typeof generationPurposeSchema>;
const count = z.number().int().nonnegative().max(1000000000);
// Only allowlisted counts and causes cross the executor boundary. No response,
// reasoning, arbitrary error text, credentials or subtitle material belong here.
export const generationDiagnosticSchema = z.object({
  purpose: generationPurposeSchema,
  cause: z.enum(['stop', 'service-length', 'local-characters', 'response-bytes', 'event-buffer', 'protocol', 'cancelled', 'transport']),
  modelId: z.string().regex(/^[A-Za-z0-9_.:/-]{1,160}$/).optional(),
  providerId: providerIdSchema.optional(),
  providerEndpoint: z.enum(['preset', 'custom']).optional(),
  serviceErrorCode: providerServiceErrorCodeSchema.optional(),
  webStage:z.enum(['request','query-plan','search','http','body','json','envelope','tool-link','sources','material','complete']).optional(),
  webStopReason:z.enum(['end_turn','max_tokens','pause_turn','other']).optional(),
  httpStatus:z.number().int().min(100).max(599).optional(),
  retryAfterSeconds:z.number().int().min(1).max(86400).optional(),
  webAdapterVersion:z.union([z.literal(2),z.literal(3)]).optional(),
  webRoute:z.literal('deepseek-search-v2').optional(),
  webFailure:z.enum(['invalid-input','query-plan','invalid-query','request-rejected','invalid-json','response-shape','missing-execution','missing-result','unlinked-result','duplicate-tool-id','search-budget','tool-error','empty-material']).optional(),
  webServiceError:z.enum(['invalid_request_error','authentication_error','permission_error','not_found_error','rate_limit_error','api_error','overloaded_error','insufficient_balance','other']).optional(),
  webRejectedFields:z.array(z.enum(['tool_choice','tools','web_search_20250305','thinking','model','max_tokens','messages','query','context_length'])).max(9).optional(),
  webToolError:z.enum(['too_many_requests','invalid_tool_input','max_uses_exceeded','query_too_long','request_too_large','unavailable','other']).optional(),
  webToolUses:count.max(100).optional(), webToolResults:count.max(100).optional(),
  webSuccessfulSearches:count.max(1).optional(), webDeniedSearches:count.max(100).optional(),
  webInvalidFields:z.array(z.enum(['response','id','model','stop_reason','content','type','input','query','url','title','text','usage','output_tokens','server_tool_use','web_search_requests','results','summary','snippet'])).max(16).optional(),
  htmlEnvelope: z.enum(['complete','missing-start','missing-head','missing-title','missing-end','oversize']).optional(),
  maxTokens: count.optional(), outputChars: count, responseBytes: count,
  usage: z.object({ inputTokens: count.optional(), outputTokens: count.optional(), totalTokens: count.optional(), reasoningTokens: count.optional(), cacheReadTokens: count.optional(), searches:count.max(1).optional() }).strict()
}).strict();
export type GenerationDiagnostic = z.infer<typeof generationDiagnosticSchema>;
