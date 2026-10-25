import 'fake-indexeddb/auto';
import { afterEach, expect, test, vi } from 'vitest';
import { createChromeVideo } from '../../src/video/chrome-video';
import { createMessageRouter } from '../../src/app/message-router';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';

afterEach(async () => { await new Promise(resolve => setTimeout(resolve, 0)); vi.unstubAllGlobals(); });

// Only browser transport and site inputs are simulated. All video and router code runs.
function fixture() {
  const navigation = new EventTarget(), doc = new EventTarget(), win = new EventTarget();
  let time = 3, writes = 0;
  const video = Object.assign(new EventTarget(), { readyState: 4, currentSrc: 'blob:synthetic-A', duration: 8, paused: true });
  Object.defineProperty(video, 'currentTime', { get: () => time, set: (value: number) => { writes++; time = value; queueMicrotask(() => video.dispatchEvent(new Event('seeked'))); } });
  const model = { cid: 20, source: 'https://upos-synthetic.bilivideo.com/media/opaque-A.m4s', video, gateProof: false };
  const location = { href: 'https://www.bilibili.com/video/BVfixture/?p=2' };
  Object.assign(doc, { querySelector: () => model.video, scripts: [] });
  Object.assign(win, { navigation, player: { getManifest: () => ({ bvid: 'BVfixture', cid: model.cid }), getMediaInfo: () => ({ playUrl: model.source }), mediaElement: () => model.video }, __INITIAL_STATE__: { videoData: { bvid: 'BVfixture', title: 'SYNTHETIC', pages: [{ page: 2, cid: 20, part: 'P2' }, { page: 3, cid: 30, part: 'P3' }] } } });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('location', location);
  vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'resource' ? ['playurl?bvid=BVfixture&cid=20', 'v2?cid=20'].map(path => ({ name: `https://api.bilibili.com/x/player/wbi/${path}` })) : [] });
  let release!: () => void, start!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { start = resolve; });
  vi.stubGlobal('fetch', async (url: string) => {
    const media = url.includes('/playurl?');
    if (media && model.gateProof) { start(); await gate; }
    return { ok: true, status: 200, json: async () => ({ code: 0, data: media ? { dash: { video: [{ baseUrl: model.source }] } } : { subtitle: { subtitles: [] } } }) };
  });
  const listeners: ((details: { tabId: number; frameId: number }) => void)[] = [];
  const event = () => ({ addListener() {} });
  let qualitySwitch = false;
  const transport = { before: async (_name: string, _args: unknown[]) => {} };
  vi.stubGlobal('chrome', {
    permissions: { contains: async () => true, onAdded: event(), onRemoved: event() },
    tabs: { get: async () => ({ url: location.href }), query: async (args: { url?: string }) => args?.url ? [] : [{ id: 1 }], onRemoved: event(), onActivated: event() },
    webNavigation: { onCommitted: event(), onHistoryStateUpdated: { addListener: (fn: typeof listeners[number]) => listeners.push(fn) } },
    scripting: { getRegisteredContentScripts: async () => [{ id: 'vcamp-video' }], executeScript: async (options: { func: (...args: unknown[]) => unknown; args?: unknown[] }) => {
      if (qualitySwitch && options.func.name === 'inspectMedia' && options.args?.[0]) {
        qualitySwitch = false; model.source = 'https://upos-synthetic.bilivideo.com/media/quality-Q.m4s'; model.gateProof = true;
      }
      await transport.before(options.func.name, options.args ?? []);
      return [{ documentId: 'doc', result: await options.func(...(options.args ?? [])) }];
    } }
  });
  const port = createChromeVideo(() => {});
  const router = createMessageRouter(new IndexedWorkspaceStore(crypto.randomUUID()), 'test', async () => null, port);
  const request = (operation: unknown) => router.handle({ version: 1, requestId: crypto.randomUUID(), windowId: 1, operation }, { id: 'test', url: 'chrome-extension://test/sidepanel.html', frameId: 0 });
  const aba = (notifyWorker = true) => {
    for (const part of [3, 2]) {
      model.cid = part === 3 ? 30 : 20; location.href = `https://www.bilibili.com/video/BVfixture/?p=${part}`;
      navigation.dispatchEvent(new Event('currententrychange'));
      if (notifyWorker) listeners[0]({ tabId: 1, frameId: 0 });
    }
  };
  return { model, video, win, location, port, request, aba, started, release, transport, writes: () => writes, switchQuality: () => { qualitySwitch = true; } };
}

test('same-video time/hash updates during an asynchronous identity proof do not revoke the observed source', async () => {
  const f = fixture();
  f.model.gateProof = true;
  const pending = f.port.observe(1);
  await f.started;
  f.location.href = 'https://www.bilibili.com/video/BVfixture/?p=2&t=42#reply';
  f.release();
  expect(await pending).toMatchObject({binding: {videoId: 'BVfixture', partId: '20'}});
});

