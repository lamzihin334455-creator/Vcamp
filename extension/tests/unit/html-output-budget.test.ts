import {expect, test} from 'vitest';
import {runChat} from '../../src/generation/run-chat';
import {createProviderPort} from '../../src/generation/provider-port';
import {htmlEnvelope, parseHtmlPage} from '../../src/contracts/html-page';
import {presetTemplates} from '../../src/workbench/template-presets';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import type {GenerationDiagnostic} from '../../src/contracts/generation-diagnostic';
import {purposePolicy} from '../../src/generation/purpose-policy';
import {allocateVisualPlan} from '../../src/generation/visual-selection';

const template = presetTemplates.find(t => t.id === 'builtin-map')!;
const {id, builtin: _builtin, ...revision} = template;
const page = '<!doctype html><html lang="zh"><head><title>学习页</title></head><body>' +
  '<article>主题说明与视频依据</article>'.repeat(700) +
  '<button onclick="this.textContent=\'已展开\'">展开解释</button></body></html>';
const event = (content: string, finish_reason: string, tokens: number) => 'data: ' + JSON.stringify({
  choices: [{index: 0, delta: {content}, finish_reason}],
  usage: {prompt_tokens: 23006, completion_tokens: tokens, total_tokens: 23006 + tokens}
}) + '\n\ndata: [DONE]\n\n';
const snapshot = (duration: number, withTemplate: boolean): ChatRequestSnapshot => ({
  snapshotId: 'fixture', target: {kind: 'chat', workspaceId: 'w', chatId: 'c'},
  input: '用可交互页面解释视频内容', outputType: 'html', htmlFormat: 1, modelId: 'deepseek-flash',
  webEnabled: false, mediaDuration: duration, templateRevisionId: withTemplate ? template.revisionId : null,
  ...(withTemplate ? {templateSnapshot: {templateId: id, ...revision}} : {}),
  historyProjection: [], referenceSnapshotIds: [], attachmentIds: []
});

// Controlled service boundary: this is not a replay of the unavailable model
// body. A complete 9000-token fixture fits the HTML character bound, yet an
// 8192-token client cap cuts it off. Duration must not decide output capacity.
test.each([[300, true], [1006.866625, true], [1006.866625, false]] as const)(
  'HTML finishes once with complete subtitles, duration=%s template=%s', async (duration, withTemplate) => {
    const diagnostics: GenerationDiagnostic[] = [];
    let calls = 0, output = '', request: any;
    const port = createProviderPort('LOCAL_FIXTURE_TOKEN', async (_url, init) => {
      calls++; request = JSON.parse(String(init!.body));
      const requiredTokens = withTemplate ? 9000 : 2000;
      const enough = request.max_tokens >= requiredTokens;
      return new Response(event(enough ? page : '```html\n' + page.slice(0, 19000), enough ? 'stop' : 'length',
        enough ? requiredTokens : request.max_tokens), {headers: {'content-type': 'text/event-stream'}});
    }, undefined, async diagnostic => {diagnostics.push(diagnostic);});
    await runChat(snapshot(duration, withTemplate), [
      {from: 0, to: 5, content: '片头完整依据'}, {from: duration - 5, to: duration, content: '片尾完整依据'}
    ], port, new AbortController().signal, async text => {output = text;});
    expect(parseHtmlPage(output).source).toBe(page);
    expect(calls).toBe(1);
    expect(diagnostics).toMatchObject([{purpose: 'html-page', cause: 'stop', htmlEnvelope: 'complete'}]);
    const material = JSON.stringify(request.messages);
    expect(material).toContain('片头完整依据'); expect(material).toContain('片尾完整依据');
    expect(material.includes('P2 当前任务模板')).toBe(withTemplate);
    expect(request.messages[0].content).not.toContain(`${request.max_tokens} token`);
    expect(request.messages[0].content).toContain('完成任务即可结束');
  }
);

test('a cut-off HTML fence is diagnosed as incomplete, while storage parsing still rejects it', () => {
  const cutOff = '```html\n' + page.slice(0, 19000);
  expect(htmlEnvelope(cutOff)).toBe('missing-end');
  expect(() => parseHtmlPage(cutOff)).toThrow('html-format');
});

test('HTML visual preparation reserves the same final output budget as the actual POST', () => {
  const audit = allocateVisualPlan({version: 2, scope: 'focused', needsNewFrames: false, evidence: [], unresolved: []},
    snapshot(300, true), [], '字幕规划资料', '完整字幕正文');
  expect(audit.budget.finalOutputReserved).toBe(purposePolicy['html-page'].maxTokens);
  expect(audit.budget.apiTokensUpperBound).toBeGreaterThan(purposePolicy['html-page'].maxTokens);
  expect(purposePolicy.answer.maxTokens).toBe(393216);
  expect(purposePolicy.knowledge.maxTokens).toBe(8192);
});
