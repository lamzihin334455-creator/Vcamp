import {startNewChat} from './workbench-actions';
import { expect, test } from '@playwright/test';
import { installedPanel } from './fix-support';
import { setup } from './interaction-fixture';

for (const mode of ['test-extension', 'production'] as const) test(`${mode}: Bailian and SenseNova catalogue-to-answer routing, safe rejection and retry`, async () => {
  const f = mode === 'production' ? await setup() : await installedPanel(), { page, worker, context } = f;
  const command = (operation: any) => page.evaluate(operation => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: undefined, operation }), operation);
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    if (mode === 'production') {
      const old = (await command({ type: 'workspace.query' })).view.chatId;
      await startNewChat(page);
      await expect.poll(async () => (await command({ type: 'workspace.query' })).view.chatId).not.toBe(old);
      await page.reload(); await expect(page.getByTestId('startup')).toHaveCount(0);
    }
    await worker.evaluate(() => {
      const state = globalThis as any; state.providerCalls = []; state.rejectAnswer = true;
      chrome.permissions.contains = async () => true;
      state.fetch = async (url: string, init: RequestInit = {}) => {
        const address = String(url), body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        if (address.startsWith('https://api.bilibili.com/x/web-interface/view')) return Response.json({ code: 0, data: { aid: 1, desc: '合成视频简介' } });
        if (address.startsWith('https://api.bilibili.com/x/player/')) return Response.json({ code: 0, data: {} });
        const bailian = address.startsWith('https://dashscope.aliyuncs.com/compatible-mode/v1/');
        const sensenova = address.startsWith('https://token.sensenova.cn/v1/');
        if (!bailian && !sensenova) throw Error('Unexpected provider route');
        state.providerCalls.push({ url: address, method: init.method ?? 'GET', auth: new Headers(init.headers).get('authorization'), body });
        const model = bailian ? 'deepseek-v4.1-flash-1017' : 'sensenova-6.8-flash-lite';
        if (address.endsWith('/models')) return Response.json({ data: [{ id: model }] });
        if (!address.endsWith('/chat/completions')) throw Error('Unexpected provider path');
        if (body.model !== model) throw Error('Wrong model for saved provider');
        if (state.rejectAnswer && body.max_tokens !== 768) return Response.json({ error: { code: bailian ? 'Arrearage' : 'invalid_api_key', message: 'PRIVATE_SERVICE_MESSAGE' } }, { status: bailian ? 403 : 401 });
        const text = body.max_tokens === 768 ? JSON.stringify({ version: 1, interpretedIntent: '合成测试', additionalSources: [], outputRequirements: [] }) : `${bailian ? '百炼' : '商汤'}合成回答完成。`;
        const index = bailian ? { index: 0 } : {};
        return new Response(`data: ${JSON.stringify({ choices: [{ ...index, delta: { content: text }, finish_reason: bailian ? null : '' }] })}\n\ndata: ${JSON.stringify({ choices: [{ ...index, delta: {}, finish_reason: 'stop' }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 38, completion_tokens: 441, total_tokens: 479 } })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      };
    });
    for (const provider of [
      { id: 'bailian', key: 'SYNTHETIC_BAILIAN_KEY', model: 'deepseek-v4.1-flash-1017', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', status: 403, code: 'Arrearage', hint: '计费', answer: '百炼合成回答完成。' },
      { id: 'sensenova', key: 'SYNTHETIC_SENSENOVA_KEY', model: 'sensenova-6.8-flash-lite', base: 'https://token.sensenova.cn/v1', status: 401, code: 'invalid_api_key', hint: 'HTTP 401', answer: '商汤合成回答完成。' }
    ]) {
      await worker.evaluate(() => { (globalThis as any).rejectAnswer = true; });
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('button', { name: 'API 设置', exact: true }).click();
      if (provider.id === 'sensenova') await page.getByRole('button', { name: '新增连接', exact: true }).click();
      await page.getByLabel('服务商', { exact: true }).selectOption(provider.id);
      await expect(page.getByLabel('服务地址（Base URL）', { exact: true })).toHaveValue(provider.base);
      await page.getByLabel('API Key', { exact: true }).fill(provider.key);
      await page.getByRole('button', { name: '保存连接', exact: true }).click();
      await expect(page.getByTestId('key-state')).toHaveText('Key 已保存在本机');
      await page.getByRole('button', { name: '拉取模型 / 重试', exact: true }).click();
      const intake = page.getByLabel('模型录入', { exact: true });
      await expect(intake.getByRole('checkbox')).toHaveCount(1);
      await intake.getByRole('checkbox').check();
      await intake.getByRole('button', { name: '录入所选模型', exact: true }).click();
      await expect(page.getByLabel('当前应用模型', { exact: true })).toHaveAttribute('data-value', new RegExp(`:${provider.model}$`));
      await page.getByRole('button', { name: /^返回/ }).click();
      await expect.poll(async () => (await command({ type: 'workspace.query' })).view.draft.modelId).toBe(provider.model);
      if ('site' in f) await f.site.bringToFront();
      await page.getByLabel('输入草稿', { exact: true }).fill('PRIVATE_USER_QUESTION');
      await page.getByLabel('输入草稿', { exact: true }).press('Enter');
      const task = page.locator('.message-task').filter({ has: page.getByRole('alert') }).last();
      await expect(task.getByRole('alert')).toContainText(provider.hint);
      const jobId = await task.getAttribute('data-job-id');
      await page.reload(); await expect(page.getByTestId('startup')).toHaveCount(0);
      const saved = page.locator(`[data-job-id="${jobId}"]`);
      await expect(saved.getByRole('alert')).toContainText(provider.hint);
      await saved.getByText('失败详情 / 重试', { exact: true }).click();
      await saved.getByText('失败详情（用于反馈）', { exact: true }).click();
      const feedback = await saved.getByLabel('完整诊断文本', { exact: true }).inputValue();
      expect(JSON.parse(feedback).diagnostics).toContainEqual(expect.objectContaining({ purpose: 'answer', providerId: provider.id, providerEndpoint: 'preset', modelId: provider.model, httpStatus: provider.status, serviceErrorCode: provider.code }));
      expect(feedback).not.toMatch(/SYNTHETIC_|PRIVATE_|Bearer|https:/);
      await page.bringToFront(); await page.screenshot({ path: test.info().outputPath(`${provider.id}-rejection-360.png`) });
      await worker.evaluate(() => { (globalThis as any).rejectAnswer = false; });
      if ('site' in f) await f.site.bringToFront();
      await saved.getByRole('button', { name: '重试原请求', exact: true }).click();
      await expect(page.getByText(provider.answer, { exact: true })).toBeVisible();
      await page.bringToFront(); await page.screenshot({ path: test.info().outputPath(`${provider.id}-answer-360.png`) });
      const calls = (await worker.evaluate(() => (globalThis as any).providerCalls)).filter((call: any) => call.url.startsWith(provider.base));
      expect(calls.filter((call: any) => call.url.endsWith('/models'))).toHaveLength(1);
      expect(calls.filter((call: any) => call.url.endsWith('/chat/completions'))).toHaveLength(provider.id === 'sensenova' ? 2 : 3);
      for (const call of calls) {
        expect(call.auth).toBe(`Bearer ${provider.key}`);
        if (call.body) { expect(call.body.model).toBe(provider.model); expect(call.body.thinking).toBeUndefined(); expect(call.body.stream_options).toBeUndefined(); }
      }
    }
  } finally { await context.close(); }
});
