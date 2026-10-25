import { expect, test } from 'vitest';
import { createEvidencePreparation } from '../../src/generation/evidence-preparation';
import { createProviderPort, providerCompletionEndpoint } from '../../src/generation/provider-port';

const key = 'SYNTHETIC_SENSENOVA_KEY';
const source = { platform: 'bilibili' as const, videoId: 'BVtest', partId: '1', title: '合成视频' };
const context = { request: '你好', outputType: 'chat' as const, modelId: 'deepseek-flash', hasConversationHistory: true, hasFullSubtitles: true };
const sse = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const plan = JSON.stringify({ version: 1, interpretedIntent: '问候', additionalSources: [], outputRequirements: [] });
function fixture(providerId: 'sensenova' | 'bailian' | 'deepseek' | 'custom', baseUrl?: string) {
  const connection = { providerId, ...(baseUrl ? { baseUrl } : {}) }, calls: any[] = [];
  const transport: typeof fetch = async (url, init) => {
    const address = String(url);
    if (address.includes('/x/web-interface/view')) return Response.json({ code: 0, data: { aid: 1, desc: '视频简介' } });
    if (address.includes('/x/player/v2')) return Response.json({ code: 0, data: { view_points: [] } });
    if (address.includes('/x/v2/reply?')) return Response.json({ code: 0, data: { replies: [{ like: 7, content: { message: '观众评论' } }] } });
    const body = JSON.parse(String(init?.body)); calls.push({ address, body });
    // Controlled quota: one accepted model request in this window. The old
    // planning call consumes it, so the actual answer is then rejected.
    if (calls.length > 1) return Response.json({ error: { code: 8, message: 'PRIVATE_QUOTA_EXHAUSTED' } }, { status: 429 });
    return sse(body.max_tokens === 768 ? plan : '你好，合成回答完成。');
  };
  const preparation = createEvidencePreparation({ read: async () => ({ ...connection, key }), write: async () => {} }, transport);
  return { connection, calls, transport, preparation };
}

test('SenseNova completes one normal answer without first spending a second model call on source planning', async () => {
  for (const [id, base] of [['sensenova', undefined], ['custom', 'https://token.sensenova.cn/v1']] as const) {
    const f = fixture(id, base);
    const evidence = await f.preparation.prepare({ source, context, providerConnection: f.connection });
    let output = '';
    await createProviderPort(key, f.transport, providerCompletionEndpoint(f.connection), undefined, f.connection).stream(context.modelId, [{ role: 'user', content: context.request }], new AbortController().signal, async text => { output += text; });
    expect(output).toBe('你好，合成回答完成。');
    expect(f.calls).toHaveLength(1); expect(f.calls[0].body.max_tokens).toBeUndefined();
    expect(evidence).toMatchObject({ planningMode: 'local', includedSources: expect.arrayContaining(['full_subtitles', 'conversation_history']) });
  }
});

test('local preparation preserves template-required and explicitly selected sources without granting web or vision', async () => {
  const f = fixture('sensenova');
  const evidence = await f.preparation.prepare({ source, providerConnection: f.connection, context: { ...context, requiredSources: ['hot_comments', 'web'], explicitSources: ['video_description', 'video_frames'], canUseWeb: false, canUseVideoFrames: false } });
  expect(f.calls).toEqual([]);
  expect(evidence).toMatchObject({ planningMode: 'local', includedSources: expect.arrayContaining(['hot_comments', 'video_description', 'full_subtitles', 'conversation_history']), unavailableSources: ['web', 'video_frames'], hotComments: [{ content: '观众评论', likes: 7 }] });
});

test('the already working Bailian and native DeepSeek planning paths are retained', async () => {
  for (const id of ['bailian', 'deepseek'] as const) {
    const f = fixture(id);
    const evidence = await f.preparation.prepare({ source, context, providerConnection: f.connection });
    expect(f.calls).toHaveLength(1); expect(f.calls[0].body.max_tokens).toBe(768);
    expect(evidence.planningMode).toBe('planned');
  }
});
