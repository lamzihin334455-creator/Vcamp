import {htmlEnvelope} from '../contracts/html-page';
import { imageLimits, imageDataSchema } from '../contracts/attachment';
import { validateImage } from '../data/image-validation';
import { z } from 'zod';
import type { GenerationFailure } from '../contracts/generation';
import { completionEndpoint } from '@provider-endpoint';
import { nativeDeepSeek, providerBaseUrl, providerDirectory, type ProviderConnection } from '../contracts/provider-config';
import { modelIdSchema } from '../contracts/provider';
import { readProviderErrorCode, providerHttpFailure } from './provider-rejection';
export function providerCompletionEndpoint(connection: ProviderConnection) { return nativeDeepSeek(connection) ? completionEndpoint : `${providerBaseUrl(connection)}/chat/completions`; }
import { limits } from './subtitle-context';
import { generationDiagnosticSchema, type GenerationDiagnostic, type GenerationPurpose } from '../contracts/generation-diagnostic';
import { purposePolicy,purposeTransportPolicy } from './purpose-policy';
import {isFinalOutput,outputOptions,type OutputConnection} from './output-policy';
import { providerModelId } from './provider-model-routing';
export interface ProviderMessage { role: 'system' | 'user' | 'assistant'; content: string | ({type:'text';text:string}|{type:'image_url';image_url:{url:string;detail?:'low'|'original'}})[] }
export interface ProviderPort { stream(modelId: string, messages: readonly ProviderMessage[], signal: AbortSignal, delta: (text: string) => Promise<void>, purpose?: GenerationPurpose): Promise<void> }
export class ProviderError extends Error { constructor(public code: GenerationFailure, public diagnostic?: GenerationDiagnostic) { super(code); } }
const choiceSchema = z.object({ index: z.number().int(), delta: z.object({ content: z.string().nullable().optional(), reasoning_content: z.string().nullable().optional(), tool_calls: z.unknown().optional() }).passthrough(), finish_reason: z.string().nullable() }).passthrough();
const chunkSchema = z.object({ choices: z.array(choiceSchema).max(1) }).passthrough();
// Some compatible providers omit index for their sole choice. Multiple choices
// and explicit nonzero indices remain invalid; native DeepSeek stays strict.
const compatibleChunkSchema = chunkSchema.extend({ choices: z.array(choiceSchema.extend({ index: z.number().int().default(0) })).max(1) });

