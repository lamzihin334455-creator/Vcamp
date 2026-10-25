// Disposable-profile fixture only. Production provider, prompt assembly and
// storage; synthetic SSE replaces the paid model and makes truncation repeatable.
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedKnowledgeStore} from '../../src/data/knowledge-store';
import {createProviderPort, ProviderError} from '../../src/generation/provider-port';
import {runChat} from '../../src/generation/run-chat';
import {ApplicationError} from '../../src/contracts/application';
import type {ChatRequestSnapshot, GenerationFailure} from '../../src/contracts/generation';
import {presetTemplates} from '../../src/workbench/template-presets';

async function seed() {
  const params = new URL(location.href).searchParams;
  const spaces = new IndexedWorkspaceStore(), tasks = new IndexedGenerationStore(), pages = new IndexedKnowledgeStore();
  const space = await spaces.createChat(params.get('workspaceId')!);
  const subtitles = await tasks.subtitleStore.query(space.id);
  await tasks.subtitleStore.select(space.id, subtitles.sourceRevision, {kind: 'native', language: 'zh-CN'});
  const template = presetTemplates.find(t => t.id === 'builtin-map')!;
  const initialCount = (await pages.list(space.id, undefined, true)).length;
  const html = '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>有限预算学习页</title><style>body{font:17px/1.6 system-ui;margin:16px}button{font:inherit;padding:10px}article{margin:12px 0}button:focus-visible{outline:3px solid #865e39}</style>' +
    '</head><body><h1>有限预算学习页</h1><button id="expand">展开解释</button><p id="explanation" hidden>完整页面已保存。</p>' +
    '<article>本地合成主题说明与视频依据。</article>'.repeat(850) +
    '<script>document.querySelector("#expand").onclick=()=>document.querySelector("#explanation").hidden=false;</script></body></html>';
  const cases = [
    {name: 'five-minute-template', duration: 300, template: true},
    {name: 'long-template', duration: 1006.866625, template: true},
    {name: 'long-plain', duration: 1006.866625, template: false},
    {name: 'service-length', duration: 300, template: true},
    {name: 'incomplete-stop', duration: 300, template: true}
  ];
  const results = [];
  for (const item of cases) {
    const current = (await spaces.read(space.id, space.chatId))!;
    await spaces.save(space.id, current.draft.revision, {...current.draft, text: item.name + '：生成完整交互学习页',
      outputType: 'html', modelId: 'local-fixture', webEnabled: false, attachmentIds: [],
      template: item.template ? {templateId: template.id, revisionId: template.revisionId} : null}, space.chatId);
    const job = await tasks.freezeChat({kind: 'chat', workspaceId: space.id, chatId: space.chatId}, current.draft.revision + 1,
      {binding: {...space.source, tabId: 99, documentId: 'fixture', epoch: 1}, locator: 'local', fingerprint: 'local',
        language: 'zh-CN', cueCount: 2, mediaDuration: item.duration});
    const attempt = job.attempts[0].attemptId;
    await tasks.attach(job.jobId, attempt, 99); await tasks.claim(job.jobId, attempt, 99);
    let calls = 0, request: any, error: GenerationFailure | null = null;
    const provider = createProviderPort('LOCAL_SYNTHETIC_TOKEN', async (_url, init) => {
      calls++; request = JSON.parse(String(init!.body));
      const enough = request.max_tokens >= (item.template ? 9000 : 2000);
      const truncated = !enough || item.name === 'service-length';
      const output = truncated || item.name === 'incomplete-stop' ? '```html\n' + html.slice(0, 19000) : html;
      const chunks = output.match(/[\s\S]{1,4000}/g)!;
      const body = chunks.map(content => 'data: ' + JSON.stringify({choices: [{index: 0, delta: {content}, finish_reason: null}]}) + '\n\n').join('') +
        'data: ' + JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: truncated ? 'length' : 'stop'}],
          usage: {prompt_tokens: 23006, completion_tokens: truncated ? request.max_tokens : item.template ? 9000 : 2000}}) + '\n\ndata: [DONE]\n\n';
      return new Response(body, {headers: {'content-type': 'text/event-stream'}});
    }, undefined, async diagnostic => {await tasks.diagnostic(job.jobId, attempt, diagnostic);});
    const pageId = crypto.randomUUID();
    try {
      await runChat(job.snapshot as ChatRequestSnapshot, [{from: 0, to: 5, content: '片头完整依据'},
        {from: item.duration - 5, to: item.duration, content: '片尾完整依据'}], provider, new AbortController().signal,
        async (text, coverage) => {const row = (await tasks.get(job.jobId))!; await tasks.checkpoint(job.jobId, attempt, row.seq + 1, text, coverage);});
      await tasks.finish(job.jobId, attempt, 'completed', null, pageId);
    } catch (e) {
      if (!(e instanceof ProviderError || e instanceof ApplicationError)) throw e;
      error = e.code as GenerationFailure; await tasks.finish(job.jobId, attempt, 'failed', error);
    }
    const saved = (await pages.list(space.id, pageId, true)).find(p => p.id === pageId);
    const last = (await tasks.get(job.jobId))!.attempts.at(-1)!;
    const material = JSON.stringify(request.messages);
    results.push({name: item.name, calls, maxTokens: request.max_tokens, state: last.state, error,
      templateFrozen: !!(job.snapshot as ChatRequestSnapshot).templateSnapshot,
      completeSubtitles: material.includes('片头完整依据') && material.includes('片尾完整依据'),
      sourceExact: saved?.type === 'html-page' && saved.source === html, saved: !!saved,
      diagnostic: last.diagnostics?.at(-1), coverage: last.coverage});
  }
  document.querySelector('#status')!.textContent = JSON.stringify({results,
    newPages: (await pages.list(space.id, undefined, true)).length - initialCount, realPaidModelCalls: 0});
}
void seed().catch(e => {document.querySelector('#status')!.textContent = 'fixture failed: ' + String(e);});
