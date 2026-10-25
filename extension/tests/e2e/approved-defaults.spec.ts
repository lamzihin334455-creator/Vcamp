import { expect, test } from '@playwright/test';
import { setup } from './interaction-fixture';

test('approved defaults, separated role scope, keyboard interaction and persistence fit narrow panels', async () => {
  const { context, page, site } = await setup();
  try {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: /角色设置/ }).click();
    const manager = page.getByRole('region', { name: '角色管理', exact: true });
    await expect(manager.locator('.prompt-list-title')).toHaveText(['简洁直接', '标准', '深度分析', '通俗易懂']);
    const scope = manager.getByRole('switch', { name: '将当前角色应用到所有产物', exact: true });
    await expect(scope).toHaveAttribute('aria-checked', 'false');
    await expect(manager.getByRole('region', { name: '角色说明', exact: true })).toHaveText('角色说明设置回答的详略与侧重点，也可自定义角色身份和表达风格。');
    for (const width of [280, 400, 720]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(scope).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const sizes = await scope.evaluate(button => ({ track: button.getBoundingClientRect().width, knob: button.querySelector('i')!.getBoundingClientRect().width }));
      expect(sizes).toEqual({ track: 38, knob: 18 });
      await page.screenshot({ path: test.info().outputPath(`roles-${width}.png`), animations: 'disabled' });
    }
    await scope.focus(); await scope.press('Space');
    await expect(scope).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('vcamp.roleAllOutputs'))['vcamp.roleAllOutputs'])).toBe(true);
    await page.reload(); await site.bringToFront();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: /角色设置/ }).click();
    await expect(scope).toHaveAttribute('aria-checked', 'true');
    await scope.press('Enter');
    await expect(scope).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: /^返回/ }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '模板工作流', exact: true }).click();
    await expect(page.locator('.prompt-row-name')).toHaveText(['快速总结', '坐标传送门', '健康度检测', '独立阅读文档', '风格化交互页面']);
  } finally { await context.close(); }
});

test('role scope prevents duplicate writes and rolls back a failed save before retry', async () => {
  const { context, page } = await setup();
  try {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: /角色设置/ }).click();
    const scope = page.getByRole('switch', { name: '将当前角色应用到所有产物', exact: true });
    await expect(scope).toBeEnabled();
    await page.evaluate(() => {
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      let failNext = true;
      chrome.storage.local.set = (async (value: Record<string, unknown>) => {
        if (Object.hasOwn(value, 'vcamp.roleAllOutputs') && failNext) {
          failNext = false;
          await new Promise<void>((_, reject) => { (window as any).rejectScopeWrite = () => reject(new Error('Synthetic storage failure')); });
        } else await original(value);
      }) as typeof chrome.storage.local.set;
    });
    await scope.click();
    await expect(scope).toBeDisabled();
    await expect(scope).toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => (window as any).rejectScopeWrite());
    await expect(page.getByRole('alert')).toHaveText('应用范围未保存，请重试。');
    await expect(scope).toBeEnabled();
    await expect(scope).toHaveAttribute('aria-checked', 'false');
    await scope.click();
    await expect(scope).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('vcamp.roleAllOutputs'))['vcamp.roleAllOutputs'])).toBe(true);
  } finally { await context.close(); }
});
