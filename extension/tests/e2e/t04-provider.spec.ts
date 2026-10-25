import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { installedPanel } from './fix-support';

test('T04 D: installed settings, restricted credentials, model selection and reopen with synthetic transport', async () => {
  const installed = await installedPanel(); let context = installed.context;
  const evidence = resolve('../.tmp/t04'); await mkdir(evidence, { recursive: true });
  try {
    let page = installed.page;
    const query=()=>page.evaluate(async()=>(await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation:{type:'workspace.query'}})).view);
    const openSettings=async()=>{await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'API 设置',exact:true}).click();};
    const selectModel=async(name:string)=>{await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'当前应用模型',exact:true}).click();await page.getByRole('option',{name:new RegExp(name)}).click();await page.keyboard.press('Escape');};
    await installed.worker.evaluate(() => {
      const state = globalThis as unknown as { mode: string; calls: number; fetch: typeof fetch };
      state.mode = 'ok'; state.calls = 0;
      state.fetch = async (url, init) => {
        if (url !== 'https://api.deepseek.com/models' || init?.method !== 'GET') throw Error('Unexpected transport');
        state.calls++;
        if (state.mode === '401') return new Response('discarded synthetic error', { status: 401 });
        return new Response(JSON.stringify({ object: 'list', data: state.mode === 'empty' ? [] : [
          { id: 'synthetic-a', name: 'Synthetic A', object: 'model', input_modalities: ['text'] },
          { id: 'synthetic-b', name: 'Synthetic B', object: 'model' }
        ] }), { headers: { 'content-type': 'application/json' } });
      };
    });
    await openSettings();
    await page.getByLabel('API Key', { exact: true }).fill('SYNTHETIC_T04_KEY');
    await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: '保存 Key', exact: true }).click();
    await expect(page.getByTestId('key-state')).toHaveText('Key 已保存在本机');
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '拉取模型 / 重试' }).click();
    await expect(page.getByText('模型列表已更新', { exact: true })).toBeVisible();
    await page.getByRole('button',{name:'全选搜索结果',exact:true}).click();
    await page.getByRole('button',{name:'录入所选模型',exact:true}).click();
    await page.screenshot({ path: resolve(evidence, 'settings-360.png') });
    await page.getByRole('button', { name: /^返回/ }).click();
    await expect.poll(async()=>(await query()).draft.modelId).toBe('synthetic-a');
    const first = await query(),firstChat=first.chatId,firstTitle=first.chats.find((c:any)=>c.id===firstChat).title;
    await page.getByLabel('输入草稿').fill('模型切换后保留文字');
    await selectModel('Synthetic B');
    await expect.poll(async()=>{const v=await query();return {text:v.draft.text,modelId:v.draft.modelId};}).toEqual({text:'模型切换后保留文字',modelId:'synthetic-b'});
    await page.getByRole('button',{name:'切换当前内容',exact:true}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await expect.poll(async()=>(await query()).draft.modelId).toBe('synthetic-b');
    await page.getByRole('button',{name:'切换当前内容',exact:true}).click();await page.getByRole('menuitem',{name:firstTitle,exact:true}).click();
    await expect.poll(async()=>(await query()).draft.modelId).toBe('synthetic-b');
    await expect(page.getByLabel('输入草稿')).toHaveValue('模型切换后保留文字');

    // Real isolated-world content script: platform storage denial plus application sender denial.
    await context.route('https://api.deepseek.com/t04-isolation', route => route.fulfill({ contentType: 'text/html', body: '<p>Synthetic isolation fixture</p>' }));
    const host = await context.newPage(); await host.goto('https://api.deepseek.com/t04-isolation');
    const isolation = await installed.worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://api.deepseek.com/t04-isolation' });
      const results = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id! }, world: 'ISOLATED', func: async () => {
        let storageDenied = false;
        try { await chrome.storage.local.get('vcamp.provider.v1'); } catch { storageDenied = true; }
        const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'provider.query' } });
        return { storageDenied, messageDenied: response.ok === false && response.code === 'forbidden' };
      } });
      return results[0].result;
    });
    expect(isolation).toEqual({ storageDenied: true, messageDenied: true });
    await host.close();

    await context.close();
    const extension = resolve('dist-test');
    context = await chromium.launchPersistentContext(installed.profile, { channel: 'chromium', headless: true, viewport: { width: 360, height: 800 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    // No model transport is needed for persisted config; prevent any accidental real request.
    await worker.evaluate(() => { globalThis.fetch = async () => { throw Error('Real network forbidden'); }; });
    page = await context.newPage(); await page.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    await expect.poll(async()=>(await query()).draft.modelId).toBe('synthetic-b');
    await expect(page.getByLabel('输入草稿')).toHaveValue('模型切换后保留文字');
    await openSettings();
    await expect(page.getByTestId('key-state')).toHaveText('Key 已保存在本机');
    await expect(page.getByRole('button',{name:'当前应用模型',exact:true})).toContainText('Synthetic B');
    await page.getByLabel('API Key', { exact: true }).fill('SYNTHETIC_REPLACEMENT');
    await page.getByRole('button', { name: '保存另一 Key', exact: true }).click();
    await expect(page.getByText('尚未拉取模型', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '删除连接 DeepSeek 2', exact: true }).click();
    await expect(page.getByTestId('key-state')).toHaveText('Key 已保存在本机');
    await expect(page.getByRole('button',{name:'当前应用模型',exact:true})).toContainText('Synthetic B');
    await page.getByRole('button', { name: '删除连接 DeepSeek 1', exact: true }).click();
    await expect(page.getByTestId('key-state')).toHaveText('未保存 Key');
    await expect(page.getByRole('button', { name: '拉取模型 / 重试' })).toHaveCount(0);
    const deleted = await worker.evaluate(async () => (await chrome.storage.local.get('vcamp.provider.v1'))['vcamp.provider.v1'].key === null);
    expect(deleted).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await writeFile(resolve(evidence, 'installed.json'), JSON.stringify({ browser: context.browser()?.version(), isolation, deleted, sameProfileRestart: true,
      globalSelectedModelAcrossChats: true, newChatDefaultApplied: true, syntheticTransport: true, modelApiCalls: 0,
      build: 'dist-test: production application/storage/message code, synthetic video binding only' }, null, 2));
  } finally { await context.close(); }
});
