import {expect, test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

test('production HTML flow with/without template saves complete pages and refuses both truncation modes', async () => {
  test.setTimeout(60000);
  const fixture = await setup(undefined, {entryPoint: 'tests/installed/html-output-budget-seed.ts', name: 'html-output-budget'});
  const {context, page, id, forbidden} = fixture;
  try {
    const parameters = new URLSearchParams({workspaceId: fixture.fixture.workspaceId, chatId: fixture.fixture.chatId});
    await page.goto(`chrome-extension://${id}/html-output-budget.html?${parameters}`);
    await expect(page.locator('#status')).toContainText('realPaidModelCalls');
    const result = JSON.parse((await page.locator('#status').textContent())!);
    expect(result.newPages).toBe(3); expect(result.realPaidModelCalls).toBe(0);
    for (const row of result.results) {
      expect(row.calls).toBe(1); expect(row.maxTokens).toBe(393216); expect(row.completeSubtitles).toBe(true);
      expect(row.templateFrozen).toBe(row.name !== 'long-plain');
      if (['service-length', 'incomplete-stop'].includes(row.name)) {
        expect(row.state).toBe('failed'); expect(row.saved).toBe(false);
        expect(row.error).toBe(row.name === 'service-length' ? 'output-limit' : 'html-format');
        expect(row.diagnostic.htmlEnvelope).toBe('missing-end');
      } else {
        expect(row.state).toBe('completed'); expect(row.saved).toBe(true); expect(row.sourceExact).toBe(true);
        expect(row.coverage.covered).toBe(row.coverage.total);
      }
    }
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.getByRole('button', {name: '打开页面', exact: true}).last().click();
    const content = () => page.frameLocator('.html-page-frame').frameLocator('iframe');
    await expect(content().getByRole('heading', {name: '有限预算学习页'})).toBeVisible();
    await expect(content().locator('#explanation')).toBeHidden();
    await content().getByRole('button', {name: '展开解释'}).click();
    await expect(content().locator('#explanation')).toBeVisible();
    await page.getByRole('button', {name: '初始化', exact: true}).click();
    await expect(content().locator('#explanation')).toBeHidden();
    await page.reload(); await page.getByRole('button', {name: '打开页面', exact: true}).last().click();
    await expect(content().getByRole('heading', {name: '有限预算学习页'})).toBeVisible();
    expect(forbidden).toEqual([]);
    await page.screenshot({path: test.info().outputPath('html-flow.png')});
    await writeFile(test.info().outputPath('audit.json'), JSON.stringify({...result, interaction: true, reset: true,
      reload: true, forbiddenRequests: forbidden, fixtureType: 'synthetic SSE through real provider/store/viewer'}, null, 2));
  } finally {await context.close();}
});

for (const withTemplate of [false, true]) test(`actual send action template=${withTemplate} reaches the executor and opens the saved HTML`, async () => {
  test.setTimeout(60000);
  const {context, page, site, worker, forbidden} = await setup();
  try {
    await worker.evaluate(() => {
      const original = fetch; (globalThis as any).htmlRequests = [];
      globalThis.fetch = (async (input: any, init: any) => {
        if (!String(input).startsWith('https://api.deepseek.com/')) return original(input, init);
        if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({object: 'list', data: [{id: 'local-fixture', input_modalities: ['text']}]}), {headers: {'content-type': 'application/json'}});
        const request = JSON.parse(init.body), system = String(request.messages[0].content);
        const planning = system.includes('[P1:requirements-plan]');
        let content = JSON.stringify({version: 1, interpretedIntent: '生成交互学习页', additionalSources: [], outputRequirements: []});
        if (!planning) {
          (globalThis as any).htmlRequests.push({maxTokens: request.max_tokens,
            hasTemplate: JSON.stringify(request.messages).includes('P2 当前任务模板'),
            hasSubtitle: JSON.stringify(request.messages).includes('native zh-CN'),
            hasBudgetRule: system.includes('[P1:output-scope]')});
          content = '<!doctype html><html lang="zh"><head><title>发送入口学习页</title></head><body><h1>发送入口学习页</h1><button onclick="this.textContent=\'已展开\'">展开解释</button>' + '<p>本地合成页面依据。</p>'.repeat(1000) + '</body></html>';
        }
        const enough = planning || request.max_tokens >= 9000;
        const events = (enough ? content : content.slice(0, 19000)).match(/[\s\S]{1,4000}/g)!.map(content => 'data: ' + JSON.stringify({choices: [{index: 0, delta: {content}, finish_reason: null}]}) + '\n\n').join('');
        return new Response(events + 'data: ' + JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: enough ? 'stop' : 'length'}], usage: {completion_tokens: planning ? 40 : enough ? 9000 : request.max_tokens}}) + '\n\ndata: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
      }) as typeof fetch;
    });
    const command = (operation: any) => page.evaluate(operation => chrome.runtime.sendMessage({version: 1, requestId: crypto.randomUUID(), operation}), operation);
    expect((await command({type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key: 'SYNTHETIC_LOCAL_ONLY'})).ok).toBe(true);
    let fetched = await command({type: 'provider.fetch', expectedRevision: 1});
    fetched = await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-fixture']});
    expect((await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-fixture']})).ok).toBe(true);
    const initial = (await command({type: 'workspace.query'})).view;
    const subtitles = (await command({type: 'subtitles.query', workspaceId: initial.workspaceId})).view.subtitles;
    expect((await command({type: 'subtitles.source.select', workspaceId: initial.workspaceId,
      expectedRevision: subtitles.sourceRevision, source: {kind: 'native', language: 'zh-CN'}})).ok).toBe(true);
    await page.reload(); await site.bringToFront();
    await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    const states = [];
      await page.getByRole('button', {name: '切换当前内容'}).click();
      await page.getByRole('menuitem', {name: '新对话', exact: true}).click();
      await expect(page.locator('.context-module')).toHaveText('对话 02');
      if (withTemplate) {
        await page.getByLabel('输入草稿').fill('@交互学习页');
        await page.locator('#mention-menu').getByRole('button', {name: '交互学习页', exact: true}).click();
        await expect(page.getByRole('button', {name: '移除任务模板 交互学习页', exact: true})).toBeVisible();
      } else {
        await page.getByRole('button', {name: /产物类型/}).click();
        await page.getByRole('menuitemradio', {name: /HTML/}).click();
      }
      await page.getByLabel('输入草稿').fill('生成完整交互学习页');
      const workspace = (await command({type: 'workspace.query'})).view;
      await page.getByRole('button', {name: '发送', exact: true}).click();
      const query = async () => (await command({type: 'generation.query', target: {kind: 'chat', workspaceId: workspace.workspaceId, chatId: workspace.chatId}})).view.generation.jobs.at(-1);
      await expect.poll(async () => (await query())?.state).toBe('completed');
      const result = await query();
      expect(result.diagnostics.at(-1)).toMatchObject({purpose: 'html-page', cause: 'stop', maxTokens: 393216, htmlEnvelope: 'complete', usage: {outputTokens: 9000}});
      states.push({withTemplate, state: result.state, diagnostic: result.diagnostics.at(-1)});
      await page.getByRole('button', {name: '打开页面', exact: true}).click();
      const content = page.frameLocator('.html-page-frame').frameLocator('iframe');
      await expect(content.getByRole('heading', {name: '发送入口学习页'})).toBeVisible();
      await content.getByRole('button', {name: '展开解释'}).click();
      await expect(content.getByRole('button', {name: '已展开'})).toBeVisible();
    const requests = await worker.evaluate(() => (globalThis as any).htmlRequests);
    expect(requests).toEqual([{maxTokens: 393216, hasTemplate: withTemplate, hasSubtitle: true, hasBudgetRule: true}]);
    expect(forbidden).toEqual([]);
    await writeFile(test.info().outputPath('send-audit.json'), JSON.stringify({states, requests, realPaidModelCalls: 0, forbiddenRequests: forbidden}, null, 2));
  } finally {await context.close();}
});
