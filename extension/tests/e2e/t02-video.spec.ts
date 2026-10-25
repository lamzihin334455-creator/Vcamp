import { chromium, expect, test } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('A/B/C installed production source with deterministic site: full read, drafts, SPA, retry, readonly and widths', async () => {
  test.setTimeout(90000);
  const output = resolve('../.tmp/t02-fixture');
  await mkdir(output, { recursive: true });
  const bundle = await mkdtemp(resolve(output, 'package-'));
  await cp(process.env.EXPERIENCE_BUNDLE ?? resolve('dist'), bundle, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(bundle, 'manifest.json'), 'utf8'));
  // Test-only permission grant. All bundled production JS/CSS bytes are unchanged.
  if (manifest.optional_host_permissions) { manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), ...manifest.optional_host_permissions])]; delete manifest.optional_host_permissions; }
  await writeFile(resolve(bundle, 'manifest.json'), JSON.stringify(manifest));
  const profile = await mkdtemp(resolve(output, 'profile-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`], viewport: { width: 360, height: 800 } });
  const samples: unknown[] = [];
  const errors: string[] = [];
  let mode = 'ready';
  try {
    await context.route('https://www.bilibili.com/video/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><title>T02 synthetic website</title><video></video><button id="p1" onclick="switchPart(1)">P1</button><button id="p2" onclick="switchPart(2)">P2</button><script>
      window.__INITIAL_STATE__={videoData:{bvid:'BVfixture',title:'同名视频',pages:[{page:1,cid:10,part:'同名'},{page:2,cid:20,part:'同名'}]}};
      window.player={getVideoMessage:()=>({bvid:'BVfixture',cid:Number(new URL(location.href).searchParams.get('p')||1)===1?10:20})};
      function switchPart(p){history.pushState({},'', '?p='+p);fetch('https://api.bilibili.com/x/player/wbi/v2?cid='+(p===1?10:20)+'&bvid=BVfixture&w_rid=fixture',{credentials:'include'});}
      switchPart(Number(new URL(location.href).searchParams.get('p')||1));
      </script>` }));
    await context.route('https://api.bilibili.com/**', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: mode === 'failure' ? -500 : 0, data: { need_login_subtitle: mode === 'login', subtitle: { subtitles: mode === 'no' ? [] : [{ lan: 'zh-CN', subtitle_url: 'https://aisubtitle.hdslb.com/fixture.json' }] } } }) }));
    await context.route('https://aisubtitle.hdslb.com/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ body: [{ from: 0, to: 2, content: 'SYNTHETIC-START' }, { from: 7198, to: 7200, content: 'SYNTHETIC-TAIL' }] }) });
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const panel = await context.newPage(); panel.on('pageerror', error => errors.push(error.message)); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const site = await context.newPage(); await site.goto('https://www.bilibili.com/video/BVfixture/?p=1');
    await site.bringToFront();
    const editor = panel.getByRole('textbox', { name: '输入草稿' });
    await expect(editor).toBeEnabled();
    await expect(panel.locator('.context-current-button .sr-only')).toHaveText('正在读取完整字幕…');
    await editor.fill('A-first');
    await expect(panel.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await expect(panel.getByRole('status')).toHaveText('草稿已保存');
    await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    const query = () => panel.evaluate(async () => (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } })).view);
    const a = await query(); expect(a.video.cues).toHaveLength(2); expect(a.video.cues[1].to).toBe(7200);
    const tab2 = await context.newPage(); await tab2.goto('https://www.bilibili.com/video/BVfixture/?p=1'); await tab2.bringToFront();
    const same = await query(); expect(same.workspaceId).toBe(a.workspaceId); expect(same.chatId).toBe(a.chatId); expect(same.video.binding.tabId).not.toBe(a.video.binding.tabId);
    const otherWindow = await panel.evaluate(tabId => chrome.windows.create({ tabId, focused: false }), same.video.binding.tabId);
    if (otherWindow?.id === undefined) throw new Error('Expected isolated browser window');
    await tab2.locator('#p2').click(); await site.bringToFront();
    const scoped = await panel.evaluate(async windowId => { let response; for (let attempt = 0; attempt < 30; attempt++) { response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId, operation: { type: 'workspace.query' } }); if (response.ok && response.view.video?.binding) return response.view; await new Promise(resolve => setTimeout(resolve, 100)); } return { diagnostic: response, tabs: await chrome.tabs.query({ windowId }) }; }, otherWindow.id);
    if (!scoped.video) console.log(JSON.stringify(scoped));
    expect(scoped.video.binding.partId).toBe('20'); expect(scoped.workspaceId).not.toBe(a.workspaceId);
    expect((await query()).workspaceId).toBe(a.workspaceId);
    await panel.evaluate(windowId => chrome.windows.remove(windowId!), otherWindow.id);
    await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    await expect(panel.getByText('SYNTHETIC-TAIL')).toBeVisible();
    for (const width of [320, 360, 420]) {
      await panel.setViewportSize({ width, height: 800 });
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await panel.screenshot({ path: resolve(output, `subtitles-${width}.png`) });
    }
    await panel.getByRole('navigation').getByRole('button', { name: '问答', exact: true }).click();
    // Delay an old snapshot after its real query, while new navigation/query completes.
    await panel.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      let first = true;
      chrome.runtime.sendMessage = (async (message: any) => {
        const response = await original(message);
        if (message.operation?.type === 'workspace.query' && first) { first = false; await new Promise(resolve => setTimeout(resolve, 1500)); }
        return response;
      }) as typeof chrome.runtime.sendMessage;
    });
    await editor.fill('A-pending');
    await site.locator('#p2').click();
    try { await expect(editor).toHaveValue(''); } catch (error) { console.log(JSON.stringify({ errors, url: site.url(), view: await query(), text: await panel.locator('body').innerText() })); throw error; }
    await editor.fill('B-draft');
    await expect(panel.getByRole('status')).toHaveText('草稿已保存');
    await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    const b = await query(); expect(b.workspaceId).not.toBe(a.workspaceId); expect(b.video.binding.documentId).toBe(a.video.binding.documentId);
    expect(b.video.binding.epoch).toBeGreaterThan(a.video.binding.epoch);
    await site.locator('#p1').click();
    await expect(editor).toHaveValue('A-pending');
    mode = 'no';
    await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    // Public command is the T02 retry entry, even when currently ready.
    await panel.evaluate(async () => { const view = (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'workspace.query' } })).view; await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'video.retry', binding: view.video.binding } }); });
    await expect.poll(async () => (await query()).video.status).toBe('no-subtitles');
    await expect(panel.getByText('当前视频无可用字幕，可在问答中使用自主识别画面。已有本地资料和草稿仍可访问。')).toBeVisible();
    await expect(panel.getByText('SYNTHETIC-TAIL')).toHaveCount(0);
    mode = 'failure'; await panel.getByRole('button', { name: '重新读取字幕' }).click();
    await expect.poll(async () => (await query()).video.status).toBe('read-failed');
    await expect(panel.getByRole('button', { name: '重新读取字幕' })).toBeVisible();
    mode = 'login'; await panel.getByRole('button', { name: '重新读取字幕' }).click();
    await expect.poll(async () => (await query()).video.status).toBe('auth-failed');
    await expect(panel.getByRole('button', { name: '重新读取字幕' })).toBeVisible();
    mode = 'ready'; await panel.getByRole('button', { name: '重新读取字幕' }).click();
    await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    const reader = await context.newPage(); await reader.goto(`chrome-extension://${id}/reader.html?workspaceId=${encodeURIComponent(a.workspaceId)}`);
    await reader.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    await expect(reader.getByText('SYNTHETIC-TAIL')).toHaveCount(0);
    const denied = await reader.evaluate(async binding => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'video.retry', binding } }), a.video.binding);
    expect(denied.code).toBe('forbidden');
    await site.bringToFront();
    const old = (await query()).video.binding;
    await site.reload(); await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    const refreshed = await query(); expect(refreshed.video.binding.documentId).not.toBe(old.documentId); expect(refreshed.workspaceId).toBe(a.workspaceId);
    const stale = await panel.evaluate(async binding => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'video.retry', binding } }), old); expect(stale.code).toBe('stale-binding');
    const storage = await panel.evaluate(async () => {
      const opened = indexedDB.open('vcamp'); const db = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
      const request = db.transaction('workspaces').objectStore('workspaces').getAll(); const records = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); }); db.close(); return JSON.stringify(records);
    });
    expect(storage).not.toContain('SYNTHETIC'); expect(storage).not.toContain('cues');
    samples.push({ a: { workspaceId: a.workspaceId, binding: a.video.binding }, sameMediaTab: same.video.binding, otherWindow: scoped.video.binding, b: { workspaceId: b.workspaceId, binding: b.video.binding }, refreshed: refreshed.video.binding, storageHasOriginal: false, widths: [320, 360, 420], permissionFixture: 'required hosts preserved; optional fixture origins granted when present; JS/CSS copied unchanged', dependency: 'synthetic website and HTTP track' });
    await writeFile(resolve(output, 'results.json'), JSON.stringify(samples, null, 2));
  } finally { await context.close(); }
});
