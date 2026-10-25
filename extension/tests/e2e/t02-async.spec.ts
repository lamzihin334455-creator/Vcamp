import { chromium, expect, test } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = (name: string) => `https://upos-synthetic.bilivideo.com/media/${name}.m4s`;
async function installed(inline: boolean, label: string) {
  const output = resolve(`../.tmp/t02-async/installed-${label}`); await mkdir(output, { recursive: true });
  const bundle = await mkdtemp(resolve(output, 'package-')); await cp(process.env.EXPERIENCE_BUNDLE ?? resolve('dist'), bundle, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(bundle, 'manifest.json'), 'utf8'));
  if (manifest.optional_host_permissions) { manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), ...manifest.optional_host_permissions])]; delete manifest.optional_host_permissions; }
  await writeFile(resolve(bundle, 'manifest.json'), JSON.stringify(manifest));
  const media = (await readFile(resolve('tests/fixtures/t02-synthetic.mp4'))).toString('base64');
  const context = await chromium.launchPersistentContext(await mkdtemp(resolve(output, 'profile-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`] });
  const external = { responseSource: source('A'), block: false, entered: false, requests: 0, release: () => {} };
  let gate = Promise.resolve();
  const block = () => { external.block = true; external.entered = false; gate = new Promise<void>(resolve => { external.release = () => { external.block = false; resolve(); }; }); };
  await context.route('https://www.bilibili.com/video/**', route => route.fulfill({ contentType: 'text/html', body: `<video muted playsinline></video>
    ${inline ? `<script>window.__playinfo__=${JSON.stringify({ code: 0, data: { dash: { video: [{ baseUrl: source('A') }] } } })}</script>` : ''}
    <script>
    window.__INITIAL_STATE__={videoData:{bvid:'BVfixture',title:'SYNTHETIC ASYNC',pages:[{page:2,cid:20,part:'P2'},{page:3,cid:30,part:'P3'}]}};
    window.cid=20;window.source='${source('A')}';
    window.player={getManifest:()=>({bvid:'BVfixture',cid:window.cid}),getMediaInfo:()=>({playUrl:window.source}),mediaElement:()=>document.querySelector('video')};
    document.querySelector('video').src='data:video/mp4;base64,${media}';
    fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BVfixture&cid=20');fetch('https://api.bilibili.com/x/player/wbi/v2?cid=20');
    </script>` }));
  await context.route('https://api.bilibili.com/**', async route => {
    const playurl = new URL(route.request().url()).pathname.endsWith('/playurl');
    if (playurl) { external.requests++; if (external.block && external.requests > 1) { external.entered = true; await gate; } }
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: 0, data: playurl ? { dash: { video: [{ baseUrl: external.responseSource }] } } : { subtitle: { subtitles: [] } } }) });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
  const site = await context.newPage();
  const query = () => panel.evaluate(async () => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } }));
  const seek = (binding: unknown) => panel.evaluate(async binding => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'video.seek', binding, time: 5, policy: 'preserve' } }), binding);
  const aba = () => site.evaluate(() => {
    const state = window as unknown as { cid: number };
    state.cid = 30; history.pushState({}, '', '?p=3'); state.cid = 20; history.pushState({}, '', '?p=2');
  });
  const ready = async () => { await expect.poll(async () => (await query()).view?.video?.status).toBe('no-subtitles'); return (await query()).view.video.binding; };
  return { context, site, panel, worker, query, seek, aba, ready, output, external, block };
}

test('FIX03 installed production: in-place pages mutation cannot cache a wrong association or seek the old decoder', async () => {
  const f = await installed(false, 'cache'); const evidence: unknown[] = []; let pass = false;
  try {
    f.block(); await f.site.goto('https://www.bilibili.com/video/BVfixture/?p=2'); await f.site.bringToFront();
    await expect.poll(() => f.external.entered).toBe(true);
    await f.site.evaluate(() => { (window as unknown as { __INITIAL_STATE__: { videoData: { pages: { cid: number }[] } } }).__INITIAL_STATE__.videoData.pages[0].cid = 30; });
    f.external.release();
    await expect.poll(async () => (await f.query()).view?.video?.binding).toBeNull();
    const cache = await f.site.evaluate(() => (window as unknown as { __vcampMediaPaths?: { cid: number }[] }).__vcampMediaPaths?.map(item => item.cid) ?? []);
    expect(cache).toEqual([]);
    await f.site.evaluate(() => {
      const state = window as unknown as { cid: number; __INITIAL_STATE__: { videoData: { pages: { cid: number }[] } } };
      state.__INITIAL_STATE__.videoData.pages[0].cid = 20; state.cid = 30; history.pushState({}, '', '?p=3');
      document.querySelector('video')!.currentTime = 3;
    });
    await expect.poll(async () => (await f.query()).view?.video?.binding).toBeNull();
    const invalid = { platform: 'bilibili', videoId: 'BVfixture', partId: '30', tabId: 1, documentId: 'not-a-capability', epoch: 1 };
    expect(await f.seek(invalid)).toMatchObject({ ok: false, code: 'stale-binding' });
    expect(await f.site.evaluate(() => document.querySelector('video')!.currentTime)).toBeCloseTo(3);
    evidence.push({ rejectedCache: cache, laterP3Binding: null, oldDecoderTime: 3 });
    // Paired stable response: return to P2; it can learn the correct association and seek.
    await f.site.evaluate(() => { (window as unknown as { cid: number }).cid = 20; history.pushState({}, '', '?p=2'); });
    const valid = await f.ready(); expect(await f.seek(valid)).toMatchObject({ ok: true });
    expect(await f.site.evaluate(() => document.querySelector('video')!.currentTime)).toBeCloseTo(5);
    evidence.push({ stablePart: valid.partId, seek: 5 }); pass = true;
  } finally { f.external.release(); await writeFile(resolve(f.output, 'results.json'), JSON.stringify({ pass, evidence, scope: 'installed production JS; only fixture host permissions, site inputs and transport are controlled' }, null, 2)); await f.context.close(); }
});

