import { expect, test } from '@playwright/test';
import { setup } from './interaction-fixture';

test('saved role preferences display their frozen name after preset upgrade, edit and deletion', async () => {
  const { context, page, site } = await setup();
  try {
    const command = (operation: any) => page.evaluate(async operation => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation }), operation);
    const storedRole = () => page.evaluate(async () => (await chrome.storage.local.get('vcamp.activeRole'))['vcamp.activeRole']);
    const chooseSavedPreference = async (selection: { roleId: string; revisionId: string }) => {
      await page.evaluate(selection => chrome.storage.local.set({ 'vcamp.activeRole': selection }), selection);
      await page.reload(); await site.bringToFront();
      await expect(page.getByLabel('输入草稿')).toBeEnabled();
      await page.getByRole('button', { name: '设置', exact: true }).click();
    };
    const expectFrozenPreference = async (selection: { roleId: string; revisionId: string }) => {
      expect(await storedRole()).toEqual(selection);
      await expect.poll(async () => (await command({ type: 'workspace.query' })).view.draft.role).toEqual(selection);
    };

    const oldPreset = { roleId: 'role-professor', revisionId: 'role-professor:v1' };
    const presets = await command({ type: 'role.query', selected: oldPreset });
    expect(presets.ok).toBe(true);
    expect(presets.view.roles.roles.find((role: any) => role.id === oldPreset.roleId).revisionId).toBe('role-professor:v2');
    await chooseSavedPreference(oldPreset);
    await expect(page.locator('.quick-role-trigger small')).toHaveText('老教授（历史版本）');
    await expectFrozenPreference(oldPreset);

    const created = await command({ type: 'role.create', fields: { name: '原先的角色名', description: '', instructions: '保持已保存的旧表达指令' } });
    expect(created.ok).toBe(true);
    const role = created.view.roles.roles.find((role: any) => role.name === '原先的角色名');
    const original = { roleId: role.id, revisionId: role.revisionId };
    await chooseSavedPreference(original);
    await expect(page.locator('.quick-role-trigger small')).toHaveText('原先的角色名');
    const edited = await command({ type: 'role.save', roleId: role.id, expectedRevision: role.revision, fields: { name: '后来修改的角色名', description: '', instructions: '这是新版本，不得代替已选版本' } });
    expect(edited.ok).toBe(true);
    await expect(page.locator('.quick-role-trigger small')).toHaveText('原先的角色名（历史版本）');
    await expectFrozenPreference(original);

    const latest = edited.view.roles.roles.find((candidate: any) => candidate.id === role.id);
    const deleted = await command({ type: 'role.delete', roleId: role.id, expectedRevision: latest.revision });
    expect(deleted.ok).toBe(true);
    expect(deleted.view.roles.roles.some((candidate: any) => candidate.id === role.id)).toBe(false);
    await page.reload(); await site.bringToFront();
    await expect(page.getByLabel('输入草稿')).toBeEnabled();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.locator('.quick-role-trigger small')).toHaveText('原先的角色名（历史版本）');
    await expectFrozenPreference(original);
    const historical = await command({ type: 'role.query', selected: original });
    expect(historical.view.roles.revisions[0]).toMatchObject({ ...original, name: '原先的角色名', instructions: '保持已保存的旧表达指令' });
  } finally { await context.close(); }
});
