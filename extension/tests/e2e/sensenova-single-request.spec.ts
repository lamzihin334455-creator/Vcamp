import {startNewChat} from './workbench-actions';
import { expect, test } from '@playwright/test';
import { setup } from './interaction-fixture';

test('production: SenseNova answers with one model call, persists real quota refusal and retries only on user action', async () => {
  const { page, worker, context, site } = await setup();
  const command = (operation: any) => page.evaluate(operation => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation }), operation);
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    const old = (await command({ type: 'workspace.query' })).view.chatId;
    await startNewChat(page);
    await expect.poll(async () => (await command({ type: 'workspace.query' })).view.chatId).not.toBe(old);
    await page.reload(); await expect(page.getByTestId('startup')).toHaveCount(0);
    await worker.evaluate(() => {
      const state = globalThis as any; state.senseCalls = []; state.quotaUsed = 0;
      chrome.permissions.contains = async () => true;
      state.fetch = async (url: string, init: RequestInit = {}) => {
        const address = String(url), body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        if (address.startsWith('https://api.bilibili.com/x/web-interface/view')) return Response.json({ code: 0, data: { aid: 1, desc: '合成简介' } });
        if (address.startsWith('https://api.bilibili.com/x/player/')) return Response.json({ code: 0, data: {} });
        if (address === 'https://token.sensenova.cn/v1/models') return Response.json({ data: [{ id: 'deepseek-flash' }] });
        if (address !== 'https://token.sensenova.cn/v1/chat/completions') throw Error('Unexpected model destination');
        state.senseCalls.push({ url: address, body, auth: new Headers(init.headers).get('authorization') });
        if (state.quotaUsed++ > 0) return Response.json({ error: { code: 8, message: 'PRIVATE_QUOTA_MESSAGE' } }, { status: 429, headers: { 'retry-after': '60' } });
        const text = body.max_tokens === 768 ? JSON.stringify({ version: 1, interpretedIntent: '问候', additionalSources: [], outputRequirements: [] }) : '单次调用回答完成。';
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: '' }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      };
    });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: 'API 设置', exact: true }).click();
    await page.getByLabel('服务商', { exact: true }).selectOption('sensenova');
    await page.getByLabel('API Key', { exact: true }).fill('SYNTHETIC_SENSE_QUOTA_KEY');
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(page.getByTestId('key-state')).toHaveText('Key 已保存在本机');
    await page.getByRole('button', { name: '拉取模型 / 重试', exact: true }).click();
    const intake = page.getByLabel('模型录入', { exact: true });
    await intake.getByRole('checkbox').check();
    await intake.getByRole('button', { name: '录入所选模型', exact: true }).click();
    await page.getByRole('button', { name: /^返回/ }).click();
    await expect.poll(async () => (await command({ type: 'workspace.query' })).view.draft.modelId).toBe('deepseek-flash');
    await site.bringToFront();
    await page.getByLabel('输入草稿', { exact: true }).fill('你好');
    await page.getByLabel('输入草稿', { exact: true }).press('Enter');
    await expect(page.getByText('单次调用回答完成。', { exact: true })).toBeVisible();
    let calls = await worker.evaluate(() => (globalThis as any).senseCalls);
    expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ auth: 'Bearer SYNTHETIC_SENSE_QUOTA_KEY', body: { model: 'deepseek-flash' } });
    expect(JSON.stringify(calls[0].body.messages)).toContain('增强内容');
    expect(await page.locator('.message-evidence').last().textContent()).not.toContain('资料规划未完成');
    await page.bringToFront(); await page.screenshot({ path: test.info().outputPath('sensenova-one-call-360.png') });
    await site.bringToFront();
    await page.getByLabel('输入草稿', { exact: true }).fill('继续');
    await page.getByLabel('输入草稿', { exact: true }).press('Enter');
    await expect(page.getByRole('alert')).toContainText('HTTP 429');
    await expect(page.getByRole('alert')).toContainText('60 秒');
    const task = page.locator('.message-task').filter({ has: page.getByRole('alert') });
    const jobId = await task.getAttribute('data-job-id');
    expect((await worker.evaluate(() => (globalThis as any).senseCalls)).length).toBe(2);
    await page.reload(); await expect(page.getByTestId('startup')).toHaveCount(0);
    const saved = page.locator(`[data-job-id="${jobId}"]`);
    await expect(saved.getByRole('alert')).toContainText('HTTP 429');
    await saved.getByText('失败详情 / 重试', { exact: true }).click();
    await saved.getByText('失败详情（用于反馈）', { exact: true }).click();
    const feedback = await saved.getByLabel('完整诊断文本', { exact: true }).inputValue();
    expect(JSON.parse(feedback).diagnostics).toContainEqual(expect.objectContaining({ httpStatus: 429, retryAfterSeconds: 60, modelId: 'deepseek-flash', providerId: 'sensenova' }));
    expect(feedback).not.toMatch(/PRIVATE_|SYNTHETIC_/);
    await page.bringToFront(); await page.screenshot({ path: test.info().outputPath('sensenova-quota-360.png') });
    // No implicit retry on reload. Simulate a fresh service quota window, then
    // let the user explicitly retry the frozen request exactly once.
    expect((await worker.evaluate(() => (globalThis as any).senseCalls)).length).toBe(2);
    await worker.evaluate(() => { (globalThis as any).quotaUsed = 0; });
    await site.bringToFront(); await saved.getByRole('button', { name: '重试原请求', exact: true }).click();
    await expect(page.getByText('单次调用回答完成。', { exact: true })).toHaveCount(2);
    calls = await worker.evaluate(() => (globalThis as any).senseCalls);
    expect(calls).toHaveLength(3);
    expect(calls.every((call: any) => call.body.max_tokens === undefined)).toBe(true);
  } finally { await context.close(); }
});
