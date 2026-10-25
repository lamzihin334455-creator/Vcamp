import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { installedPanel } from './fix-support';
import { setup } from './interaction-fixture';

for (const mode of ['test-extension', 'production'] as const) test(`${mode}: provider presets, custom URL, manual model, generic answer and feature gates`, async () => {
  const f = mode === 'production' ? await setup() : await installedPanel();
  const { page, worker, context } = f;
  const draftModel = () => page.evaluate(async () => (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } })).view.draft?.modelId);
  const evidence = resolve('test-results-providers-0.1.70'); await mkdir(evidence, { recursive: true });
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    if (mode === 'production') {
      const chatId = () => page.evaluate(async () => (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } })).view.chatId);
      const previousChat = await chatId();
      await page.getByRole('button', { name: '切换当前内容', exact: true }).click(); await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
      await expect.poll(chatId).not.toBe(previousChat);
      await page.reload(); await expect(page.getByTestId('startup')).toHaveCount(0);
    }
    await page.evaluate(async () => {
      const windowId = (await chrome.windows.getCurrent()).id, send = (operation: any) => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId, operation });
      const view = (await send({ type: 'workspace.query' })).view;
      const saved = await send({ type: 'draft.save', target: { workspaceId: view.workspaceId, chatId: view.chatId }, expectedRevision: view.draft.revision, draft: { ...view.draft, webEnabled: true, visionEnabled: true } });
      if (!saved.ok) throw Error('Synthetic enabled-feature setup was not saved');
    });
    await worker.evaluate(() => {
      const state = globalThis as any; state.providerRequests = [];
      // Synthetic host grants isolate UI/API wiring without a browser permission dialog.
      chrome.permissions.contains = async () => true;
      state.fetch = async (url: string, init: RequestInit = {}) => {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        state.providerRequests.push({ url: String(url), method: init.method, body, authorization: new Headers(init.headers).get('authorization') });
        if (String(url).startsWith('https://api.bilibili.com/x/web-interface/view')) return Response.json({ code: 0, data: { aid: 1, desc: '合成视频介绍' } });
        if (String(url).startsWith('https://api.bilibili.com/x/player/v2')) return Response.json({ code: 0, data: {} });
        if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'org/fixture-text', input_modalities: ['text', 'image'] }, { id: 'deepseek-flash', input_modalities: ['text'] }] });
        if (String(url) !== 'https://gateway.example.test/proxy/v1/chat/completions') throw Error('Unexpected provider destination');
        const text = body.max_tokens === 768 ? JSON.stringify({ version: 1, interpretedIntent: '合成测试', additionalSources: [], outputRequirements: [] }) : '第三方文本回答完成。';
        return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      };
    });
    await page.evaluate(() => {
      (globalThis as any).hostRequests = [];
      chrome.permissions.request = async options => { (globalThis as any).hostRequests.push(options); return true; };
    });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: 'API 设置', exact: true }).click();
    const service = page.getByLabel('服务商', { exact: true }), url = page.getByLabel('服务地址（Base URL）', { exact: true });
    await service.selectOption('bailian');
    await expect(url).toHaveValue('https://dashscope.aliyuncs.com/compatible-mode/v1');
    await expect(page.getByText(/业务空间专属域名/)).toHaveCount(0);
    await expect(service.locator('option')).toHaveCount(4);
    await expect(service.locator('option[value="siliconflow"], option[value="zhipu"]')).toHaveCount(0);
    await service.selectOption('sensenova'); await expect(url).toHaveValue('https://token.sensenova.cn/v1');
    await page.bringToFront(); await expect(page.getByTestId('startup')).toHaveCount(0);
    await page.screenshot({ path: resolve(evidence, `${mode}-presets-360.png`), fullPage: true });
    await service.selectOption('custom'); await expect(url).toHaveValue('');
    await url.fill('http://gateway.example.test/v1');
    await expect(page.getByRole('button', { name: '保存连接', exact: true })).toBeDisabled();
    await url.fill('https://gateway.example.test/proxy/v1/');
    await page.getByLabel('API Key', { exact: true }).fill('SYNTHETIC_CUSTOM_KEY');
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(page.getByTestId('key-state')).toHaveText('Key 已保存在本机');
    await expect(url).toHaveValue('https://gateway.example.test/proxy/v1');
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
    expect(await page.evaluate(() => (globalThis as any).hostRequests)).toEqual([{ origins: ['https://gateway.example.test/*'] }]);
    await page.getByRole('button', { name: '拉取模型 / 重试', exact: true }).click();
    await expect(page.getByText('模型列表已更新', { exact: true })).toBeVisible();
    await page.getByText('更多设置', { exact: true }).click();
    await page.getByLabel('手动模型 ID', { exact: true }).fill('org/manual-text');
    await page.getByRole('button', { name: '添加并设为默认模型', exact: true }).click();
    await expect(page.getByLabel('当前应用模型', { exact: true })).toHaveAttribute('data-value', /:org\/manual-text$/);
    await expect(page.getByText('模型兼容与功能说明', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: resolve(evidence, `${mode}-custom-360.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: /^返回/ }).click();
    await expect.poll(draftModel).toBe('org/manual-text');
    await expect.poll(() => page.evaluate(async () => { const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } }); return { web: response.view.draft.webEnabled === true, vision: response.view.draft.visionEnabled === true }; })).toEqual({ web: false, vision: false });
    await expect(page.getByRole('button', { name: '联网', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '更多输入操作', exact: true }).click();
    await expect(page.getByRole('button', { name: '开启自主识别画面' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '添加图片', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '截取当前画面', exact: true })).toBeDisabled();
    await page.getByLabel('输入草稿', { exact: true }).fill('解释当前视频的内容');
    await page.getByLabel('输入草稿', { exact: true }).press('Escape');
    if ('site' in f) await f.site.bringToFront();
    await page.getByLabel('输入草稿', { exact: true }).press('Enter');
    await expect(page.getByText('第三方文本回答完成。', { exact: true })).toBeVisible();
    const calls = await worker.evaluate(() => (globalThis as any).providerRequests);
    const modelCalls = calls.filter((call: any) => call.body?.messages);
    expect(modelCalls).toHaveLength(2);
    for (const call of modelCalls) {
      expect(call.url).toBe('https://gateway.example.test/proxy/v1/chat/completions');
      expect(call.authorization).toBe('Bearer SYNTHETIC_CUSTOM_KEY');
      expect(call.body.thinking).toBeUndefined(); expect(call.body.stream_options).toBeUndefined(); expect(call.body.response_format).toBeUndefined();
      expect(call.body.max_tokens).toBe(call.body.max_tokens === 768 ? 768 : undefined);
    }
    expect(calls.some((call: any) => call.url.includes('/tools/search'))).toBe(false);
    expect(calls.some((call: any) => call.url.includes('api.deepseek.com'))).toBe(false);
    await page.reload();
    await expect.poll(draftModel).toBe('org/manual-text');
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: 'API 设置', exact: true }).click();
    await expect(service).toHaveValue('custom'); await expect(url).toHaveValue('https://gateway.example.test/proxy/v1');
    await service.selectOption('deepseek');
    // Switching the connection must not send the existing credential to DeepSeek.
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(page.getByTestId('key-state')).toHaveText('未保存 Key');
    const persisted = await worker.evaluate(async () => (await chrome.storage.local.get('vcamp.provider.v1'))['vcamp.provider.v1']);
    expect(persisted.key).toBeNull(); expect(persisted.models).toEqual([]); expect(persisted.defaultModelId).toBeNull();
  } finally { await context.close(); }
});
