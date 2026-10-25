import {expect, test} from '@playwright/test';
import {setup} from './interaction-fixture';
import {startNewChat} from './workbench-actions';

test('new conversation waits for the reloaded workspace instead of opening an unbound menu', async () => {
  test.setTimeout(30_000);
  const {context, page, site, fixture} = await setup();
  try {
    await page.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      let held = true;
      const waiting: Array<() => void> = [];
      (window as any).releaseWorkspace = () => {
        held = false;
        waiting.splice(0).forEach(release => release());
      };
      chrome.runtime.sendMessage = (async (message: any) => {
        const result = await send(message);
        if (held && message.operation?.type === 'workspace.query') {
          await new Promise<void>(resolve => waiting.push(resolve));
        }
        return result;
      }) as typeof chrome.runtime.sendMessage;
    });
    await page.reload();
    await site.bringToFront();
    await expect(page.getByLabel('输入草稿')).toBeDisabled();
    // Reproduce a delayed initial snapshot without slowing or changing product code.
    await page.evaluate(() => { setTimeout(() => (window as any).releaseWorkspace(), 1500); });
    await startNewChat(page);
    await expect(page.getByLabel('输入草稿')).toHaveValue('');
    await expect(page.locator('.chat-turn')).toHaveCount(0);
    const reply = await page.evaluate(() => chrome.runtime.sendMessage({
      version: 1, requestId: crypto.randomUUID(), operation: {type: 'workspace.query'},
    }));
    expect(reply.ok).toBe(true);
    expect(reply.view.workspaceId).toBe(fixture.workspaceId);
    expect(reply.view.chatId).not.toBe(fixture.chatId);
  } finally {
    await context.close();
  }
});
