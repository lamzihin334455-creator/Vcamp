import { providerServiceErrorCodeSchema, type ProviderServiceErrorCode } from '../contracts/generation-diagnostic';
import type { GenerationFailure } from '../contracts/generation';

/** Read only a small JSON error envelope. Never return service messages or raw codes. */
export async function readProviderErrorCode(response: Response, key: string, signal: AbortSignal): Promise<ProviderServiceErrorCode | undefined> {
  if (!response.body) return;
  if (!/\bjson\b/i.test(response.headers.get('content-type') ?? '')) { await response.body.cancel().catch(() => {}); return; }
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let bytes = 0, cancelled = false;
  const cancel = () => { cancelled = true; void reader.cancel().catch(() => {}); };
  const timer = setTimeout(cancel, 2000);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) return;
    for (;;) {
      const part = await reader.read();
      if (cancelled) return;
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16384) return;
      parts.push(part.value);
    }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const part of parts) { joined.set(part, offset); offset += part.length; }
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
    const candidates = [envelope?.error?.code, envelope?.code, envelope?.error?.type];
    for (const candidate of candidates) {
      const parsed = providerServiceErrorCodeSchema.safeParse(candidate);
      if (parsed.success && parsed.data !== 'other' && !parsed.data.includes(key)) return parsed.data;
    }
    if (!'other'.includes(key)) return 'other';
  } catch { /* Keep the HTTP status even if its optional error envelope is unreadable. */ }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function providerHttpFailure(status: number, code?: ProviderServiceErrorCode): GenerationFailure {
  if (status === 401 || code && ['InvalidApiKey', 'invalid_api_key', 'authentication_error', 'InvalidAccessToken', 'AuthorizationNotFound'].includes(code)) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 413 || code === 'context_length_exceeded') return 'context-limit';
  if (code && ['ModelNotFound', 'model_not_found', 'model_not_supported'].includes(code)) return 'model-unavailable';
  if (status >= 400 && status < 500) return 'request-rejected';
  return 'network';
}
