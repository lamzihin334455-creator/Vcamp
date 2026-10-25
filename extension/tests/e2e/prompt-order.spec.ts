import { expect, test } from '@playwright/test';
import { setup } from './interaction-fixture';

test('compact workflow: top create, click edit, hold reorder, Escape cancel, keyboard and reload', async () => {
  const { context, page, site, forbidden } = await setup();
  try {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    for (const name of ['坐标传送门', '健康度检测']) await page.evaluate(name => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'template.create', fields: { name, description: '', requirements: '回答', outputType: 'chat', defaultModelId: null } } }), name);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '模板工作流', exact: true }).click();
    const rows = page.locator('.prompt-sortable-list [data-prompt-id]');
    await expect(rows.first()).toBeVisible();
    const initial = await rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')!));
    for (const width of [280, 360, 500]) {
      await page.setViewportSize({ width, height: 850 });
      await expect(page.getByRole('button', { name: '新建模板', exact: true })).toBeVisible();
      expect(await rows.first().evaluate(row => row.getBoundingClientRect().height)).toBe(48);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`templates-${width}.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 400, height: 850 });
    const start = (await rows.first().boundingBox())!, target = (await rows.nth(2).boundingBox())!;
    await page.mouse.move(start.x + 12, start.y + start.height / 2); await page.mouse.down();
    await page.waitForTimeout(420); await expect(page.locator('.prompt-drag-preview')).toBeVisible();
    await page.mouse.move(target.x + 12, target.y + target.height - 3, { steps: 8 });
    await page.screenshot({ path: test.info().outputPath('templates-drag.png'), animations: 'disabled' });
    await page.mouse.up();
    const moved = [initial[1], initial[2], initial[0], ...initial.slice(3)];
    await expect.poll(() => rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')))).toEqual(moved);
    await expect(page.locator('.prompt-editor')).toHaveCount(0);
    await page.reload(); await site.bringToFront();
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '模板工作流', exact: true }).click();
    await expect.poll(() => rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')))).toEqual(moved);
    // Short movement before the hold threshold does not reorder or open an editor.
    const box = (await rows.first().boundingBox())!;
    await page.mouse.move(box.x + 12, box.y + 24); await page.mouse.down(); await page.mouse.move(box.x + 12, box.y + 70); await page.mouse.up();
    await expect(page.locator('.prompt-editor')).toHaveCount(0);
    await expect.poll(() => rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')))).toEqual(moved);
    await page.mouse.move(box.x + 12, box.y + 24); await page.mouse.down(); await page.waitForTimeout(420);
    await page.mouse.move(box.x + 12, box.y + 120); await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(page.locator('.prompt-drag-preview')).toHaveCount(0);
    expect(await rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')))).toEqual(moved);
    await rows.nth(1).locator('.prompt-row-grip').focus(); await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')))).toEqual([moved[1], moved[0], ...moved.slice(2)]);
    await rows.first().locator('.prompt-row-open').click(); await expect(page.getByRole('button', { name: '返回模板列表', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回模板列表', exact: true }).click();
    await page.getByRole('button', { name: '新建模板', exact: true }).click(); await expect(page.getByLabel('模板名称', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '返回模板列表', exact: true }).click();
    await page.getByRole('button', { name: '风格管理', exact: true }).click();
    await expect(page.getByRole('button', { name: '新建风格', exact: true })).toBeVisible();
    const styleBefore = await rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')!));
    const style = (await rows.first().boundingBox())!, destination = (await rows.nth(2).boundingBox())!;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: style.x + 50, y: style.y + 24 }] });
    await page.waitForTimeout(420);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: style.x + 50, y: destination.y + 43 }] });
    await expect(page.locator('.prompt-drag-preview')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('styles-touch-drag.png'), animations: 'disabled' });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')))).toEqual([styleBefore[1], styleBefore[2], styleBefore[0], ...styleBefore.slice(3)]);
    await page.screenshot({ path: test.info().outputPath('styles-400.png'), animations: 'disabled' });
    await expect(page.locator('.prompt-editor')).toHaveCount(0);
    expect(errors).toEqual([]); expect(forbidden).toEqual([]);
  } finally { await context.close(); }
});

test('touch scroll is preserved before a hold; dragging a long list scrolls its edge and saves the drop', async () => {
  const { context, page } = await setup();
  try {
    for (let index = 0; index < 18; index++) await page.evaluate(index => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'template.create', fields: { name: `长列表任务 ${index}`, description: '', requirements: '回答', outputType: 'chat', defaultModelId: null } } }), index);
    await page.setViewportSize({ width: 360, height: 500 });
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '模板工作流', exact: true }).click();
    const scroller = page.locator('.settings-page'), rows = page.locator('[data-prompt-id]');
    const before = await rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')));
    const first = (await rows.first().boundingBox())!, cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first.x + 80, y: 420 }] });
    for (const y of [380, 340, 300, 260]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: first.x + 80, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => scroller.evaluate(row => row.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('.prompt-drag-preview, .prompt-editor')).toHaveCount(0);
    expect(await rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')))).toEqual(before);
    // Let the native fling finish before returning to the first row.
    await page.waitForTimeout(400); await scroller.evaluate(row => { row.scrollTop = 0; });
    const start = (await rows.first().boundingBox())!;
    await page.mouse.move(start.x + 12, start.y + 24); await page.mouse.down(); await page.waitForTimeout(420);
    await page.mouse.move(start.x + 12, 480, { steps: 10 });
    await expect.poll(() => scroller.evaluate(row => row.scrollTop)).toBeGreaterThan(220);
    await page.screenshot({ path: test.info().outputPath('long-list-edge-drag.png'), animations: 'disabled' });
    await page.mouse.up();
    await expect.poll(() => rows.evaluateAll((rows, id) => rows.findIndex(row => row.getAttribute('data-prompt-id') === id), before[0])).toBeGreaterThan(4);
    const after = await rows.evaluateAll(rows => rows.map(row => row.getAttribute('data-prompt-id')));
    expect(after.indexOf(before[0])).toBeGreaterThan(4);
    expect([...after].sort()).toEqual([...before].sort());
    await expect(page.locator('.prompt-editor')).toHaveCount(0);
  } finally { await context.close(); }
});
