import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { InstructionTraceStore, tracedTransport } from '../../src/generation/instruction-trace';
import { fixedPrompt } from '../../src/prompts/fixed-rules';
import { createProviderPort } from '../../src/generation/provider-port';
import { createWebEvidencePort } from '../../src/generation/web-evidence-port';
import { webOptions } from '../../src/contracts/web';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { createMessageRouter } from '../../src/app/message-router';
import {webTransport} from '../fixtures/web';

function fixture() {
  let data: Record<string, unknown> = {}, now = Date.now();
  const store = new InstructionTraceStore({ async get() { return structuredClone(data); }, async set(value) { data = structuredClone(value); } }, () => now);
  return { store, expire: () => { now += 25 * 60 * 60 * 1000; }, raw: () => data };
}
const identity = { traceId: 'trace', jobId: crypto.randomUUID(), attemptId: crypto.randomUUID() };

test('capture matches dispatched JSON, preserves dynamic rules and excludes authentication and image bytes', async () => {
  const { store, raw } = fixture(), secret = 'SYNTHETIC_SECRET', png = 'data:image/png;base64,AQID';
  const body = { model: 'model', stream: true, max_tokens: 1000, messages: [
    { role: 'system', content: fixedPrompt({ kind: 'vision-plan', duration: 83, maxFrames: 2, preauthorized: true }) },
    { role: 'user', content: [{ type: 'text', text: `资料 ${secret}` }, { type: 'image_url', image_url: { url: png } }] }
  ] };
  let received: unknown;
  const transport = tracedTransport(identity, secret, async (_input, init) => { received = JSON.parse(String(init?.body)); return new Response('{}', { status: 200 }); }, store);
  await transport('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
  expect(received).toEqual(body);
  const calls = await store.query(identity.jobId);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ stage: 'vision-plan', modelId: 'model', status: 'http-response', httpStatus: 200, redacted: true });
  expect(calls[0].rules.find(r => r.id === 'vision-plan')?.text).toContain('from<=anchor<=to<83');
  expect(calls[0].rules.find(r => r.id === 'vision-plan')?.text).toContain('最多2个新帧槽位');
  expect(calls[0].images[0]).toMatchObject({ bytes: 3, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  for (const privateText of [secret, png, 'Authorization', 'Bearer']) expect(JSON.stringify(raw())).not.toContain(privateText);
});

test('normal provider capture is exact and records transport failure without retrying', async () => {
  const { store } = fixture(), messages = [{ role: 'system' as const, content: fixedPrompt({ kind: 'subtitle-translate' }) }, { role: 'user' as const, content: '{"targetLanguage":"ja","cues":[]}' }];
  let dispatched: unknown, count = 0;
  const provider = createProviderPort('secret', tracedTransport(identity, 'secret', async (_input, init) => {
    count++; dispatched = JSON.parse(String(init?.body)); throw new Error('network');
  }, store));
  await expect(provider.stream('fixture', messages, new AbortController().signal, async () => {}, 'subtitle')).rejects.toMatchObject({ code: 'network' });
  const [call] = await store.query(identity.jobId);
  expect(count).toBe(1); expect(JSON.parse(call.body)).toEqual(dispatched);
  expect(call.status).toBe('network-error'); expect(call.stage).toBe('subtitle-translate');
});

test('direct search records its actual query plan and search parameters without headers', async () => {
  const { store } = fixture(); let dispatched: unknown;
  const web = createWebEvidencePort('secret', tracedTransport(identity, 'secret',webTransport(()=>new Response('{}',{status:503}),(_url,body)=>{dispatched=body;}),store));
  await expect(web.retrieve({ options: webOptions(), question: '主题' }, new AbortController().signal)).rejects.toMatchObject({ code: 'network' });
  const [plan,call] = await store.query(identity.jobId);
  expect(JSON.parse(call.body)).toEqual(dispatched); expect(call.stage).toBe('web-search');
  expect(plan.rules.map(r => r.id)).toEqual(['product', 'priority', 'evidence', 'web-query']);
  expect(JSON.parse(call.body)).toMatchObject({query:'视频概念',count:5,need_content:false});
  expect(call.httpStatus).toBe(503);expect(JSON.stringify(call)).not.toContain('Authorization');
});

test('session recording is bounded, associates planning with first attempt, and expires', async () => {
  const { store, expire } = fixture();
  const transport = tracedTransport({ traceId: 'planning' }, 'secret', async () => new Response('{}'), store);
  const init = { method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [{ role: 'system', content: fixedPrompt({ kind: 'requirements-plan' }) }] }) };
  await transport('https://api.deepseek.com/chat/completions', init);
  expect(await store.query(identity.jobId)).toHaveLength(0);
  await store.link('planning', identity.jobId, identity.attemptId);
  const [call] = await store.query(identity.jobId);
  await Promise.all(Array.from({ length: 65 }, () => store.add({ ...call, id: crypto.randomUUID(), body: 'x'.repeat(100000) })));
  const records = await store.query(identity.jobId);
  expect(records.length).toBeLessThan(60);
  expect(new TextEncoder().encode(JSON.stringify(records)).byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
  expire(); expect(await store.query(identity.jobId)).toEqual([]);
});

