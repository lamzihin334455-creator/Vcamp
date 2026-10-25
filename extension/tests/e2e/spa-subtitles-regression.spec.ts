import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

for (const scenario of ['mirror', 'full-resource-buffer', 'refresh']) test(`season navigation reads complete subtitles: ${scenario}`, async () => {
  const refresh = scenario === 'refresh';
  const bundle = resolve(process.env.VCAMP_SPA_BUNDLE ?? 'dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--load-extension=${bundle}`, `--disable-extensions-except=${bundle}`]
  });
  try {
    await context.route('https://www.bilibili.com/video/**', route => {
      const initialPath = route.request().url().includes('BV1aBAfzVEEm') ? '/upgcxcode/37/84/36427598437/36427598437_qe1-1-30011.m4s' : '/upgcxcode/84/03/35374040384/35374040384-1-100022.m4s';
      const inline = JSON.stringify({ code: 0, data: { dash: { video: [{ baseUrl: `https://upos-sz-mirrorhwo1.bilivideo.com${initialPath}` }] } } });
      return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta charset="utf-8"><video></video><button id="next">下一集</button><script>
        const media=document.querySelector('video');let live;
        const paths={A:'/upgcxcode/84/03/35374040384/35374040384-1-100022.m4s',B:'/upgcxcode/37/84/36427598437/36427598437_qe1-1-30011.m4s'};
        const source=key=>'https://upos-sz-mirrorhwo1.bilivideo.com'+paths[key];
        Object.defineProperty(media,'readyState',{get:()=>4});
        Object.defineProperty(media,'duration',{get:()=>785});
        Object.defineProperty(media,'currentSrc',{get:()=> 'blob:https://www.bilibili.com/season-decoder'});
        window.player={getManifest:()=>({bvid:live.bvid,cid:live.cid}),mediaElement:()=>media,getMediaInfo:()=>({playUrl:source(live.key)})};
        function apply(key){const bvid=key==='A'?'BV1Y3rHBSE1n':'BV1aBAfzVEEm',cid=key==='A'?35374040384:36427598437;live={key,bvid,cid};window.__INITIAL_STATE__={videoData:{bvid,title:'视频 '+key,pages:[{page:1,cid,part:key}]}};fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid='+bvid+'&cid='+cid);fetch('https://api.bilibili.com/x/player/wbi/v2?cid='+cid);}
        apply(location.pathname.includes('BV1aBAfzVEEm')?'B':'A');
        window.addEventListener('popstate',()=>apply(location.pathname.includes('BV1aBAfzVEEm')?'B':'A'));
        document.querySelector('#next').onclick=()=>{history.pushState({},'','/video/BV1aBAfzVEEm');apply('B');};
        </script><script>window.__playinfo__=${inline};</script>`
      });
    });
    await context.route('https://api.bilibili.com/**', route => {
      const url = new URL(route.request().url()), cid = url.searchParams.get('cid');
      const data = url.pathname.endsWith('/playurl')
        ? { dash: { video: [{ baseUrl: 'https://upos-sz-mirrorhw.bilivideo.com/upgcxcode/37/84/36427598437/36427598437_qe1-1-30011.m4s' }] } }
        : { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: `https://aisubtitle.hdslb.com/spa-${cid}.json` }] } };
      return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: 0, data }) });
    });
    await context.route('https://aisubtitle.hdslb.com/**', route => route.fulfill({
      contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ body: [{ from: 0, to: 2, content: route.request().url().includes('36427598437') ? '新视频完整字幕' : '旧视频完整字幕' }] })
    }));
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    const site = await context.newPage();
    await site.goto('https://www.bilibili.com/video/BV1Y3rHBSE1n/');
    await site.bringToFront();
    const query = () => panel.evaluate(async () => (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } })).view);
    await expect.poll(async () => (await query())?.video?.status).toBe('ready');
    const original = (await query()).video.binding;
    await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    await expect(panel.getByText('旧视频完整字幕', { exact: true })).toBeVisible();
    if (scenario === 'full-resource-buffer') await site.evaluate(() => performance.setResourceTimingBufferSize(performance.getEntriesByType('resource').length));
    await site.locator('#next').click();
    if (refresh) await site.reload();
    await expect.poll(async () => {
      const view = await query();
      return { title: view?.title, videoId: view?.video?.binding?.videoId, status: view?.video?.status, cue: view?.video?.cues?.[0]?.content };
    }, { timeout: 5000, intervals: [50, 100, 250] }).toEqual({ title: '视频 B', videoId: 'BV1aBAfzVEEm', status: 'ready', cue: '新视频完整字幕' });
    const current = (await query()).video.binding;
    if (refresh) expect(current.documentId).not.toBe(original.documentId);
    else expect(current.documentId).toBe(original.documentId);
    expect(current.epoch).toBeGreaterThan(original.epoch);
    // Module selection is local to a workspace; the new workspace opens Chat.
    await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    await expect(panel.getByText('新视频完整字幕', { exact: true })).toBeVisible();
    await expect(panel.getByText('旧视频完整字幕', { exact: true })).toHaveCount(0);
    const stale = await panel.evaluate(async binding => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'video.retry', binding } }), original);
    expect(stale).toMatchObject({ ok: false, code: 'stale-binding' });
    await site.goBack();
    await expect.poll(async () => (await query())?.video?.cues?.[0]?.content).toBe('旧视频完整字幕');
    await site.goForward();
    await expect.poll(async () => (await query())?.video?.cues?.[0]?.content).toBe('新视频完整字幕');
  } finally { await context.close(); }
});
