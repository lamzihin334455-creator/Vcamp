import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';

const evidence = resolve('../.tmp/e2e');
async function launch(build: string, profile?: string) {
  await mkdir(resolve('.profiles'), { recursive: true });
  const dir = profile ?? await mkdtemp(resolve('.profiles/T01-'));
  const extension = resolve(build==='dist'?(process.env.EXPERIENCE_BUNDLE??build):build);
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  return { context, dir, id };
}
async function panel(context: BrowserContext, id: string) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  return page;
}

test('D production: installed build starts unbound without seeded Chat or draft', async () => {
  const { context, id } = await launch('dist');
  try {
    const page = await panel(context, id);
    await expect(page.getByRole('main').getByText('尚未绑定视频')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '输入草稿' })).toBeDisabled();
    const response = await page.evaluate(() => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'workspace.query' } }));
    expect(response.view).toMatchObject({ workspaceId: null, chatId: null, draft: null });
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: resolve(evidence, 'production-360.png') });
  } finally { await context.close(); }
});

test('C/D test adapter: widths, IME events, quick navigation, readonly and same-profile restart', async () => {
  const first = await launch('dist-test');
  let context = first.context;
  try {
    let page = await panel(context, first.id);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const editor = page.getByRole('textbox', { name: '输入草稿' });
    await expect(editor).toBeEnabled();
    await editor.fill('中文输入法草稿，关闭后仍然保留。');
    await editor.dispatchEvent('compositionstart', { data: '拼音' });
    await editor.press('Enter');
    await editor.dispatchEvent('compositionend', { data: '中文' });
    await expect(editor).toHaveValue('中文输入法草稿，关闭后仍然保留。\n');
    await expect(page.getByRole('status')).toHaveText('草稿已保存');
    for (const width of [320, 360, 420, 576, 600, 900]) {
      await page.setViewportSize({ width, height: 800 });
      await page.getByRole('button', { name: '产物类型：Chat', exact: true }).click();
      const menu = page.getByRole('menu');
      const box = await menu.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.getByRole('menuitemradio', { name: 'Markdown 笔记' }).click();
      await expect(page.getByRole('status')).toHaveText('草稿已保存');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(evidence, `bound-${width}.png`) });
      await page.getByRole('button', { name: '产物类型：笔记', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Chat 问答' }).click();
    }
    await page.setViewportSize({ width: 360, height: 800 });
    const toggle = page.getByRole('button', { name: '收起侧栏' });
    const toggleBox = await toggle.boundingBox();
    await toggle.click();
    await page.waitForTimeout(300);
    const beforePeek = await page.locator('.composer').boundingBox();
    await page.mouse.move(358, 400);
    await expect(page.getByRole('navigation')).toBeVisible();
    await page.waitForTimeout(300);
    expect((await page.locator('.composer').boundingBox())!.width).toBe(beforePeek!.width);
    expect((await page.getByRole('button', { name: '固定侧栏' }).boundingBox())!.x).toBe(toggleBox!.x);
    await page.getByRole('button', { name: '固定侧栏' }).click();
    for (const name of ['字幕', 'HTML', '随笔', '问答']) await page.getByRole('navigation').getByRole('button', { name, exact: true }).click({ delay: 5 });
    await expect(page.locator('main')).toHaveAttribute('data-module', 'chat');
    await expect(editor).toHaveValue('中文输入法草稿，关闭后仍然保留。\n');
    await page.setViewportSize({ width: 320, height: 400 });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByLabel('工作台设置')).toBeVisible();
    await page.screenshot({ path: resolve(evidence, 'short-dialog.png') });
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('navigation').getByRole('button', { name: '笔记', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-module', 'markdown');
    await page.getByRole('navigation').getByRole('button', { name: '问答', exact: true }).click();
    const view = await page.evaluate(async () => (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'workspace.query' } })).view);
    const reader = await context.newPage();
    await reader.goto(`chrome-extension://${first.id}/reader.html?workspaceId=${encodeURIComponent(view.workspaceId)}`);
    await expect(reader.getByRole('button',{name:'切换当前内容'})).toBeDisabled();
    await expect(reader.getByRole('textbox')).toHaveCount(0);
    const denied = await reader.evaluate(async draft => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'draft.save', expectedRevision: draft.revision, draft } }), view.draft);
    expect(denied.code).toBe('forbidden');
    await page.close();
    page = await panel(context, first.id);
    await expect(page.getByRole('textbox')).toHaveValue('中文输入法草稿，关闭后仍然保留。\n');
    await context.close();
    const second = await launch('dist-test', first.dir);
    context = second.context;
    page = await panel(context, second.id);
    await expect(page.getByRole('textbox')).toHaveValue('中文输入法草稿，关闭后仍然保留。\n');
    expect(errors).toEqual([]);
    await writeFile(resolve(evidence, 'environment.json'), JSON.stringify({ browser: context.browser()?.version(), profile: first.dir, production: 'dist', bindingBuild: 'dist-test', note: 'Extension page viewport tests; not measurements of native Side Panel width. Composition events are synthetic, not a native IME.' }, null, 2));
  } finally { await context.close(); }
});
