import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixEvidence, installedPanel } from './fix-support';

test('FIX regression: UI failure/retry, real revision conflict and fixed reader after tab/window changes', async () => {
  const { context, page, id } = await installedPanel();
  try {
    const editor = page.getByRole('textbox');
    await page.evaluate(() => {
      const raw = chrome.runtime.sendMessage.bind(chrome.runtime);
      (window as any).raw = raw;
      let fail = true;
      chrome.runtime.sendMessage = (async (message: any) => {
        if (message.operation?.type === 'draft.save' && fail) {
          fail = false;
          return { version: 1, requestId: message.requestId, ok: false, code: 'storage-failed' };
        }
        return raw(message);
      }) as typeof chrome.runtime.sendMessage;
    });
    await editor.fill('失败后保留');
    await expect(page.getByRole('status')).toHaveText('未保存');
    await page.getByRole('navigation').getByRole('button', { name: '笔记', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-module', 'chat');
    await expect(editor).toHaveValue('失败后保留');
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('草稿已保存');
    await page.evaluate(() => {
      let held = false;
      chrome.runtime.sendMessage = (async (message: any) => {
        if (!held && message.operation?.type === 'draft.save') {
          held = true;
          await new Promise<void>(resolve => { (window as any).releaseWrite = resolve; });
        }
        return (window as any).raw(message);
      }) as typeof chrome.runtime.sendMessage;
    });
    await editor.fill('本地尚未保存');
    await expect.poll(() => page.evaluate(() => Boolean((window as any).releaseWrite))).toBe(true);
    const other = await context.newPage();
    await other.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(other.getByRole('textbox')).toHaveValue('失败后保留');
    await other.getByRole('textbox').fill('另一编辑者已保存');
    await expect(other.getByRole('status')).toHaveText('草稿已保存');
    await page.evaluate(() => (window as any).releaseWrite());
    await expect(page.getByRole('alert')).toContainText('另一窗口已保存新草稿');
    await expect(editor).toHaveValue('本地尚未保存');
    await page.getByRole('button', { name: '重新载入', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await expect(editor).toHaveValue('本地尚未保存');
    await page.getByRole('button', { name: '重新载入', exact: true }).click();
    await page.getByRole('button', { name: '已保留文字，载入已保存草稿' }).click();
    await expect(editor).toHaveValue('另一编辑者已保存');
    const view = await other.evaluate(async () => (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'workspace.query' } })).view);
    const reader = await context.newPage();
    await reader.goto(`chrome-extension://${id}/reader.html?workspaceId=${encodeURIComponent(view.workspaceId)}`);
    await expect(reader.locator('.context-current-button')).toContainText('只读资料');
    await page.bringToFront();
    const newWindow = await other.evaluate(async () => (await chrome.windows.create({ url: 'about:blank', focused: true }))?.id);
    const readerView = await reader.evaluate(async draft => {
      const query = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'workspace.query' } });
      const write = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'draft.save', expectedRevision: 0, draft } });
      return { query, write };
    }, view.draft);
    expect(readerView.query.view.workspaceId).toBe(view.workspaceId);
    expect(readerView.query.view.draft).toBeNull();
    expect(readerView.write.code).toBe('forbidden');
    if (newWindow !== undefined) await other.evaluate(windowId => chrome.windows.remove(windowId), newWindow);
    await writeFile(resolve(fixEvidence, 'failure-recovery.json'), JSON.stringify({ storageFailure: 'one injected transport storage-failed response; not disk damage', retry: 'pass', revisionConflict: 'two actual extension page clients, first write delayed before transport; real IndexedDB conflict', cancelReload: 'local input preserved', confirmReload: 'saved input restored', reader: 'fixed workspace preserved across active tab and new browser window; writes forbidden', actualVideoBinding: 'not in T01' }, null, 2));
  } finally { await context.close(); }
});
