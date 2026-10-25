import { expect, test } from 'vitest';
import { createProviderPort } from '../../src/generation/provider-port';

// Shape shown by the official SenseNova streaming documentation: a single
// choice without index, empty intermediate finish_reason, reasoning and usage.
const key = 'SYNTHETIC_SENSENOVA_KEY';
const events = [
  { choices: [{ delta: { reasoning: 'PRIVATE_REASONING' }, finish_reason: '' }] },
  { choices: [{ delta: { content: '商汤文本' }, finish_reason: '' }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
  { choices: [], usage: { prompt_tokens: 38, completion_tokens: 441, total_tokens: 479 } }
];
const response = (chunks: unknown[], done = true) => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } });
const stream = (chunks: unknown[], native = false, done = true) => {
  let text = ''; const diagnostics: any[] = [];
  const port = createProviderPort(key, async () => response(chunks, done), undefined, async value => { diagnostics.push(value); }, { providerId: native ? 'deepseek' : 'sensenova' });
  return port.stream('fixture-text', [], new AbortController().signal, async part => { text += part; }).then(() => ({ text, diagnostics }));
};

test('single-choice third-party stream accepts omitted index and keeps only text plus safe usage', async () => {
  const result = await stream(events);
  expect(result.text).toBe('商汤文本');
  expect(result.diagnostics[0]).toMatchObject({ cause: 'stop', usage: { inputTokens: 38, outputTokens: 441, totalTokens: 479 } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_REASONING');
});

test('compatibility still rejects multiple choices, nonzero index and missing completion markers; native parsing stays strict', async () => {
  for (const chunks of [
    [{ choices: [{ delta: { content: 'a' }, finish_reason: 'stop' }, { delta: { content: 'b' }, finish_reason: 'stop' }] }],
    [{ choices: [{ index: 1, delta: { content: 'a' }, finish_reason: 'stop' }] }],
    events.slice(0, 2)
  ]) await expect(stream(chunks)).rejects.toMatchObject({ code: 'protocol' });
  await expect(stream(events, false, false)).rejects.toMatchObject({ code: 'protocol' });
  await expect(stream(events, true)).rejects.toMatchObject({ code: 'protocol' });
});
