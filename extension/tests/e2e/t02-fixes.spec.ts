import { chromium, expect, test } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('T02 FIX: service 403 has a working product retry with the exact binding', async () => {
  test.setTimeout(90000);
  const output = resolve('../.tmp/t02-fixes');
  await mkdir(output, { recursive: true });
  const bundle = await mkdtemp(resolve(output, 'package-'));
  await cp(process.env.EXPERIENCE_BUNDLE ?? resolve('dist'), bundle, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(bundle, 'manifest.json'), 'utf8'));
  // Only fixture permission grant differs. Production JS/CSS is unchanged.
  if (manifest.optional_host_permissions) { manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), ...manifest.optional_host_permissions])]; delete manifest.optional_host_permissions; }
  await writeFile(resolve(bundle, 'manifest.json'), JSON.stringify(manifest));
  const profile = await mkdtemp(resolve(output, 'profile-'));
  // Synthetic 8s decoded MP4 from the fixed 03 review probe, not site media.
  const media = (await readFile(resolve('tests/fixtures/t02-synthetic.mp4'))).toString('base64');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`], viewport: { width: 360, height: 800 } });
  let mode = 'ready', metadataRequests = 0, trackRequests = 0, pass = false;
  const evidence: unknown[] = [];
  try {
    await context.route('https://www.bilibili.com/video/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><video muted playsinline></video><script>
      window.__INITIAL_STATE__={videoData:{bvid:'BVfixture',title:'SYNTHETIC FIX',pages:[{page:1,cid:10,part:'P1'},{page:2,cid:20,part:'P2'}]}};
      window.decodedCid=10;window.player={getVideoMessage:()=>({bvid:'BVfixture',cid:window.decodedCid})};
      document.querySelector('video').src='data:video/mp4;base64,${media}';
      window.switchPart=()=>{history.pushState({},'', '?p=2');fetch('https://api.bilibili.com/x/player/wbi/v2?cid=20');};
      fetch('https://api.bilibili.com/x/player/wbi/v2?cid=10');
      </script>` }));
    await context.route('https://api.bilibili.com/**', route => {
      metadataRequests++;
      return route.fulfill({ status: mode === 'metadata403' ? 403 : 200, contentType: mode === 'metadata403' ? 'text/html' : 'application/json', headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: mode === 'metadata403' ? '<p>SYNTHETIC service denied</p>' : JSON.stringify({ code: 0, data: { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: 'https://aisubtitle.hdslb.com/synthetic-fix.json' }] } } }) });
    });
    await context.route('https://aisubtitle.hdslb.com/**', route => {
      trackRequests++;
      return route.fulfill({ status: mode === 'cdn403' ? 403 : 200, contentType: mode === 'cdn403' ? 'text/html' : 'application/json', headers: { 'access-control-allow-origin': '*' }, body: mode === 'cdn403' ? '<p>SYNTHETIC service denied</p>' : JSON.stringify({ body: [{ from: 1, to: 2, content: 'SYNTHETIC ONE' }, { from: 5, to: 6, content: 'SYNTHETIC FIVE' }] }) });
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const site = await context.newPage(); await site.goto('https://www.bilibili.com/video/BVfixture/'); await site.bringToFront();
    await expect.poll(() => site.evaluate(() => document.querySelector('video')!.duration)).toBe(8);
    await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    const query = () => panel.evaluate(async () => (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } })).view);
    const original = await query();
    await panel.getByRole('textbox', { name: '输入草稿' }).fill('SYNTHETIC retained local draft');
    await expect(panel.getByRole('status')).toHaveText('草稿已保存');
    await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    for (const failure of ['metadata403', 'cdn403']) {
      mode = failure;
      await panel.evaluate(async binding => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'video.retry', binding } }), original.video.binding);
      await expect.poll(async () => (await query()).video.status).toBe('permission-denied');
      const before = { metadataRequests, trackRequests };
      mode = 'ready';
      await expect(panel.getByRole('button', { name: '重新读取字幕' })).toBeVisible();
      await expect(panel.getByRole('button', { name: '授权读取 B 站' })).toHaveCount(0);
      await panel.getByRole('button', { name: '重新读取字幕' }).click();
      await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
      expect((await query()).video.binding).toEqual(original.video.binding);
      expect(metadataRequests).toBeGreaterThan(before.metadataRequests);
      expect(trackRequests).toBeGreaterThan(before.trackRequests);
      evidence.push({ id: 'SPEC-T02-02', failure, before, after: { metadataRequests, trackRequests }, status: 'ready', binding: original.video.binding });
    }
    const state = () => site.evaluate(() => ({ time: document.querySelector('video')!.currentTime, paused: document.querySelector('video')!.paused }));
    await site.evaluate(() => { const video = document.querySelector('video')!; video.pause(); video.currentTime = 3; });
    await expect.poll(() => site.evaluate(() => document.querySelector('video')!.seeking)).toBe(false);
    await panel.getByRole('button', { name: '跳转到 00:01' }).click();
    await expect.poll(async () => Math.abs((await state()).time - 1) < 0.1).toBe(true);
    expect((await state()).paused).toBe(true);
    await site.evaluate(async () => { const video = document.querySelector('video')!; video.currentTime = 2; await video.play(); });
    await panel.getByRole('button', { name: '跳转到 00:05' }).click();
    await expect.poll(async () => { const value = await state(); return value.time >= 5 && value.time < 6 && !value.paused; }).toBe(true);
    evidence.push({ id: 'STD-T02-01', normalTimeButtons: 'paused and playing pass', after: await state() });
    await site.evaluate(() => { const video = document.querySelector('video')!; video.pause(); video.currentTime = 3; (window as any).switchPart(); });
    for (const identity of ['missing-player', 'missing-cid', 'old-cid']) {
      await site.evaluate(kind => { (window as any).player = kind === 'missing-player' ? undefined : { getVideoMessage: () => kind === 'missing-cid' ? {} : { bvid: 'BVfixture', cid: 10 } }; }, identity);
      const local = await query();
      expect(local.workspaceId).toBeNull(); expect(local.draft).toBeNull(); expect(local.video.binding).toBeNull(); expect(local.video.cues).toEqual([]);
      const rejected = await panel.evaluate(async binding => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'video.seek', binding: { ...binding, partId: '20' }, time: 1, policy: 'preserve' } }), original.video.binding);
      expect(rejected.code).toBe('stale-binding'); expect((await state()).time).toBeCloseTo(3, 1);
      await expect(panel.locator('.subtitle-time')).toHaveCount(0);
      evidence.push({ id: 'STD-T02-01', identity, rejected: rejected.code, oldDecoderTime: (await state()).time });
    }
    await site.evaluate(() => {
      (window as any).player = { getManifest: () => ({ bvid: 'BVfixture', cid: 20 }), mediaElement: () => document.querySelector('video'), getMediaInfo: () => ({ playUrl: 'https://upos-synthetic.bilivideo.com/10-1-30080.m4s' }) };
    });
    expect((await query()).video.binding).toBeNull();
    expect((await state()).time).toBeCloseTo(3, 1);
    evidence.push({ id: 'STD-T02-01', identity: 'new manifest cid20 with old decoded source cid10', liveBinding: null, oldDecoderTime: (await state()).time });
    await panel.getByRole('navigation').getByRole('button', { name: '问答', exact: true }).click();
    const editor = panel.getByRole('textbox', { name: '输入草稿' });
    await expect(editor).toBeDisabled();
    expect((await query()).workspaceId).toBeNull();
    await site.evaluate(() => { (window as any).player = { getManifest: () => ({ bvid: 'BVfixture', cid: 20 }), mediaElement: () => document.querySelector('video'), getMediaInfo: () => ({ playUrl: 'https://upos-synthetic.bilivideo.com/20-1-30080.m4s' }) }; });
    await expect.poll(async () => (await query()).video?.binding?.partId).toBe('20');
    await expect(editor).toHaveValue('');
    const newPart = await query(); expect(newPart.workspaceId).not.toBe(original.workspaceId);
    evidence.push({ id: 'SPEC-T02-01', retained: original.workspaceId, confirmedNewPart: newPart.workspaceId });
    // A real injection failure, then same-source recovery: exercise actual worker/router/UI.
    await worker.evaluate(() => {
      const original = chrome.scripting.executeScript.bind(chrome.scripting);
      (globalThis as any).fixInspectFailure = true;
      (globalThis as any).fixOriginalExecute = original;
      // Match the current MAIN-world inspectMedia call by its three proof arguments.
      chrome.scripting.executeScript = (async (options: any) => { if ((globalThis as any).fixInspectFailure && options.world === 'MAIN' && options.args?.length === 3 && options.args[0] === null && options.args[1] === null) throw new Error('SYNTHETIC transient inspection'); return original(options); }) as typeof chrome.scripting.executeScript;
    });
    const inaccessible = await query();
    expect(inaccessible.video.binding).toBeNull(); expect(inaccessible.video.status).toBe('read-failed');
    await worker.evaluate(() => { chrome.scripting.executeScript = (globalThis as any).fixOriginalExecute; });
    await expect.poll(async () => (await query()).video?.binding?.partId).toBe('20');
    expect((await query()).workspaceId).toBe(newPart.workspaceId);
    await site.evaluate(() => { history.pushState({}, '', '?p=1'); (window as any).player = { getVideoMessage: () => ({ bvid: 'BVfixture', cid: 10 }) }; });
    await expect(editor).toHaveValue('SYNTHETIC retained local draft');
    await panel.screenshot({ path: resolve(output, 'retained-local.png') });
    pass = true;
  } finally {
    await writeFile(resolve(output, 'results.json'), JSON.stringify({ pass, boundary: 'synthetic site/network; real decoded HTMLVideoElement; unchanged production JS/CSS; fixture-only required hosts', evidence }, null, 2));
    await context.close();
  }
});
