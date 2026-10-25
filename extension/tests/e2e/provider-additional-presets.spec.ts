import {startNewChat} from './workbench-actions';
import { expect, test } from '@playwright/test';
import { setup } from './interaction-fixture';

test('production: non-preset SiliconFlow and Zhipu custom connections retain keys, paths and complete model IDs', async () => {
  const { page, worker, context, site } = await setup();
  const command = (operation: any) => page.evaluate(operation => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation }), operation);
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    const old = (await command({ type: 'workspace.query' })).view.chatId;
    await startNewChat(page);
    await expect.poll(async () => (await command({ type: 'workspace.query' })).view.chatId).not.toBe(old);
    await page.reload(); await expect(page.getByTestId('startup')).toHaveCount(0);
    await worker.evaluate(() => {
      const state = globalThis as any; state.presetCalls = [];
      chrome.permissions.contains = async () => true;
      state.fetch = async (url: string, init: RequestInit = {}) => {
        const address = String(url), body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        if (address.startsWith('https://api.bilibili.com/x/web-interface/view')) return Response.json({ code: 0, data: { aid: 1, desc: '合成简介' } });
        if (address.startsWith('https://api.bilibili.com/x/player/')) return Response.json({ code: 0, data: {} });
        const silicon = address.startsWith('https://api.siliconflow.cn/v1/');
        if (!silicon && !address.startsWith('https://open.bigmodel.cn/api/paas/v4/')) throw Error('Unexpected provider');
        state.presetCalls.push({ url: address, auth: new Headers(init.headers).get('authorization'), body });
        if (address.endsWith('/models')) return silicon ? Response.json({ data: [{ id: 'deepseek-ai/DeepSeek-V4-Flash', input_modalities: ['text'] }] }) : new Response('', { status: 404 });
        if (!address.endsWith('/chat/completions')) throw Error('Incorrect provider path');
        const text = body.max_tokens === 768 ? JSON.stringify({ version: 1, interpretedIntent: '测试', additionalSources: [], outputRequirements: [] }) : `${silicon ? '硅基' : '智谱'}合成文本回答。`;
        return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      };
    });
    for (const provider of [
      { id: 'siliconflow', base: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V4-Flash', key: 'SYNTHETIC_SILICON_KEY', answer: '硅基合成文本回答。' },
      { id: 'zhipu', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3', key: 'SYNTHETIC_ZHIPU_KEY', answer: '智谱合成文本回答。' }
    ]) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('button', { name: 'API 设置', exact: true }).click();
      if (provider.id === 'zhipu') await page.getByRole('button', { name: '新增连接', exact: true }).click();
      await page.getByLabel('服务商', { exact: true }).selectOption('custom');
      await page.getByLabel('服务地址（Base URL）', { exact: true }).fill(provider.base);
      await expect(page.getByLabel('服务地址（Base URL）', { exact: true })).toHaveValue(provider.base);
      await page.getByLabel('API Key', { exact: true }).fill(provider.key);
      await page.getByRole('button', { name: '保存连接', exact: true }).click();
      await expect(page.getByTestId('key-state')).toHaveText('Key 已保存在本机');
      await page.getByRole('button', { name: '拉取模型 / 重试', exact: true }).click();
      if (provider.id === 'siliconflow') {
        const intake = page.getByLabel('模型录入', { exact: true });
        await expect(intake.getByRole('checkbox')).toHaveCount(1);
        await intake.getByRole('checkbox').check();
        await intake.getByRole('button', { name: '录入所选模型', exact: true }).click();
      } else {
        await expect.poll(async () => (await command({ type: 'provider.query' })).view.provider.status).toBe('unavailable');
        await page.getByText('更多设置', { exact: true }).click();
        await page.getByLabel('手动模型 ID', { exact: true }).fill(provider.model);
        await page.getByRole('button', { name: '添加并设为默认模型', exact: true }).click();
      }
      await page.getByRole('button', { name: /^返回/ }).click();
      await expect.poll(async () => (await command({ type: 'workspace.query' })).view.draft.modelId).toBe(provider.model);
      await site.bringToFront();
      await page.getByLabel('输入草稿', { exact: true }).fill('总结视频');
      await page.getByLabel('输入草稿', { exact: true }).press('Enter');
      await expect(page.getByText(provider.answer, { exact: true })).toBeVisible();
      const calls = (await worker.evaluate(() => (globalThis as any).presetCalls)).filter((call: any) => call.url.startsWith(provider.base));
      expect(calls.filter((call: any) => call.body)).toHaveLength(2);
      for (const call of calls) {
        expect(call.auth).toBe(`Bearer ${provider.key}`);
        if (call.body) {
          expect(call.url).toBe(`${provider.base}/chat/completions`);
          expect(call.body.model).toBe(provider.model);
          for (const field of ['thinking', 'tools', 'stream_options', 'response_format']) expect(call.body[field]).toBeUndefined();
        }
      }
      await page.bringToFront(); await page.screenshot({ path: test.info().outputPath(`${provider.id}-answer-360.png`) });
    }
  } finally { await context.close(); }
});
