import { expect, test } from '@playwright/test';
import { setup } from './interaction-fixture';

test('subtitle correction and translation expose their actual protocols and preserve original timing', async () => {
  const { context, page, worker, fixture } = await setup();
  try {
    await worker.evaluate(() => {
      const original = fetch;
      (globalThis as any).subtitleRequests = [];
      globalThis.fetch = (async (input: any, init: any) => {
        if (!String(input).startsWith('https://api.deepseek.com/')) return original(input, init);
        if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ object: 'list', data: [{ id: 'local-text' }] }), { headers: { 'content-type': 'application/json' } });
        const body = JSON.parse(init.body), translating = body.messages[0].content.includes('[P1:subtitle-translate]');
        (globalThis as any).subtitleRequests.push(body);
        const source = JSON.parse(body.messages[1].content);
        const content = JSON.stringify(translating ? { cues: source.cues.map((cue: any) => ({ ...cue, content: 'Translated text' })) } : { changes: [] });
        return new Response('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      }) as typeof fetch;
    });
    const command = (operation: any) => page.evaluate(operation => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation }), operation);
    expect((await command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key: 'SYNTHETIC_LOCAL_ONLY' })).ok).toBe(true);
    const fetched=await command({ type: 'provider.fetch', expectedRevision: 1 });
    expect(fetched.ok).toBe(true);
    expect((await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-text']})).ok).toBe(true);
    const binding = (await command({ type: 'workspace.query' })).view.video.binding;
    let latestJobId = '';
    for (const operation of ['enhance', 'translate']) {
      const target = { kind: 'subtitle', workspaceId: fixture.workspaceId, operation };
      const query = async () => (await command({ type: 'generation.query', target })).view.generation;
      const oldIds = new Set((await query()).jobs.map((job: any) => job.jobId));
      const sent = await command({ type: 'generation.subtitle.send', target, binding, sourceLanguage: 'zh-CN', targetLanguage: operation === 'translate' ? 'en' : null, modelId: 'local-text' });
      expect(sent.ok).toBe(true);
      const current = async () => (await query()).jobs.find((job: any) => !oldIds.has(job.jobId));
      await expect.poll(async () => (await current())?.state).toBe('completed');
      const job = await current(); latestJobId = job.jobId;
      const inspection = (await command({ type: 'instructions.query', jobId: job.jobId, workspaceId: fixture.workspaceId })).view.instructions;
      expect(inspection.calls).toHaveLength(1);
      const call = inspection.calls[0];
      expect(call.stage).toBe('subtitle-' + operation);
      expect(call.rules.map((rule: any) => rule.id)).toEqual(['product', 'priority', 'evidence', 'subtitle-' + operation]);
      expect(JSON.parse(call.body)).toEqual(await worker.evaluate(() => (globalThis as any).subtitleRequests.at(-1)));
      const rows = JSON.parse(JSON.parse(call.body).messages[1].content).cues;
      expect(rows[0]).toMatchObject({ index: 0, from: 1.234, to: 3.456, content: 'native zh-CN' });
      expect(inspection.request.role).toBeUndefined();
    }
    await page.getByRole('button', { name: '字幕', exact: true }).click();
    await page.getByRole('button', { name: '字幕设置', exact: true }).click();
    await page.getByText('字幕任务记录',{exact:true}).click();
    // UUID ordering can put the latest task on either side of an overlap.
    // Every task's inspection button must remain reachable with settings open.
    const buttons=page.locator('[data-subtitle-job-id]').getByRole('button',{name:'本次 AI 指令',exact:true});
    expect(await buttons.count()).toBeGreaterThanOrEqual(2);
    for(let index=0;index<await buttons.count();index++){
      await buttons.nth(index).click({timeout:5000});
      await expect(page.getByRole('dialog',{name:'本次 AI 指令'})).toBeVisible();
      await page.getByRole('button',{name:'关闭指令查看',exact:true}).click();
    }
    await page.locator(`[data-subtitle-job-id="${latestJobId}"]`).getByRole('button', { name: '本次 AI 指令', exact: true }).click();
    const inspector = page.getByRole('dialog', { name: '本次 AI 指令' });
    await expect(inspector.getByLabel('选择调用阶段')).toContainText('字幕翻译');
    await expect(inspector).toContainText('HTTP 200');
    expect(await worker.evaluate(() => (globalThis as any).subtitleRequests.length)).toBe(2);
  } finally { await context.close(); }
});
