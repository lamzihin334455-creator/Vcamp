import { instructionCallSchema, type InstructionCall } from '../contracts/instructions';
import { fixedPromptRules } from '../prompts/fixed-rules';

const storageKey = 'vcamp.instruction-trace.v1';
const maxBytes = 4 * 1024 * 1024, maxAge = 24 * 60 * 60 * 1000;
type SessionStorage = { get(key: string): Promise<Record<string, unknown>>; set(value: Record<string, unknown>): Promise<void> };
type Identity = { traceId: string; jobId?: string; attemptId?: string };

// Session-only: never included in IndexedDB, exports, or error diagnostics.
export class InstructionTraceStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private storage: SessionStorage, private now = Date.now) {}
  private async read() {
    const rows = (await this.storage.get(storageKey))[storageKey];
    return (Array.isArray(rows) ? rows : []).flatMap(row => {
      const parsed = instructionCallSchema.safeParse(row);
      return parsed.success && this.now() - parsed.data.capturedAt < maxAge ? [parsed.data] : [];
    });
  }
  private mutate(update: (rows: InstructionCall[]) => InstructionCall[]) {
    const result = this.queue.then(async () => {
      const rows = update(await this.read()).slice(-60);
      while (rows.length && new TextEncoder().encode(JSON.stringify(rows)).byteLength > maxBytes) rows.shift();
      await this.storage.set({ [storageKey]: rows });
    });
    this.queue = result.catch(() => {});
    return result;
  }
  add(row: InstructionCall) { return this.mutate(rows => [...rows, instructionCallSchema.parse(row)]); }
  status(id: string, status: InstructionCall['status'], httpStatus?: number) {
    return this.mutate(rows => rows.map(row => row.id === id ? { ...row, status, ...(httpStatus === undefined ? {} : { httpStatus }) } : row));
  }
  link(traceId: string, jobId: string, attemptId: string) {
    return this.mutate(rows => rows.map(row => row.traceId === traceId ? { ...row, jobId, attemptId } : row));
  }
  failedPlan(jobId:string,attemptId:string,output:string){
    return this.mutate(rows=>{
      // The caller supplies only a successfully completed provider stream. The
      // provider has already rejected echoed credentials and oversized output.
      for(let i=rows.length-1;i>=0;i--)if(rows[i].jobId===jobId&&rows[i].attemptId===attemptId&&rows[i].stage==='vision-plan'){
        rows[i]=instructionCallSchema.parse({...rows[i],failedPlanResponse:output});break;
      }
      return rows;
    });
  }
  async query(jobId: string) { await this.queue; return (await this.read()).filter(row => row.jobId === jobId); }
  failedReview(jobId:string,attemptId:string,output:string){
    return this.mutate(rows=>{
      for(let i=rows.length-1;i>=0;i--)if(rows[i].jobId===jobId&&rows[i].attemptId===attemptId&&rows[i].stage==='vision-review'){
        rows[i]=instructionCallSchema.parse({...rows[i],failedReviewResponse:output});break;
      }
      return rows;
    });
  }
}

let sessionStore: InstructionTraceStore | undefined;
export function instructionTraces() { return sessionStore ??= new InstructionTraceStore(chrome.storage.session); }

/** Observes the serialized body handed to fetch, never headers or responses.
 * Failure to record must not fail or repeat the underlying model invocation. */
export function tracedTransport(identity: Identity, key: string, transport: typeof fetch = fetch, store?: InstructionTraceStore): typeof fetch {
  return async (input, init) => {
    let id: string | undefined, target: InstructionTraceStore | undefined;
    try {
      const original = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const directSearch=new URL(String(input)).pathname==='/v1/tools/search'&&typeof original?.query==='string';
      if (init?.method === 'POST' && original && (Array.isArray(original.messages)||directSearch)) {
        target = store ?? instructionTraces();
        const images: InstructionCall['images'] = [];
        let redacted = false;
        const clean = async (value: unknown): Promise<unknown> => {
          if (typeof value === 'string') {
            if (/^data:image\/png;base64,/.test(value)) {
              const bytes = Uint8Array.from(atob(value.slice(22)), c => c.charCodeAt(0));
              const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
              images.push({ sha256, bytes: bytes.length });
              return `[图片 ${images.length}；PNG；${bytes.length} bytes；SHA-256 ${sha256}；图像字节另存于原附件]`;
            }
            if (key && value.includes(key)) { redacted = true; return value.split(key).join('[密钥已隐藏]'); }
            return value;
          }
          if (Array.isArray(value)) { const result = []; for (const item of value) result.push(await clean(item)); return result; }
          if (value && typeof value === 'object') {
            const result: Record<string, unknown> = {};
            for (const [name, item] of Object.entries(value)) result[name] = await clean(item);
            return result;
          }
          return value;
        };
        // Allowlist transport parameters. Authentication never belongs here.
        const allowed = Object.fromEntries((directSearch?['query','count','need_content','ori_question']:['model', 'messages', 'system', 'stream', 'thinking', 'stream_options', 'max_tokens', 'response_format', 'tools', 'tool_choice']).filter(name => name in original).map(name => [name, original[name]]));
        const body = await clean(allowed) as typeof original;
        const system = typeof body.system === 'string' ? body.system : (body.messages??[]).filter((m: { role: string }) => m.role === 'system').map((m: { content: string }) => m.content).join('\n\n');
        const rules = Object.values(fixedPromptRules).flatMap(rule => {
          const marker = `[${rule.priority}:${rule.id}] ${rule.title}\n`, start = system.indexOf(marker);
          if (start < 0) return [];
          const remaining = system.slice(start + marker.length), end = remaining.search(/\n\n\[P[01]:/);
          return [{ ...rule, text: end < 0 ? remaining : remaining.slice(0, end) }];
        });
        const stage = directSearch?'web-search':['requirements-plan', 'vision-plan', 'vision-review', 'web-query', 'web-search', 'subtitle-terms','subtitle-reconcile','subtitle-correction-review','subtitle-enhance', 'subtitle-translate', 'html-format', 'markdown-output', 'legacy-knowledge', 'chat-output'].find(name => rules.some(rule => rule.id === name)) ?? 'unknown';
        id = crypto.randomUUID();
        await target.add({ ...identity, id, capturedAt: Date.now(), stage, modelId: directSearch?'DeepSeek Search':String(body.model ?? ''), status: 'dispatching', rules, body: JSON.stringify(body, null, 2), images, redacted });
      }
    } catch { /* The viewer is optional; generation must remain available. */ }
    try {
      const response = await transport(input, init);
      if (id && target) await target.status(id, 'http-response', response.status).catch(() => {});
      return response;
    } catch (error) {
      if (id && target) await target.status(id, 'network-error').catch(() => {});
      throw error;
    }
  };
}
