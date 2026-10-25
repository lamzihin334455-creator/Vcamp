import { expect, test } from '@playwright/test';
import { setup } from './interaction-fixture';

test('production: three provider presets, SenseNova fetched alias imports canonical V4.1 and sends exactly once', async () => {
  const { context, page, worker, site } = await setup();
  try {
    await page.getByRole('button', { name: '切换当前内容', exact: true }).click();
    await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
    await expect(page.getByLabel('输入草稿')).toHaveValue('');
    await worker.evaluate(() => {
      const state = globalThis as any; state.aliasRequests = [];
      const original = fetch;
      state.fetch = async (url: any, init: RequestInit = {}) => {
        if (!String(url).startsWith('https://token.sensenova.cn/v1/')) return original(url, init);
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        state.aliasRequests.push({ url: String(url), body });
        if (!body) return Response.json({ data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4.1-flash' }, { id: 'sensenova-6.8-flash-lite' }] });
        if (body.model !== 'deepseek-flash') return Response.json({ error: { code: 'forbidden' } }, { status: 403 });
        return new Response('data: {"choices":[{"delta":{"content":"商汤路由正确"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      };
    });
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: 'API 设置', exact: true }).click();
    const select = page.getByLabel('服务商', { exact: true });
    expect(await select.locator('option').allTextContents()).toEqual(['DeepSeek', '阿里云百炼', '商汤日日新', '自定义（OpenAI 兼容）']);
    await select.selectOption('sensenova');
    await page.getByLabel('API Key', { exact: true }).fill('SYNTHETIC_SENSENOVA_BROWSER_KEY');
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await page.getByRole('button', { name: '拉取模型 / 重试', exact: true }).click();
    const dialog = page.locator('.provider-intake');
    await expect(dialog).toContainText('DeepSeek V4.1 Flash');
    await expect(dialog).not.toContainText('deepseek-v4.1-flash');
    await dialog.getByRole('checkbox', { name: /DeepSeek V4.1 Flash/ }).check();
    await dialog.getByRole('button', { name: '录入所选模型', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath('sensenova-imported.png'), animations: 'disabled' });
    await page.getByRole('button', { name: /^返回/ }).click();
    await page.getByLabel('输入草稿').fill('你好');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.chat-turn.assistant').last()).toContainText('商汤路由正确');
    const requests = await worker.evaluate(() => (globalThis as any).aliasRequests);
    const calls = requests.filter((request: any) => request.body);
    expect(calls).toHaveLength(1); expect(calls[0].body.model).toBe('deepseek-flash');
    expect(calls[0].body).not.toHaveProperty('thinking'); expect(calls[0].body).not.toHaveProperty('reasoning_effort');
    await page.reload(); await site.bringToFront(); await expect(page.locator('.chat-turn.assistant').last()).toContainText('商汤路由正确');
  } finally { await context.close(); }
});
