import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';

export const fixEvidence = resolve('../.tmp/fix01');
export async function installedPanel() {
  await mkdir(fixEvidence, { recursive: true });
  await mkdir(resolve('.profiles'), { recursive: true });
  const profile = await mkdtemp(resolve('.profiles/Fix01-'));
  const extension = resolve('dist-test');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 360, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await expect(page.getByRole('textbox')).toBeEnabled();
  await page.waitForTimeout(300);
  return { context, page, worker, id, profile };
}