export function createProviderPort(key: string, transport: typeof fetch = fetch, endpoint = completionEndpoint, report?: (diagnostic: GenerationDiagnostic) => Promise<void>, connection: OutputConnection = { providerId: 'deepseek' }): ProviderPort {
  return { async stream(modelId, messages, signal, delta, purpose = 'answer') {
    modelId = providerModelId(connection, modelId);
    const native = nativeDeepSeek(connection);
    const policy = purposePolicy[purpose], options=outputOptions(connection,modelId,purpose);
    const transportPolicy=purposeTransportPolicy(purpose);
    const diagnostic: GenerationDiagnostic = { purpose, cause: 'protocol', ...(options.maxTokens===undefined?{}:{maxTokens:options.maxTokens}), outputChars: 0, responseBytes: 0, usage: {} };
    diagnostic.providerId = connection.providerId;
    diagnostic.providerEndpoint = providerBaseUrl(connection) === providerDirectory.find(item => item.id === connection.providerId)?.baseUrl ? 'preset' : 'custom';
    if (modelIdSchema.safeParse(modelId).success && !modelId.includes(key)) diagnostic.modelId = modelId;
    const idleController=new AbortController();
    let idleTimer:ReturnType<typeof setTimeout>|undefined;
    const activity=()=>{clearTimeout(idleTimer);if(isFinalOutput(purpose))idleTimer=setTimeout(()=>idleController.abort(),180000);};
    signal=AbortSignal.any([signal,idleController.signal]);
    activity();
    let htmlOutput = '';
    const limit = (cause: GenerationDiagnostic['cause']): never => { diagnostic.cause = cause; throw new ProviderError('output-limit', diagnostic); };
    try {
      signal.throwIfAborted();
      let chars=0, imageCount=0, imageBytes=0;
      for(const message of messages){
        if(typeof message.content==='string'){chars+=message.content.length;continue;}
        for(const part of message.content){
          if(part.type==='text'){chars+=part.text.length;continue;}
          const data=part.image_url.url;
          if(!imageDataSchema.safeParse(data).success)throw new ProviderError('protocol');
          const bytes=Uint8Array.from(atob(data.slice(22)),c=>c.charCodeAt(0));
          if(bytes.length<24)throw new ProviderError('protocol');
          const view=new DataView(bytes.buffer);
          try{await validateImage({dataUrl:data,width:view.getUint32(16),height:view.getUint32(20),time:0});}catch{throw new ProviderError('protocol');}
          imageCount++;imageBytes+=bytes.length;
        }
      }
      if(!native && imageCount) throw new ProviderError('model-unavailable');
      if(chars>limits.requestChars||imageCount>imageLimits.count||imageBytes>imageLimits.totalBytes)throw new ProviderError('context-limit');
      let response: Response;
      try {
        response = await transport(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ model: modelId, messages, stream: true, ...options.thinking, ...(options.includeUsage ? { stream_options: { include_usage: true } } : {}), ...(options.maxTokens===undefined?{}:{max_tokens:options.maxTokens}), ...(native && policy.json ? { response_format: { type: 'json_object' } } : {}) }), credentials: 'omit', cache: 'no-store', redirect: 'error', signal });
      } catch { throw new ProviderError(signal.aborted ? 'timeout' : 'network'); }
      if (!response.ok) {
        diagnostic.httpStatus = response.status;
        const retryAfter = response.headers.get('retry-after')?.trim();
        if (response.status === 429 && retryAfter && /^\d{1,5}$/.test(retryAfter) && Number(retryAfter) > 0 && Number(retryAfter) <= 86400) diagnostic.retryAfterSeconds = Number(retryAfter);
        const code = await readProviderErrorCode(response, key, signal);
        if (code) diagnostic.serviceErrorCode = code;
        throw new ProviderError(providerHttpFailure(response.status, code));
      }
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new ProviderError('protocol'); }
      const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = '', eventData: string[] = [], bytes = 0, output = '', emitted = 0, done = false, finished = false;
      const abort = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      async function dispatch() {
        if (!eventData.length) return;
        const data = eventData.join('\n'); eventData = [];
        if (data === '[DONE]') { if (!finished) throw new ProviderError('protocol'); done = true; return; }
        if (done) throw new ProviderError('protocol');
        let parsed;
        try { parsed = (native ? chunkSchema : compatibleChunkSchema).parse(JSON.parse(data)); } catch { throw new ProviderError('protocol'); }
        const usage = (parsed as Record<string, unknown>).usage;
        if (usage && typeof usage === 'object') {
          const u = usage as Record<string, unknown>;
          const details = u.completion_tokens_details as Record<string, unknown> | undefined;
          for (const [name, value] of Object.entries({ inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens, reasoningTokens: details?.reasoning_tokens, cacheReadTokens: u.prompt_cache_hit_tokens })) {
            if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000000) Object.assign(diagnostic.usage, { [name]: value });
          }
        }
        const choice = parsed.choices[0];
        if (!choice) return; // optional usage-only chunk
        if (choice.index !== 0 || choice.delta.tool_calls) throw new ProviderError('protocol');
        const text = choice.delta.content ?? '';
        diagnostic.outputChars = output.length + text.length;
        if(purpose==='html-page')htmlOutput=output+text;
        if (choice.finish_reason !== null && (native || choice.finish_reason !== '')) {
          if (choice.finish_reason === 'length') limit('service-length');
          if (choice.finish_reason !== 'stop') throw new ProviderError('protocol');
          finished = true;
        }
        if (text) {
          output += text;
          // Never send an echoed credential to the UI or persistence (including
          // a credential split across frames). Fixed errors contain no response.
          if (output.includes(key)) throw new ProviderError('protocol');
          if (output.length > policy.outputChars) limit('local-characters');
          // Hold a suffix matching a key prefix, so even split credential echoes
          // cannot be published one piece at a time.
          let held = 0;
          for (let length = 1; length < key.length && length <= output.length; length++) if (output.endsWith(key.slice(0, length))) held = length;
          const safeEnd = output.length - held;
          if (safeEnd > emitted) { await delta(output.slice(emitted, safeEnd)); emitted = safeEnd; }
        }
      }
      try {
        while (!done) {
          signal.throwIfAborted();
          const next = await reader.read();
          signal.throwIfAborted();
          activity();
          pending += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
          bytes += next.value?.byteLength ?? 0;
          diagnostic.responseBytes = bytes;
          if (bytes > transportPolicy.responseBytes) limit('response-bytes');
          let newline: number;
          while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline).replace(/\r$/, ''); pending = pending.slice(newline + 1);
            if (line.length > transportPolicy.eventChars) limit('event-buffer');
            if (!line) await dispatch();
            else if (line.startsWith('data:')) {
              eventData.push(line.slice(5).replace(/^ /, ''));
              if (eventData.reduce((n, line) => n + line.length + 1, 0) > transportPolicy.eventChars) limit('event-buffer');
            }
          }
          if (pending.length > transportPolicy.eventChars) limit('event-buffer');
          if (next.done) break;
        }
        if (!done || !finished || !output.trim()) throw new ProviderError('protocol');
        if (emitted < output.length) await delta(output.slice(emitted));
        diagnostic.cause = 'stop';
      } catch (error) { throw error instanceof ProviderError ? error : new ProviderError(signal.aborted ? 'timeout' : 'protocol'); }
      finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) {
      if (signal.aborted) diagnostic.cause = 'cancelled';
      else if (error instanceof ProviderError && (diagnostic.httpStatus || ['network', 'auth', 'request-rejected', 'rate-limit', 'context-limit'].includes(error.code))) diagnostic.cause = 'transport';
      const failure = error instanceof ProviderError ? error : new ProviderError(signal.aborted ? 'timeout' : 'protocol');
      failure.diagnostic = generationDiagnosticSchema.parse(diagnostic);
      throw failure;
    } finally {
      clearTimeout(idleTimer);
      if(purpose==='html-page'){diagnostic.modelId=modelId;diagnostic.htmlEnvelope=htmlEnvelope(htmlOutput);}
      // Optional diagnostic storage must neither discard a complete answer nor
      // replace the original transport/protocol failure with a storage error.
      try {await report?.(generationDiagnosticSchema.parse(diagnostic));} catch { /* best-effort metadata */ }
    }
  } };
}