test('FIX03 installed production: proof and final transport ABA start zero native writes; controls recover', async () => {
  test.setTimeout(90000);
  const f = await installed(true, 'epoch'); const evidence: unknown[] = []; let pass = false;
  try {
    await f.site.goto('https://www.bilibili.com/video/BVfixture/?p=2'); await f.site.bringToFront(); await f.ready();
    // Wrap only Chrome's transport; the installed page/adapter/session/router code remains intact.
    await f.worker.evaluate(async () => {
      const hook = { mode: '', entered: false, confirmation: '', release: () => {} };
      (globalThis as unknown as { __transport: typeof hook }).__transport = hook;
      const original = chrome.scripting.executeScript.bind(chrome.scripting);
      chrome.scripting.executeScript = (async (options: chrome.scripting.ScriptInjection<unknown[], unknown>) => {
        const args = 'args' in options ? options.args : undefined;
        if (hook.mode.startsWith('quality-') && options.world === 'MAIN' && (args?.[0] as { platform?: string })?.platform === 'bilibili') {
          const name = hook.mode; hook.mode = '';
          await original({ target: options.target, world: 'MAIN', func: (name: string) => { (window as unknown as { source: string }).source = `https://upos-synthetic.bilivideo.com/media/${name}.m4s`; }, args: [name] });
        }
        if (hook.mode === 'commit' && options.world === 'ISOLATED' && args?.[0] === 'commit') {
          hook.mode = ''; hook.confirmation = String(args[2]); hook.entered = true; await new Promise<void>(resolve => { hook.release = resolve; });
        }
        return original(options);
      }) as typeof chrome.scripting.executeScript;
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await original({ target: { tabId: tab.id! }, world: 'ISOLATED', func: () => {
        const state = window as unknown as { __nativeWrites: number }; state.__nativeWrites = 0;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...descriptor, set(value: number) { state.__nativeWrites++; descriptor.set!.call(this, value); } });
      } });
    });
    const writes = () => f.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'ISOLATED', func: () => (window as unknown as { __nativeWrites: number }).__nativeWrites }); return result.result;
    });
    for (const scenario of ['quality-control', 'quality-ABA', 'commit-ABA', 'commit-traverse-ABA', 'commit-forged-ABA']) {
      const binding = await f.ready();
      await f.site.evaluate(() => { document.querySelector('video')!.pause(); document.querySelector('video')!.currentTime = 3; });
      const before = await writes();
      if (scenario.startsWith('quality')) { f.external.responseSource = source(scenario); f.block(); }
      await f.worker.evaluate(mode => { const hook = (globalThis as unknown as { __transport: { mode: string; entered: boolean } }).__transport; hook.mode = mode; hook.entered = false; }, scenario.startsWith('quality') ? scenario : 'commit');
      const pending = f.seek(binding);
      if (scenario.startsWith('quality')) await expect.poll(() => f.external.entered).toBe(true);
      else await expect.poll(() => f.worker.evaluate(() => (globalThis as unknown as { __transport: { entered: boolean } }).__transport.entered)).toBe(true);
      if (scenario === 'commit-traverse-ABA') {
        await f.site.evaluate(() => history.back()); await f.site.waitForURL('**/*p=3');
        await f.site.evaluate(() => history.forward()); await f.site.waitForURL('**/*p=2');
      } else if (scenario.endsWith('ABA')) await f.aba();
      if (scenario === 'commit-forged-ABA') {
        const token = await f.worker.evaluate(() => (globalThis as unknown as { __transport: { confirmation: string } }).__transport.confirmation);
        await f.site.evaluate(token => {
          (window as unknown as { __vcampSeekGuard: unknown }).__vcampSeekGuard = { revision: 0, pending: { token, valid: () => true } };
          document.addEventListener(token, event => event.preventDefault());
        }, token);
      }
      if (scenario.startsWith('quality')) f.external.release();
      else await f.worker.evaluate(() => (globalThis as unknown as { __transport: { release: () => void } }).__transport.release());
      const response = await pending, added = (await writes())! - before!;
      expect(response).toMatchObject(scenario.endsWith('ABA') ? { ok: false, code: 'stale-binding' } : { ok: true });
      expect(added).toBe(scenario.endsWith('ABA') ? 0 : 1);
      evidence.push({ scenario, addedNativeWrites: added, ok: response.ok, code: response.code ?? null });
      const fresh = await f.ready();
      expect(await f.seek(fresh)).toMatchObject({ ok: true });
    }
    await f.panel.screenshot({ path: resolve(f.output, 'recovered.png') }); pass = true;
  } finally { f.external.release(); await writeFile(resolve(f.output, 'results.json'), JSON.stringify({ pass, evidence, scope: 'installed production JS, real native video and navigation; external site/Chrome transport controls only' }, null, 2)); await f.context.close(); }
});