test.each([false, true])('continuous playback observations must not hold a workspace query until notifications stop (warm=%s)', async warm => {
  const f = fixture();
  if (warm) await f.request({type: 'workspace.query'});
  let pumping = true, probes = 0;
  f.transport.before = async name => {
    if (name !== 'inspectMedia' || !pumping) return;
    // A content-script notification arrives during every in-flight inspection.
    // Keep the real router and per-tab observation queue under constant load.
    void f.port.observe(1);
    probes++;
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  const pending = f.request({type: 'workspace.query'});
  let timeout!: ReturnType<typeof setTimeout>;
  const completedDuringPlayback = await Promise.race([
    pending.then(()=>true),
    new Promise<false>(resolve=>{timeout=setTimeout(()=>resolve(false),1500);})
  ]);
  clearTimeout(timeout);
  pumping = false;
  const result = await pending;
  expect(result).toMatchObject({ok: true, view: {video: {binding: {videoId: 'BVfixture'}}}});
  expect(probes).toBeGreaterThan(0);
  expect(completedDuringPlayback, 'The panel must connect while playback notifications are still arriving').toBe(true);
});

test.each([false, true])('FIX03: quality proof preserves playback; expired ABA command starts zero writes (ABA=%s)', async aba => {
  const f = fixture();
  const initial = await f.request({ type: 'workspace.query' });
  if (!initial.ok || !initial.view.video?.binding) throw new Error('Expected binding');
  const binding = initial.view.video.binding;
  await new Promise(resolve => setTimeout(resolve, 0));
  f.video.paused = !aba; f.switchQuality();
  const pending = f.request({ type: 'video.seek', binding, time: 1, policy: 'preserve' });
  await f.started;
  expect(f.writes()).toBe(0);
  if (aba) f.aba();
  f.release();
  const result = await pending;
  expect(result).toMatchObject(aba ? { ok: false, code: 'stale-binding' } : { ok: true });
  expect(f.writes()).toBe(aba ? 0 : 1);
  expect(f.video.paused).toBe(!aba);
  // New capabilities recover after the abandoned proof, without disabling quality paths.
  const fresh = await f.request({ type: 'workspace.query' });
  if (!fresh.ok || !fresh.view.video?.binding) throw new Error('Expected recovery');
  if (aba) expect(fresh.view.video.binding.epoch).not.toBe(binding.epoch);
  expect(await f.request({ type: 'video.seek', binding: fresh.view.video.binding, time: 5, policy: 'preserve' })).toMatchObject({ ok: true });
  expect(f.video.paused).toBe(!aba);
});

test('same-media history noise cancels an armed seek without revoking completed subtitles',async()=>{
  const f=fixture();
  const initial=await f.request({type:'workspace.query'});
  if(!initial.ok||!initial.view.video?.binding)throw Error('Expected binding');
  const binding=initial.view.video.binding;
  await new Promise(resolve=>setTimeout(resolve,0));
  f.switchQuality();
  const pending=f.request({type:'video.seek',binding,time:1,policy:'preserve'});
  await f.started;
  (f.win as unknown as {navigation:EventTarget}).navigation.dispatchEvent(new Event('currententrychange'));
  f.release();
  expect(await pending).toMatchObject({ok:false,code:'stale-binding'});
  expect(f.writes()).toBe(0);
  const current=await f.request({type:'workspace.query'});
  expect(current).toMatchObject({ok:true,view:{video:{binding}}});
});

test.each(['prepare-ABA', 'proof-ABA', 'commit-ABA-delayed-worker', 'commit-forged-main', 'commit-player-change', 'commit-source-change'])('FIX03: final transport boundary rejects without starting a write (%s)', async boundary => {
  const f = fixture();
  const initial = await f.request({ type: 'workspace.query' });
  if (!initial.ok || !initial.view.video?.binding) throw new Error('Expected binding');
  const binding = initial.view.video.binding;
  await new Promise(resolve => setTimeout(resolve, 0));
  let triggered = false;
  f.transport.before = async (name, args) => {
    const target = boundary.startsWith('prepare') ? name === 'guardMedia' && args[0] === 'prepare' : boundary.startsWith('proof') ? name === 'inspectMedia' && !!args[0] : name === 'guardMedia' && args[0] === 'commit';
    if (!target || triggered) return;
    triggered = true;
    if (boundary === 'commit-player-change') f.model.cid = 30;
    else if (boundary === 'commit-source-change') f.model.source = 'https://upos-synthetic.bilivideo.com/media/other.m4s';
    else {
      // Browser navigation is synchronous, even while its Worker callback is delayed.
      f.aba(!boundary.startsWith('commit'));
      if (boundary === 'commit-forged-main') document.addEventListener(String(args[2]), event => event.preventDefault());
    }
  };
  expect(await f.request({ type: 'video.seek', binding, time: 1, policy: 'preserve' })).toMatchObject({ ok: false, code: 'stale-binding' });
  expect(triggered).toBe(true);
  expect(f.writes()).toBe(0);
});

test('FIX03: invalidation after a native write starts reports stale but does not claim to undo it', async () => {
  const f = fixture();
  const initial = await f.request({ type: 'workspace.query' });
  if (!initial.ok || !initial.view.video?.binding) throw new Error('Expected binding');
  await new Promise(resolve => setTimeout(resolve, 0));
  f.video.addEventListener('seeked', () => f.aba(), { once: true });
  expect(await f.request({ type: 'video.seek', binding: initial.view.video.binding, time: 1, policy: 'preserve' })).toMatchObject({ ok: false, code: 'stale-binding' });
  expect(f.writes()).toBe(1);
});
