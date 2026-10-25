import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
import { createProviderPort, providerCompletionEndpoint } from '../../src/generation/provider-port';
import { taskFailureMessage } from '../../src/workbench/MessageTask';
import { failureFeedback } from '../../src/workbench/failure-feedback';
import { readProviderErrorCode } from '../../src/generation/provider-rejection';

const connection = { providerId: 'bailian' as const, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' };
const key = 'SYNTHETIC_BAILIAN_KEY', model = 'deepseek-v4.1-flash-1017';
async function rejected(status: number, code: string, shape = 'openai') {
  const diagnostics: any[] = [], calls: any[] = [];
  const body = shape === 'openai' ? { error: { code, type: code, message: `PRIVATE_RESPONSE ${key}` } } : { code, message: `PRIVATE_RESPONSE ${key}` };
  const port = createProviderPort(key, async (url, init) => { calls.push({ url, auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) }); return Response.json(body, { status }); }, providerCompletionEndpoint(connection), async d => { diagnostics.push(d); }, connection);
  const failure = await port.stream(model, [{ role: 'user', content: 'PRIVATE_VIDEO_PROMPT' }], new AbortController().signal, async () => {}).catch(error => error);
  return { failure, diagnostic: diagnostics[0], diagnostics, calls };
}

test('Bailian model-access denial is not an invalid-Key diagnosis; routing and redacted export identify the rejected call', async () => {
  const result = await rejected(403, 'AccessDenied.Unpurchased');
  expect(result.failure.code).toBe('request-rejected');
  expect(result.diagnostic).toMatchObject({ purpose: 'answer', cause: 'transport', httpStatus: 403, providerId: 'bailian', modelId: model, serviceErrorCode: 'AccessDenied.Unpurchased' });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0]).toMatchObject({ url: `${connection.baseUrl}/chat/completions`, auth: `Bearer ${key}`, body: { model, stream: true } });
  const job: any = { state: 'failed', error: result.failure.code, diagnostics: result.diagnostics, coverage: { total: 1, covered: 0, ranges: [] } };
  expect(taskFailureMessage(job)).toContain('开通');
  expect(taskFailureMessage(job)).not.toContain('认证失败');
  const exported = failureFeedback(job, '0.1.71');
  expect(JSON.parse(exported).diagnostics[0]).toMatchObject({ httpStatus: 403, serviceErrorCode: 'AccessDenied.Unpurchased', providerId: 'bailian' });
  expect(exported).not.toMatch(/PRIVATE_|SYNTHETIC_|Bearer|https:/);
});

test('invalid Key, account balance, free-tier stop and workspace model access remain distinct', async () => {
  for (const [status, code, failure, hint] of [
    [401, 'invalid_api_key', 'auth', '服务地址'],
    [403, 'invalid_api_key', 'auth', '服务地址'],
    [403, 'Arrearage', 'request-rejected', '计费'],
    [403, 'AllocationQuota.FreeTierOnly', 'request-rejected', '免费额度'],
    [403, 'Model.AccessDenied', 'request-rejected', '权限'],
    [403, 'Workspace.AccessDenied', 'request-rejected', '业务空间'],
    [403, 'FREE_QUOTA_EXHAUSTED', 'request-rejected', '免费额度'],
    [429, 'FREE_QUOTA_EXHAUSTED', 'rate-limit', '免费额度'],
    [404, 'ModelNotFound', 'model-unavailable', '模型 ID'],
    [400, 'InvalidParameter', 'request-rejected', 'HTTP 400']
  ] as const) {
    const result = await rejected(status, code, 'native');
    expect(result.failure.code, code).toBe(failure);
    expect(result.diagnostic).toMatchObject({ httpStatus: status, serviceErrorCode: code });
    expect(taskFailureMessage({ error: result.failure.code, diagnostics: result.diagnostics } as any), code).toContain(hint);
    expect(JSON.stringify(result.diagnostic)).not.toMatch(/PRIVATE_|SYNTHETIC_/);
  }
});

test('error-envelope parsing bounds bytes, malformed JSON, time and cancellation', async () => {
  const signal = new AbortController().signal;
  expect(await readProviderErrorCode(new Response('{malformed', { headers: { 'content-type': 'application/json' } }), key, signal)).toBeUndefined();
  expect(await readProviderErrorCode(Response.json({ code: 'Arrearage', message: 'x'.repeat(16384) }), key, signal)).toBeUndefined();
  vi.useFakeTimers();
  try {
    const cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } });
    const pending = readProviderErrorCode(response, key, signal);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBeUndefined(); expect(cancel).toHaveBeenCalledOnce(); expect(response.body!.locked).toBe(false);
    const controller = new AbortController(), cancelled = vi.fn();
    const response2 = new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'content-type': 'application/json' } });
    const pending2 = readProviderErrorCode(response2, key, controller.signal); controller.abort();
    expect(await pending2).toBeUndefined(); expect(cancelled).toHaveBeenCalledOnce(); expect(response2.body!.locked).toBe(false);
  } finally { vi.useRealTimers(); }
});

test('unknown service prose and arbitrary codes are never persisted or rendered', async () => {
  const result = await rejected(403, `PRIVATE_UNKNOWN_CODE_${key}`);
  expect(result.diagnostic).toMatchObject({ httpStatus: 403, serviceErrorCode: 'other' });
  expect(taskFailureMessage({ error: result.failure.code, diagnostics: result.diagnostics } as any)).toContain('HTTP 403');
  expect(JSON.stringify(result.diagnostic)).not.toMatch(/PRIVATE_|SYNTHETIC_/);
});

test('a non-JSON forbidden response preserves the HTTP diagnosis without reading its prose', async () => {
  const reports: any[] = [];
  const response = new Response(`<html>PRIVATE_ERROR ${key}</html>`, { status: 403, headers: { 'content-type': 'text/html' } });
  const port = createProviderPort(key, async () => response, providerCompletionEndpoint(connection), async d => { reports.push(d); }, connection);
  await expect(port.stream(model, [], new AbortController().signal, async () => {})).rejects.toMatchObject({ code: 'request-rejected' });
  expect(reports[0]).toMatchObject({ httpStatus: 403 });
  expect(JSON.stringify(reports)).not.toMatch(/PRIVATE_|SYNTHETIC_/);
  expect(response.body!.locked).toBe(false);
});

test('429 retains only a bounded numeric Retry-After and never retries automatically', async () => {
  for (const retryAfter of ['60', '0', '86401', '999999999', '-1', `PRIVATE_${key}`]) {
    const reports: any[] = []; let calls = 0;
    const port = createProviderPort(key, async () => { calls++; return Response.json({ error: { code: 8, message: 'PRIVATE_QUOTA' } }, { status: 429, headers: { 'retry-after': retryAfter } }); }, providerCompletionEndpoint(connection), async d => { reports.push(d); }, connection);
    await expect(port.stream(model, [], new AbortController().signal, async () => {})).rejects.toMatchObject({ code: 'rate-limit' });
    expect(calls).toBe(1); expect(reports[0].httpStatus).toBe(429);
    expect(reports[0].retryAfterSeconds).toBe(retryAfter === '60' ? 60 : undefined);
    const message = taskFailureMessage({ error: 'rate-limit', diagnostics: reports } as any);
    expect(message).toContain('HTTP 429');
    if (retryAfter === '60') expect(message).toContain('60 秒');
    expect(JSON.stringify(reports)).not.toMatch(/PRIVATE_|SYNTHETIC_/);
  }
});
