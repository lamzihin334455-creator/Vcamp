import {startNewChat} from './workbench-actions';
import { chromium, expect, test, type Page, type BrowserContext } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const extension = resolve(process.env.EXPERIENCE_BUNDLE ?? 'dist');
async function observeRequests(context: BrowserContext) {
  await context.addInitScript(() => {
    if (location.protocol !== 'chrome-extension:') return;
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (async (message: any) => {
      const response = await send(message);
      if (response?.ok && ['workspace.query', 'chat.create', 'chat.select'].includes(message.operation?.type)) (window as any).t03View = response.view;
      return response;
    }) as typeof chrome.runtime.sendMessage;
  });
}
async function connectVideo(context: BrowserContext) {
  await context.route('https://www.bilibili.com/video/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><video></video><script>window.__INITIAL_STATE__={videoData:{bvid:'BVchats',title:'对话隔离测试',pages:[{page:1,cid:10,part:'P1'}]}};window.player={getVideoMessage:()=>({bvid:'BVchats',cid:10})};fetch('https://api.bilibili.com/x/player/wbi/v2?cid=10');</script>` }));
  await context.route('https://api.bilibili.com/**', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }) }));
  const site = await context.newPage(); await site.goto('https://www.bilibili.com/video/BVchats/'); await site.bringToFront();
}
async function installedPanel() {
  await mkdir(resolve('.profiles'), { recursive: true });
  const profile = await mkdtemp(resolve('.profiles/Release-T03-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 360, height: 800 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await observeRequests(context);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage(); await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await connectVideo(context);
  await expect(page.getByRole('textbox', { name: '输入草稿' })).toBeEnabled();
  return { context, page, id, profile };
}
// Read the UI client's responses; extra workspace.query calls would change the router's current selection.
const view = (page: Page) => page.evaluate(() => (window as any).t03View);
async function newChat(page: Page) {
  await startNewChat(page);
}
async function selectChat(page: Page, id: string) {
  const chat = (await view(page)).chats.find((chat: { id: string }) => chat.id === id);
  expect(chat).toBeTruthy();
  await page.getByRole('button', { name: '切换当前内容', exact: true }).click();
  await page.getByRole('menuitem', { name: chat.title, exact: true }).click();
}
async function expectChat(page: Page, id: string, same = true) {
  if (same) await expect.poll(async () => (await view(page))?.chatId).toBe(id);
  else await expect.poll(async () => { const current = (await view(page))?.chatId; return !!current && current !== id; }).toBe(true);
}

test('T03 C/D: independent A/B drafts, composition, browsing and recent Chat survive same-profile restart', async () => {
  const first = await installedPanel();
  let context = first.context;
  try {
    let page = first.page;
    const editor = page.getByRole('textbox', { name: '输入草稿' });
    const a = (await view(page)).chatId;
    await editor.dispatchEvent('compositionstart', { data: 'zhong' });
    await expect(page.getByRole('button', { name: '切换当前内容', exact: true })).toBeDisabled();
    await editor.fill('A 的中文草稿');
    await editor.dispatchEvent('compositionend', { data: '中文' });
    await page.getByRole('button', { name: '产物类型：Chat', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Markdown 笔记' }).click();
    // Click immediately: the switch must flush the outgoing write queue.
    await newChat(page);
    await expect(editor).toHaveValue('');
    const b = (await view(page)).chatId;
    expect(b).not.toBe(a);
    await editor.fill('B 的草稿');
    await selectChat(page, a);
    await expect(editor).toHaveValue('A 的中文草稿');
    await expect(page.locator('.output-control > button')).toHaveText('笔记');
    await page.getByRole('navigation').getByRole('button', { name: 'HTML', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-module', 'html');
    await page.getByRole('navigation').getByRole('button', { name: '问答', exact: true }).click();
    await expect(editor).toHaveValue('A 的中文草稿');
    await selectChat(page, b);
    await expect(editor).toHaveValue('B 的草稿');
    await expect(page.getByRole('status')).toHaveText('草稿已保存');
    const output = resolve('../.tmp/t03'); await mkdir(output, { recursive: true });
    await page.screenshot({ path: resolve(output, 'chats-360.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await context.close();
    context = await chromium.launchPersistentContext(first.profile, { channel: 'chromium', headless: true, viewport: { width: 360, height: 800 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await observeRequests(context);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    page = await context.newPage(); await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await connectVideo(context);
    await expectChat(page, b);
    await expect(page.getByRole('textbox')).toHaveValue('B 的草稿');
    await selectChat(page, a);
    await expect(page.getByRole('textbox')).toHaveValue('A 的中文草稿');
    await expect(page.locator('.output-control > button')).toHaveText('笔记');
    await writeFile(resolve(output, 'restart.json'), JSON.stringify({ browser: context.browser()?.version(), profile: first.profile, a, b, closedContextAndRelaunchedSameProfile: true, restoredRecent: b, binding: 'synthetic video metadata; installed production bundle and real IndexedDB', ime: 'synthetic composition events; native IME not-run' }, null, 2));
  } finally { await context.close(); }
});

test('T03 C/D: failed outgoing save blocks Chat switch and a conflicting window can download its full input', async () => {
  const { context, page, id } = await installedPanel();
  try {
    const editor = page.getByRole('textbox');
    const a = (await view(page)).chatId;
    await page.evaluate(() => {
      const raw = chrome.runtime.sendMessage.bind(chrome.runtime);
      (window as any).raw = raw;
      let fail = true;
      chrome.runtime.sendMessage = (async (message: any) => {
        if (message.operation?.type === 'draft.save' && fail) {
          fail = false; return { version: 1, requestId: message.requestId, ok: false, code: 'storage-failed' };
        }
        return raw(message);
      }) as typeof chrome.runtime.sendMessage;
    });
    await editor.fill('保存失败但保留');
    await expect(page.getByRole('status')).toHaveText('未保存');
    await newChat(page);
    await expectChat(page, a);
    await expect(editor).toHaveValue('保存失败但保留');
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('草稿已保存');
    await newChat(page);
    await expectChat(page, a, false);
    const b = (await view(page)).chatId;
    await page.evaluate(async () => {
      const view = (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } })).view;
      await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'draft.save', target: { workspaceId: view.workspaceId, chatId: view.chatId }, expectedRevision: view.draft.revision,
        draft: { ...view.draft, text: '描述夹具', outputType: 'markdown', template: { templateId: 'template-1', revisionId: 'template-r2' }, referenceIds: ['note-1'], attachmentIds: ['frame-1'],
          references: [{ artifactId: 'note-1', workspaceId: view.workspaceId, sourceChatId: view.chatId, title: '笔记描述夹具', type: 'markdown' }],
          attachments: [{ attachmentId: 'frame-1', workspaceId: view.workspaceId, chatId: view.chatId, name: '截图描述夹具', mimeType: 'image/png', time: 12 }] } } });
    });
    await expect(editor).toHaveValue('描述夹具');
    await page.evaluate(() => {
      let held = false;
      chrome.runtime.sendMessage = (async (message: any) => {
        if (!held && message.operation?.type === 'draft.save') {
          held = true; await new Promise<void>(resolve => { (window as any).release = resolve; });
        }
        return (window as any).raw(message);
      }) as typeof chrome.runtime.sendMessage;
    });
    await editor.fill('本窗口待恢复中文');
    await expect.poll(() => page.evaluate(() => Boolean((window as any).release))).toBe(true);
    const other = await context.newPage(); await other.goto(`chrome-extension://${id}/sidepanel.html`);
    await expectChat(other, b);
    await other.getByRole('textbox').fill('另一窗口的新数据');
    await expect(other.getByRole('status')).toHaveText('草稿已保存');
    await page.evaluate(() => (window as any).release());
    await expect(page.getByRole('alert').filter({ hasText: '另一窗口' })).toContainText('另一窗口');
    await selectChat(page, a);
    await expectChat(page, b);
    await expect(editor).toHaveValue('本窗口待恢复中文');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载未保存草稿' }).click();
    const recovered = await download;
    expect(recovered.suggestedFilename()).toBe('vcamp-unsaved-drafts.json');
    const backup = JSON.parse(await readFile((await recovered.path())!, 'utf8'));
    expect(backup).toMatchObject([{ target: { workspaceId: expect.any(String), chatId: b }, expectedRevision: 1,
      draft: { text: '本窗口待恢复中文', schemaVersion: 1, outputType: 'markdown', template: { templateId: 'template-1', revisionId: 'template-r2' },
        references: [{ artifactId: 'note-1', sourceChatId: b }], attachments: [{ attachmentId: 'frame-1', chatId: b, time: 12 }] } }]);
    await page.getByRole('button', { name: '重新载入', exact: true }).click();
    await page.getByRole('button', { name: '已保留文字，载入已保存草稿' }).click();
    await expect(editor).toHaveValue('另一窗口的新数据');
    // Selecting in this window must not move the other window's current Chat.
    await selectChat(page, a);
    await expectChat(page, a);
    await expectChat(other, b);
    await expect(other.getByRole('textbox')).toHaveValue('另一窗口的新数据');
  } finally { await context.close(); }
});
