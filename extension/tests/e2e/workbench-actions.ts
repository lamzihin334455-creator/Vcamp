import {expect, type Page} from '@playwright/test';

export async function startNewChat(page: Page) {
  // Reload can display the header before its workspace snapshot is bound.
  // An editable draft proves the workspace/chat is ready; opening earlier
  // produces an empty menu that closes when the initial title arrives.
  await expect(page.getByLabel('输入草稿')).toBeEditable();
  await page.getByRole('button', {name: '切换当前内容', exact: true}).click();
  await page.getByRole('menuitem', {name: '新对话', exact: true}).click();
  await expect(page.getByLabel('输入草稿')).toBeEditable();
}
