import { chromium, expect, test } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('QA-T02-01: unprefixed initial/SPA sources bind, old decoded source is rejected, refresh rejects old document', async () => {
  test.setTimeout(90000);
  const output = resolve('../.tmp/t02-formats'); await mkdir(output, { recursive: true });
  const bundle = await mkdtemp(resolve(output, 'package-')); await cp(process.env.EXPERIENCE_BUNDLE ?? resolve('dist'), bundle, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(bundle, 'manifest.json'), 'utf8'));
  if (manifest.optional_host_permissions) { manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), ...manifest.optional_host_permissions])]; delete manifest.optional_host_permissions; }
  await writeFile(resolve(bundle, 'manifest.json'), JSON.stringify(manifest));
  const media = (await readFile(resolve('tests/fixtures/t02-synthetic.mp4'))).toString('base64');
  const context = await chromium.launchPersistentContext(await mkdtemp(resolve(output, 'profile-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`], viewport: { width: 360, height: 800 } });
  const source = (cid: number) => `https://upos-synthetic.bilivideo.com/media/opaque-${cid === 20 ? 'A' : 'B'}.m4s`;
  const evidence: unknown[] = []; let pass = false;
  try {
    await context.route('https://www.bilibili.com/video/**', route => {
      const cid = new URL(route.request().url()).searchParams.get('p') === '3' ? 30 : 20;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><video muted playsinline></video>
        <script>window.__playinfo__=${JSON.stringify({ code: 0, data: { dash: { video: [{ baseUrl: source(cid) + '?SYNTHETIC_SIGNATURE' }] } } })}</script>
        <script>
        window.__INITIAL_STATE__={videoData:{bvid:'BVfixture',title:'SYNTHETIC FORMATS',pages:[{page:2,cid:20,part:'P2'},{page:3,cid:30,part:'P3'}]}};
        window.cid=${cid};window.source='${source(cid)}';
        window.player={getManifest:()=>({bvid:'BVfixture',cid:window.cid}),getMediaInfo:()=>({playUrl:window.source}),mediaElement:()=>document.querySelector('video')};
        window.complete=()=>{window.source='${source(30)}';document.querySelector('video').src='data:video/mp4;base64,${media}#B';fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BVfixture&cid=30');};
        document.querySelector('video').src='data:video/mp4;base64,${media}';
        fetch('https://api.bilibili.com/x/player/wbi/v2?cid=${cid}');
        </script><button onclick="history.pushState({},'', '?p=3');window.cid=30;fetch('https://api.bilibili.com/x/player/wbi/v2?cid=30')">新元数据</button><button onclick="window.complete()">完成换源</button>` });
    });
    await context.route('https://api.bilibili.com/**', route => {
      const url = new URL(route.request().url()), cid = Number(url.searchParams.get('cid'));
      const data = url.pathname.endsWith('/playurl') ? { dash: { video: [{ baseUrl: source(cid) + '?SYNTHETIC_FRESH_SIGNATURE' }] } } : { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: 'https://aisubtitle.hdslb.com/synthetic-formats.json' }] } };
      return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: 0, data }) });
    });
    await context.route('https://aisubtitle.hdslb.com/**', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ body: [{ from: 1, to: 2, content: 'SYNTHETIC ONE' }, { from: 5, to: 6, content: 'SYNTHETIC FIVE' }] }) }));
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    const site = await context.newPage(); await site.goto('https://www.bilibili.com/video/BVfixture/?p=2'); await site.bringToFront();
    const query = () => panel.evaluate(async () => (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } })).view);
    const seek = (binding: unknown) => panel.evaluate(async binding => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'video.seek', binding, time: 1, policy: 'preserve' } }), binding);
    await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    const p2 = await query(); expect(p2.video.binding.partId).toBe('20');
    await panel.getByRole('textbox', { name: '输入草稿' }).fill('SYNTHETIC P2 LOCAL'); await expect(panel.getByRole('status')).toHaveText('草稿已保存');
    await site.evaluate(() => { const video = document.querySelector('video')!; video.pause(); video.currentTime = 3; });
    await site.getByRole('button', { name: '新元数据' }).click();
    await expect.poll(async () => (await query()).video.binding).toBeNull();
    const transition = await query(); expect(transition.workspaceId).toBeNull(); expect(transition.draft).toBeNull();
    const retained = await panel.evaluate(async id => { const db = await new Promise<IDBDatabase>((resolve, reject) => { const request=indexedDB.open('vcamp'); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); }); const row=await new Promise<any>((resolve,reject)=>{ const request=db.transaction('workspaces').objectStore('workspaces').get(id); request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error); }); db.close(); return row; }, p2.workspaceId);
    expect(retained.chats.find((chat: any) => chat.id === p2.chatId).draft.text).toBe('SYNTHETIC P2 LOCAL');
    expect((await seek(p2.video.binding)).code).toBe('stale-binding'); expect(await site.evaluate(() => document.querySelector('video')!.currentTime)).toBeCloseTo(3);
    evidence.push({ stage: 'new-metadata-old-unprefixed-source', binding: transition.video.binding, localRetained: true, oldTime: 3 });
    await site.getByRole('button', { name: '完成换源' }).click();
    await expect.poll(async () => (await query()).video.status).toBe('ready');
    const p3 = await query(); expect(p3.video.binding.partId).toBe('30'); expect(p3.workspaceId).not.toBe(p2.workspaceId); expect(p3.video.binding.documentId).toBe(p2.video.binding.documentId); expect(p3.draft.text).toBe('');
    await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    for (const paused of [true, false]) {
      await site.evaluate(async paused => { const video = document.querySelector('video')!; video.currentTime = paused ? 3 : 2; if (paused) video.pause(); else await video.play(); }, paused);
      const target = paused ? 1 : 5;
      await panel.getByRole('button', { name: paused ? '跳转到 00:01' : '跳转到 00:05' }).click();
      await expect.poll(() => site.evaluate(target => Math.abs(document.querySelector('video')!.currentTime - target), target)).toBeLessThan(0.75);
      expect(await site.evaluate(() => document.querySelector('video')!.paused)).toBe(paused);
      evidence.push({ stage: 'unprefixed-seek-product-button', target, paused });
    }
    await site.evaluate(() => document.querySelector('video')!.pause());
    await panel.screenshot({ path: resolve(output, 'unprefixed-ready.png') });
    await site.reload(); await expect.poll(async () => (await query()).video.status).toBe('ready');
    const refreshed = await query(); expect(refreshed.workspaceId).toBe(p3.workspaceId); expect(refreshed.video.binding.documentId).not.toBe(p3.video.binding.documentId); expect((await seek(p3.video.binding)).code).toBe('stale-binding');
    evidence.push({ stage: 'direct-initial-P3-refresh', partId: refreshed.video.binding.partId, oldDocumentRejected: true });
    pass = true;
  } finally { await writeFile(resolve(output, 'results.json'), JSON.stringify({ pass, evidence, fixture: 'synthetic only, formal JS/CSS, required fixture hosts, 8s decoded MP4' }, null, 2)); await context.close(); }
});
