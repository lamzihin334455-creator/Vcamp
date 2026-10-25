// Run from extension/. Uses only an isolated test profile, never a personal profile.
// Optional: VCAMP_SPA_PACKAGE, VCAMP_SPA_PROFILE, VCAMP_SPA_OUTPUT.
// With --wait-login, log in and create <output>/continue before testing starts.
// --watch-stability --observation-pressure also stresses live observation notifications.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const bundle = resolve(process.env.VCAMP_SPA_PACKAGE ?? 'dist');
const profile = resolve(process.env.VCAMP_SPA_PROFILE ?? '../.tmp/spa-login-profile');
const output = resolve(process.env.VCAMP_SPA_OUTPUT ?? '../.tmp/spa-subtitles-real');
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(bundle, 'manifest.json'), 'utf8'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: false, viewport: null,
  args: [`--load-extension=${bundle}`, `--disable-extensions-except=${bundle}`, '--window-size=1400,950']
});
const result = { date: new Date().toISOString(), version: manifest.version, package: bundle, stages: [], pass: false };
const network = [], navigations = [];
let panel, site;
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
  result.runtimeVersion=await panel.evaluate(()=>chrome.runtime.getManifest().version);
  site = await context.newPage();
  site.on('framenavigated', frame => { if (frame === site.mainFrame()) navigations.push(new URL(frame.url()).pathname); });
  site.on('request', request => {
    const u = new URL(request.url());
    if (u.origin === 'https://api.bilibili.com' && /playurl|\/v2$|view\/detail/.test(u.pathname)) network.push({ path: u.pathname, bvid: u.searchParams.get('bvid'), avid: u.searchParams.get('avid'), aid: u.searchParams.get('aid'), cid: u.searchParams.get('cid') });
  });
  await site.goto('https://www.bilibili.com/video/BV1Y3rHBSE1n/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await site.bringToFront();
  if (process.argv.includes('--wait-login')) {
    console.log('LOGIN_READY: log in, then create the continue marker in the output directory.');
    while (true) {
      try { await access(resolve(output, 'continue')); break; }
      catch { await new Promise(r => setTimeout(r, 1000)); }
    }
  }
  const query = () => panel.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } });
    const view = response.view, video = view?.video;
    return { ok: response.ok, title: view?.title, binding: video?.binding, status: video?.status, cueCount: video?.cues?.length, lastEnd: video?.cues?.at(-1)?.to };
  });
  const wait = async (stage, videoId, partId) => {
    const deadline = Date.now() + 25000;
    let view;
    while (Date.now() < deadline) {
      view = await query();
      if (view.binding?.videoId === videoId && view.binding?.partId === partId && view.status === 'ready' && view.cueCount > 0) {
        result.stages.push({ stage, ...view });
        console.log(stage, JSON.stringify(view));
        return view;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    result.stages.push({ stage, ...view });
    assert.fail(`${stage}: expected ready subtitles for ${videoId}/${partId}; received ${JSON.stringify(view)}`);
  };
  const initial = await wait('initial-A', 'BV1Y3rHBSE1n', '35374040384');
  if (process.argv.includes('--watch-stability')) {
    if (process.argv.includes('--observation-pressure')) await panel.evaluate(async tabId => {
      await chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, world: 'ISOLATED', func: () => {
        const load = {sent: 0, stop: () => {}};
        const timer = setInterval(() => {load.sent++; void chrome.runtime.sendMessage({type: 'video.observe'}).catch(() => {});}, 20);
        load.stop = () => clearInterval(timer);
        globalThis.__vcampTestObservationLoad = load;
        setTimeout(load.stop, 60000);
      }});
    }, initial.binding.tabId);
    await site.evaluate(() => document.querySelector('video')?.play().catch(() => {}));
    const playbackStart=await site.evaluate(()=>document.querySelector('video')?.currentTime??0);
    const metadataBefore=network.filter(request=>request.path==='/x/player/wbi/v2').length;
    for(let heartbeat=0;heartbeat<40;heartbeat++){
      await site.evaluate(heartbeat=>history.replaceState({...history.state,vcampTestHeartbeat:heartbeat},'',location.href),heartbeat);
      const stable=await Promise.race([query(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Playback observation starved the workspace query')),2500))]);
      assert.deepEqual(stable.binding,initial.binding);
      assert.equal(stable.status,'ready');assert.equal(stable.cueCount,initial.cueCount);
    }
    const deadline=Date.now()+30000;
    let samples=0;
    while(Date.now()<deadline){
      const stable=await Promise.race([query(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Playback observation starved the workspace query')),2500))]);
      assert.deepEqual(stable.binding,initial.binding);
      assert.equal(stable.status,'ready');assert.equal(stable.cueCount,initial.cueCount);
      samples++;await new Promise(resolve=>setTimeout(resolve,300));
    }
    const playbackEnd=await site.evaluate(()=>document.querySelector('video')?.currentTime??0);
    result.watchStability={backgroundUpdates:40,playbackSamples:samples,watchMs:30000,playbackStart,playbackEnd,metadataRequests:network.filter(request=>request.path==='/x/player/wbi/v2').length-metadataBefore,bindingUnchanged:true};
    if (process.argv.includes('--observation-pressure')) result.watchStability.injectedObservations=await panel.evaluate(async tabId => {
      const [result]=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:()=>{
        const load=globalThis.__vcampTestObservationLoad;load?.stop();return load?.sent??0;
      }});return result.result;
    },initial.binding.tabId);
    assert.ok(playbackEnd-playbackStart>10,'The real video must advance during the stability check');
    assert.equal(result.watchStability.metadataRequests,0);
    console.log('WATCH_STABLE',JSON.stringify(result.watchStability));
  }
  await site.evaluate(() => document.querySelector('video')?.pause());
  if (process.argv.includes('--full-buffer')) await site.evaluate(() => performance.setResourceTimingBufferSize(performance.getEntriesByType('resource').length));
  const targetTitle = await site.evaluate(() => window.__INITIAL_STATE__?.videoData?.ugc_season?.sections?.flatMap(s => s.episodes ?? []).find(e => e.bvid === 'BV1aBAfzVEEm')?.title);
  assert.ok(targetTitle, 'Target must be available in the real season list');
  await site.locator('.video-pod__item').filter({ hasText: targetTitle }).click();
  await site.waitForURL('**/video/BV1aBAfzVEEm*', { timeout: 15000 });
  const target = await wait('same-document-B', 'BV1aBAfzVEEm', '36427598437');
  assert.equal(target.binding.documentId, initial.binding.documentId);
  assert.equal(target.binding.tabId, initial.binding.tabId);
  assert.ok(target.binding.epoch > initial.binding.epoch);
  const stale = await panel.evaluate(async binding => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'video.retry', binding } }), initial.binding);
  assert.equal(stale.code, 'stale-binding');
  await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
  await panel.locator('.subtitle-row').first().waitFor({ state: 'visible' });
  result.renderedCueCount = await panel.locator('.subtitle-row').count();
  assert.equal(result.renderedCueCount, target.cueCount);
  await panel.screenshot({ path: resolve(output, 'same-document-B.png') });
  await site.goBack();
  const back = await wait('back-A', 'BV1Y3rHBSE1n', '35374040384');
  assert.equal(back.binding.documentId, initial.binding.documentId);
  await site.goForward();
  const forward = await wait('forward-B', 'BV1aBAfzVEEm', '36427598437');
  assert.equal(forward.binding.documentId, initial.binding.documentId);
  result.requestEvidence = await site.evaluate(() => {
    const observed = window.__vcampRequestLog?.entries ?? [];
    const target = entry => { const u = new URL(entry.name); return u.pathname === '/x/player/wbi/playurl' && u.searchParams.get('bvid') === 'BV1aBAfzVEEm'; };
    return { resourceCount: performance.getEntriesByType('resource').length, targetInTimingBuffer: performance.getEntriesByType('resource').some(target), targetInObserver: observed.some(target), observedEntryCount: observed.length };
  });
  if (process.argv.includes('--full-buffer')) {
    assert.equal(result.requestEvidence.targetInTimingBuffer, false);
    assert.equal(result.requestEvidence.targetInObserver, true);
    assert.ok(result.requestEvidence.observedEntryCount <= 64);
  }
  result.pass = true;
} catch (error) {
  result.error = error.message;
  if (site) result.media = await site.evaluate(() => {
    const p = window.player, manifest = p?.getManifest?.(), v = document.querySelector('video');
    let decoded;
    try { const u = new URL(p?.getMediaInfo?.()?.playUrl); decoded = { host: u.hostname, path: u.pathname }; } catch {}
    return { path: location.pathname, resourceCount: performance.getEntriesByType('resource').length, initial: { bvid: window.__INITIAL_STATE__?.videoData?.bvid, aid: window.__INITIAL_STATE__?.videoData?.aid }, manifest: manifest && { bvid: manifest.bvid, cid: manifest.cid, aid: manifest.aid }, decoded, readyState: v?.readyState, requests: performance.getEntriesByType('resource').map(r => new URL(r.name)).filter(u => u.origin === 'https://api.bilibili.com' && /playurl|\/v2$|view\/detail/.test(u.pathname)).map(u => ({ path: u.pathname, bvid: u.searchParams.get('bvid'), avid: u.searchParams.get('avid'), aid: u.searchParams.get('aid'), cid: u.searchParams.get('cid') })).slice(-15) };
  }).catch(() => null);
  if (result.media) console.log('MEDIA', JSON.stringify(result.media));
  console.log('NETWORK', JSON.stringify(network.slice(-20))); console.log('NAVIGATIONS', JSON.stringify(navigations));
  if (panel) await panel.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(result.pass ? 'PASS: authenticated real-site subtitles, same-document switch, back, forward and stale-binding rejection' : `FAIL: ${result.error}`);
  await context.close();
}
