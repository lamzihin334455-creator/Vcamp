import { z } from 'zod';
import { modelIdSchema, type ProviderView } from '../contracts/provider';

export { providerDirectory } from '../contracts/provider-config';
import { providerBaseUrl, nativeDeepSeek, type ProviderConnection } from '../contracts/provider-config';
import { normalizeProviderModels } from './provider-model-routing';
const modalities = z.array(z.string().min(1).max(40)).max(16);
const responseSchema = z.object({ object: z.enum(['list', 'LIST']).optional(), data: z.array(z.object({
  id: modelIdSchema, object: z.enum(['model', 'MODEL']).optional(), owned_by: z.string().optional(),
  name: z.string().min(1).max(160).optional(),
  max_output_tokens: z.unknown().optional(),
  input_modalities: modalities.optional(), output_modalities: modalities.optional()
})).max(1000) });
export class ModelListError extends Error {
  constructor(public status: ProviderView['status']) { super(status); }
}
export async function fetchModelList(key: string, transport: typeof fetch, signal: AbortSignal, connection: ProviderConnection = { providerId: 'deepseek' }): Promise<ProviderView['models']> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const base = providerBaseUrl(connection);
    // SenseCore's legacy compatible chat endpoint uses its native model catalogue.
    const endpoint = base === 'https://api.sensenova.cn/compatible-mode/v2' ? 'https://api.sensenova.cn/v1/llm/models' : `${base}/models`;
    const response = await transport(endpoint, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { authorization: `Bearer ${key}` }, signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ModelListError(response.status === 401 || response.status === 403 ? 'authentication' : response.status === 429 ? 'rate-limited' : 'unavailable');
    }
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) {
      await response.body?.cancel(); throw new ModelListError('protocol');
    }
    reader = response.body.getReader(); let bytes = 0, text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 1048576) throw new ModelListError('protocol');
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    let value: z.infer<typeof responseSchema>;
    try { value = responseSchema.parse(JSON.parse(text)); } catch { throw new ModelListError('protocol'); }
    if (!value.data.length) throw new ModelListError('empty');
    // Catalogues can repeat a model ID; keep one selectable entry per ID.
    value.data = [...new Map(value.data.map(model => [model.id, model])).values()];
    // A response must not echo the credential into persisted model metadata.
    if (value.data.some(m => m.id.includes(key) || m.name?.includes(key))) throw new ModelListError('protocol');
    return normalizeProviderModels(connection, value.data.map(m => ({ id: m.id, name: m.name ?? m.id,
      ...(z.number().int().positive().max(1048576).safeParse(m.max_output_tokens).success?{maxOutputTokens:m.max_output_tokens as number}:{}),
      text: m.input_modalities && !m.input_modalities.includes('text') || m.output_modalities && !m.output_modalities.includes('text') ? 'unsupported' : m.input_modalities === undefined ? 'unknown' : 'declared',
      vision: !nativeDeepSeek(connection) ? 'unsupported' : m.input_modalities === undefined ? 'unknown' : m.input_modalities.includes('image') ? 'declared' : 'unsupported', web: 'unknown' })));
  } catch (error) { throw error instanceof ModelListError ? error : new ModelListError(signal.aborted ? 'timeout' : 'network'); }
  finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
}
