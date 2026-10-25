import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixEvidence, installedPanel } from './fix-support';

test('STD-01: installed Worker without URL.canParse supports query, ready, save and reopen', async () => {
  const { context, page, worker, id, profile } = await installedPanel();
  try {
    await worker.evaluate(() => Object.defineProperty(URL, 'canParse', { configurable: true, value: undefined }));
    const result = await page.evaluate(async () => {
      const query = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'workspace.query' } });
      const port = chrome.runtime.connect({ name: 'vcamp-v1' });
      const ready = await new Promise<string>(resolve => {
        const timer = setTimeout(() => { resolve('timeout'); port.disconnect(); }, 3000);
        port.onMessage.addListener(message => { clearTimeout(timer); resolve(message.type); port.disconnect(); });
        port.onDisconnect.addListener(() => { void chrome.runtime.lastError; clearTimeout(timer); resolve('disconnected'); });
      });
      return { query, ready };
    });
    expect(result.query.ok).toBe(true);
    expect(result.ready).toBe('ready');
    await page.getByRole('textbox').fill('API 缺失时保存并恢复');
    await expect(page.getByRole('status')).toHaveText('草稿已保存');
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(reopened.getByRole('textbox')).toHaveValue('API 缺失时保存并恢复');
    const reader = await context.newPage();
    await reader.goto(`chrome-extension://${id}/reader.html?workspaceId=${encodeURIComponent(result.query.view.workspaceId)}`);
    const denied = await reader.evaluate(async () => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'draft.save', expectedRevision: 1, draft: {} } }));
    // Use a well-formed command: authorization must reject writes, not merely invalid input.
    const write = await reader.evaluate(async draft => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'draft.save', expectedRevision: 0, draft } }), result.query.view.draft);
    expect(write.code).toBe('forbidden');
    expect(denied.ok).toBe(false);
    await writeFile(resolve(fixEvidence, 'compatibility.json'), JSON.stringify({ browser: context.browser()?.version(), profile, missingAPI: 'URL.canParse set undefined in real extension Worker', query: result.query.ok, port: result.ready, savedAndReopened: true, readonlyWrite: write.code, limitation: 'API absence simulation, not Chrome 116-119 installation' }, null, 2));
  } finally { await context.close(); }
});