test('cache failures never prevent, mutate or duplicate a request', async () => {
  const store = new InstructionTraceStore({ async get() { throw new Error('quota'); }, async set() { throw new Error('quota'); } });
  let count = 0;
  const init = { method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: 'hello' }] }) };
  const transport = tracedTransport(identity, 'secret', async (_url, actual) => { count++; expect(actual).toBe(init); return new Response('result'); }, store);
  expect(await (await transport('https://api.deepseek.com/chat/completions', init)).text()).toBe('result');
  expect(count).toBe(1);
});

test('failed planning response is exact, attempt-scoped, bounded and expires with its session request',async()=>{
  const {store,expire}=fixture();
  const transport=tracedTransport(identity,'secret',async()=>new Response('{}'),store);
  const send=(kind:'vision-plan'|'vision-review')=>transport('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'fixture',messages:[{role:'system',content:fixedPrompt(kind==='vision-plan'?{kind,duration:10,maxFrames:2,preauthorized:true}:{kind})}]})});
  await send('vision-plan');await send('vision-plan');await send('vision-review');
  const output='{\n"need":"PRIVATE_PLAN_TEXT",\n';
  await store.failedPlan(identity.jobId,crypto.randomUUID(),'wrong attempt');
  await store.failedPlan(crypto.randomUUID(),identity.attemptId,'wrong job');
  expect((await store.query(identity.jobId)).every(row=>row.failedPlanResponse===undefined)).toBe(true);
  await store.failedPlan(identity.jobId,identity.attemptId,output);
  const calls=await store.query(identity.jobId);
  expect(calls.map(row=>row.failedPlanResponse)).toEqual([undefined,output,undefined]);
  await store.failedReview(identity.jobId,identity.attemptId,'PRIVATE_REJECTED_REVIEW');
  expect((await store.query(identity.jobId)).map(row=>row.failedReviewResponse)).toEqual([undefined,undefined,'PRIVATE_REJECTED_REVIEW']);
  await expect(store.failedPlan(identity.jobId,identity.attemptId,'x'.repeat(8001))).rejects.toThrow();
  expect((await store.query(identity.jobId))[1].failedPlanResponse).toBe(output);
  expire();expect(await store.query(identity.jobId)).toEqual([]);
});

test('instruction query is only available to the interactive extension surface', async () => {
  let queried = 0;
  const router = createMessageRouter(new IndexedWorkspaceStore(crypto.randomUUID()), 'extension', async () => null,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { async command() { queried++; return { calls: [], attempts: [], images: [], request: { input: '', modelId: 'fixture' }, note: '' }; } });
  const packet = { version: 1, requestId: crypto.randomUUID(), operation: { type: 'instructions.query', jobId: identity.jobId, workspaceId: 'w', chatId: 'c' } };
  for (const url of ['https://www.bilibili.com/video/test/', 'chrome-extension://extension/reader.html']) expect(await router.handle(packet, { id: 'extension', url, frameId: 0 })).toMatchObject({ ok: false, code: 'forbidden' });
  expect(queried).toBe(0);
  expect(await router.handle(packet, { id: 'extension', url: 'chrome-extension://extension/sidepanel.html', frameId: 0 })).toMatchObject({ ok: true });
  expect(queried).toBe(1);
});
