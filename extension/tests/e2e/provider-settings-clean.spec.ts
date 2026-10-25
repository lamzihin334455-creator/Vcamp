import { expect, test } from '@playwright/test';
import { installedPanel } from './fix-support';
import { setup } from './interaction-fixture';

for (const mode of ['test-extension', 'production'] as const) test(`${mode}: clean settings, SenseNova import, no preset permission prompts, delete bad connections`, async () => {
  const f = mode === 'production' ? await setup() : await installedPanel();
  const { page, worker, context } = f;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const command = (operation: any) => page.evaluate(operation => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation }), operation);
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    // Real manifest host grants are used: requesting a preset origin is a regression.
    await page.evaluate(() => { (globalThis as any).permissionRequests = 0; chrome.permissions.request = async () => { (globalThis as any).permissionRequests++; throw Error('Unexpected permission request'); }; });
    await worker.evaluate(() => {
      (globalThis as any).discoveryRequests = [];
      globalThis.fetch = async (url, init) => {
        if (!String(url).endsWith('/models')) throw Error('Only isolated model discovery allowed');
        (globalThis as any).discoveryRequests.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
        return Response.json({ data: [
          { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', input_modalities: ['text', 'image'], output_modalities: ['text'] },
          { id: 'sensenova-u1.5-lite', input_modalities: ['text', 'image'], output_modalities: ['image'] },
          { id: 'audio-only', input_modalities: ['audio'], output_modalities: ['audio'] }
        ] });
      };
    });
    const open = async () => { await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: 'API 设置', exact: true }).click(); };
    await open();
    const settings = page.getByRole('region', { name: '模型服务配置', exact: true });
    await expect(settings).not.toContainText('汇总所有连接');
    await expect(settings).not.toContainText('Key 仅保存在此浏览器');
    await expect(settings).not.toContainText('模型兼容与功能说明');
    await page.getByLabel('服务商', { exact: true }).selectOption('sensenova');
    await expect(page.getByLabel('服务地址（Base URL）', { exact: true })).toHaveValue('https://token.sensenova.cn/v1');
    await page.getByLabel('API Key', { exact: true }).fill('SYNTHETIC_SENSENOVA_BROWSER');
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(page.getByTestId('key-state')).toHaveText('Key 已保存在本机');
    expect(await page.evaluate(() => (globalThis as any).permissionRequests)).toBe(0);
    let view = (await command({ type: 'provider.query' })).view.provider;
    const valid = view.profileId;
    await page.getByRole('button', { name: '拉取模型 / 重试', exact: true }).click();
    await expect(page.getByText('模型列表已更新', { exact: true })).toBeVisible();
    const intake = page.getByLabel('模型录入', { exact: true });
    await expect(intake.getByRole('checkbox')).toHaveCount(3);
    await expect(intake.locator('label').filter({ hasText: 'sensenova-u1.5-lite' }).getByRole('checkbox')).toBeDisabled();
    await expect(intake.locator('label').filter({ hasText: 'audio-only' }).getByRole('checkbox')).toBeDisabled();
    await intake.locator('label').filter({ hasText: 'DeepSeek V4.1 Flash' }).getByRole('checkbox').check();
    await intake.getByRole('button', { name: '录入所选模型', exact: true }).click();
    await expect(page.getByLabel('当前应用模型', { exact: true })).toHaveAttribute('data-value', `${valid}:deepseek-flash`);
    expect(await worker.evaluate(() => (globalThis as any).discoveryRequests)).toEqual([{ url: 'https://token.sensenova.cn/v1/models', authorization: 'Bearer SYNTHETIC_SENSENOVA_BROWSER' }]);
    // Two erroneous saved entries, one not selected and one selected with a failed catalogue.
    for (const suffix of ['1', '2']) {
      view = (await command({ type: 'provider.query' })).view.provider;
      view = (await command({ type: 'provider.configure', providerId: 'sensenova', baseUrl: 'https://token.sensenova.cn/v1', expectedRevision: view.revision })).view.provider;
      view = (await command({ type: 'provider.save-key', providerId: 'sensenova', key: `SYNTHETIC_BAD_${suffix}`, expectedRevision: view.revision })).view.provider;
    }
    const badActive = view.profileId;
    const badInactive = view.profiles.find((profile: any) => profile.id !== valid && profile.id !== badActive && profile.label.startsWith('商汤'));
    await worker.evaluate(() => { globalThis.fetch = async () => new Response('<html>bad gateway</html>', { headers: { 'content-type': 'text/html' } }); });
    view = (await command({ type: 'provider.fetch', expectedRevision: view.revision })).view.provider;
    expect(view.status).toBe('protocol');
    for (const width of [320, 535, 720]) {
      await page.setViewportSize({ width, height: 800 });
      const card = page.locator('.provider-profile-card').filter({ has: page.getByRole('button', { name: `删除连接 ${view.profileLabel}`, exact: true }) });
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole('button', { name: /^删除连接/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`clean-connections-${width}.png`) });
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole('button', { name: `删除连接 ${badInactive.label}`, exact: true }).click();
    await expect.poll(async () => (await command({ type: 'provider.query' })).view.provider.profiles.some((p: any) => p.id === badInactive.id)).toBe(false);
    expect((await command({ type: 'provider.query' })).view.provider.profileId).toBe(badActive);
    await page.getByRole('button', { name: `删除连接 ${view.profileLabel}`, exact: true }).click();
    await expect(page.getByLabel('当前应用模型', { exact: true })).toHaveAttribute('data-value', `${valid}:deepseek-flash`);
    expect(await worker.evaluate(async () => JSON.stringify((await chrome.storage.local.get('vcamp.provider.v1'))['vcamp.provider.v1']).includes('SYNTHETIC_BAD_'))).toBe(false);
    await page.reload(); await expect(page.getByTestId('startup')).toHaveCount(0); await open();
    await expect(page.getByLabel('当前应用模型', { exact: true })).toHaveAttribute('data-value', `${valid}:deepseek-flash`);
    await page.locator('.settings-page').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath('clean-settings-360.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
