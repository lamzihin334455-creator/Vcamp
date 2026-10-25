import { chromium, expect, test } from '@playwright/test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

test('SPEC-01/02: unmount cancels active animation and delayed preview; remount starts clean', async () => {
  // A UI-only mount harness is needed because closing a browser page also destroys
  // its JS realm and cannot prove React component cleanup. No production entry added.
  const built = await build({ configFile: false, resolve: { alias: { '@provider-endpoint': resolve('src/generation/provider-endpoint.ts') } }, plugins: [react()], logLevel: 'silent',
    build: { write: false, minify: false, rollupOptions: {
      input: resolve('tests/e2e/lifecycle-harness.tsx'), output: { format: 'iife', inlineDynamicImports: true }
    } }
  });
  if (Array.isArray(built) || !('output' in built)) throw new Error('Unexpected harness build');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<button id="mount">Mount</button><button id="unmount">Unmount</button><div id="root"></div>');
    for (const output of built.output) {
      if (output.type === 'asset' && output.fileName.endsWith('.css')) await page.addStyleTag({ content: String(output.source) });
      if (output.type === 'chunk') await page.addScriptTag({ content: output.code });
    }
    await expect(page.getByRole('textbox')).toBeEnabled();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '收起侧栏' }).click();
    await page.mouse.move(358, 400);
    await expect(page.locator('.rail')).toHaveClass(/peeking/);
    await page.mouse.move(150, 400);
    await page.evaluate(() => {
      (document.querySelector('nav button[aria-label="笔记"]') as HTMLButtonElement).click();
    });
    await expect.poll(() => page.locator('main').evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
    await page.evaluate(() => {
      (window as any).unmountedMotion = document.querySelector('main')!.getAnimations()[0];
      document.getElementById('unmount')!.click();
    });
    expect(await page.evaluate(() => (window as any).unmountedMotion.playState)).toBe('idle');
    await page.waitForTimeout(400);
    await expect(page.locator('main')).toHaveCount(0);
    await page.locator('#mount').click();
    await expect(page.locator('main')).toHaveAttribute('data-module', 'chat');
    await expect(page.locator('.app-shell')).toHaveClass(/pinned/);
    await page.waitForTimeout(300);
    expect(await page.locator('main').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
});
