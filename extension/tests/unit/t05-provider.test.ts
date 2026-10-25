import { expect, test } from 'vitest';
import { createProviderPort } from '../../src/generation/provider-port';
import { runChat } from '../../src/generation/run-chat';
import { segmentSubtitles, subtitleBasis } from '../../src/generation/subtitle-context';
import type { ChatRequestSnapshot, Coverage } from '../../src/contracts/generation';

const sse = (text: string, reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: reason }] })}\r\n\r\n`;
function response(parts: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { for (const part of parts) { const bytes = encoder.encode(part); controller.enqueue(bytes.slice(0, 3)); controller.enqueue(bytes.slice(3)); } controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const snapshot: ChatRequestSnapshot = { snapshotId: 'original', target: { kind: 'chat', workspaceId: 'A', chatId: 'a' }, input: '当前问题一次', outputType: 'chat', modelId: 'model-a', webEnabled: false, templateRevisionId: null, historyProjection: [{ messageId: 'old', contentVersionId: 'v1', role: 'assistant', text: '以前已保存的回答', referenceSnapshotIds: [], attachmentIds: [] }], referenceSnapshotIds: [], attachmentIds: [] };
test('B: complete UTF-8/SSE boundaries, original history and every subtitle cue reach the actual POST', async () => {
  let body: { model: string; messages: { role: string; content: string }[] } | undefined;
  const transport: typeof fetch = async (_, init) => { body = JSON.parse(init!.body as string); expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer synthetic'); return response([sse('真实'), sse('流内容', 'stop'), 'data: [DONE]\r\n\r\n']); };
  const outputs: string[] = [];
  await runChat(snapshot, [{ from: 0, to: 1, content: '字幕开头' }, { from: 2, to: 3, content: '字幕结尾' }], createProviderPort('synthetic', transport), new AbortController().signal, async text => { outputs.push(text); });
  expect(body!.model).toBe('model-a');
  expect(body!.messages).toEqual([{ role: 'system', content: expect.stringContaining('P0') }, { role: 'user', content: expect.stringContaining('字幕开头') }, { role: 'assistant', content: '以前已保存的回答' }, { role: 'user', content: '当前问题一次' }]);
  expect(body!.messages[1].content).toContain('字幕结尾');
  expect(body!.messages[0].content).not.toMatch(/字幕开头|字幕结尾/);
  expect(outputs.at(-1)).toBe('真实流内容');
});
test('B: a disconnected stream keeps the visible partial text and is never completed; stop/limit/credential echoes are fixed errors', async () => {
  const visible: string[] = [];
  await expect(createProviderPort('synthetic', async () => response([sse('部分')])).stream('model-a', [{ role: 'user', content: '问题' }], new AbortController().signal, async text => { visible.push(text); })).rejects.toMatchObject({ code: 'protocol' });
  expect(visible).toEqual(['部分']);
  await expect(createProviderPort('synthetic', async () => response([sse('synt'), sse('hetic', 'stop'), 'data: [DONE]\n\n'])).stream('model-a', [], new AbortController().signal, async text => { visible.push(text); })).rejects.toMatchObject({ code: 'protocol' });
  expect(visible).toEqual(['部分']);
  await expect(createProviderPort('synthetic', async () => response([sse('过长', 'length'), 'data: [DONE]\n\n'])).stream('model-a', [], new AbortController().signal, async () => {})).rejects.toMatchObject({ code: 'output-limit' });
  const abort = new AbortController(); abort.abort();
  await expect(createProviderPort('synthetic', async () => response([sse('回答', 'stop'), 'data: [DONE]\n\n'])).stream('model-a', [], abort.signal, async () => {})).rejects.toMatchObject({ code: 'timeout' });
});
test('B: long subtitles reach one final request in full and a failed request never claims coverage', async () => {
  const cues = Array.from({ length: 4 }, (_, i) => ({ from: i, to: i + 1, content: `段${i}` + '字'.repeat(7000) }));
  const calls: string[] = [], checkpoints: Coverage[] = [];
  await runChat(snapshot, cues, { stream: async (_, messages, __, delta) => { expect(messages[1].role).toBe('user'); calls.push(messages[1].content as string); await delta('完整回答'); } }, new AbortController().signal, async (_, coverage) => { checkpoints.push(structuredClone(coverage)); });
  expect(calls).toHaveLength(1);
  for (let index = 0; index < 4; index++) expect(calls[0]).toContain(`段${index}`);
  expect(checkpoints.at(-1)).toEqual({ total: 4, covered: 4, ranges: [{ firstCue: 0, lastCue: 0 }, { firstCue: 1, lastCue: 1 }, { firstCue: 2, lastCue: 2 }, { firstCue: 3, lastCue: 3 }] });
  let failedCalls = 0, covered = 0;
  await expect(runChat(snapshot, cues, { stream: async () => { failedCalls++; throw new Error('request failed'); } }, new AbortController().signal, async (_, coverage) => { covered = coverage.covered; })).rejects.toThrow('request failed');
  expect(failedCalls).toBe(1); expect(covered).toBe(0);
  expect(() => segmentSubtitles([{ from: 0, to: 1, content: '字'.repeat(12000) }])).toThrow('context-limit');
  expect(await subtitleBasis({ platform: 'bilibili', videoId: 'BV', partId: '1', tabId: 1, documentId: 'doc', epoch: 1 }, 'zh', cues)).toMatchObject({ cueCount: 4, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
});
