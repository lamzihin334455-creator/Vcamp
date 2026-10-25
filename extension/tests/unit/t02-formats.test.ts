import { afterEach, expect, test, vi } from 'vitest';
import { inspectMedia } from '../../src/video/page';
import { seekMedia } from '../helpers/page';
import { createChromeVideo } from '../../src/video/chrome-video';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const playUrl = 'https://upos-synthetic.bilivideo.com/media/opaque-video.m4s';
  let time = 3;
  const callbacks = new Map<string, () => void>();
  const video = { readyState: 4, currentSrc: 'blob:synthetic-A', duration: 8, paused: true, get currentTime() { return time; }, set currentTime(v) { time = v; queueMicrotask(() => callbacks.get('seeked')?.()); }, addEventListener: (event: string, callback: () => void) => callbacks.set(event, callback), removeEventListener: (event: string) => callbacks.delete(event) };
  const model = { cid: 30, source: playUrl, element: video, entries: [{ name: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BVfixture&cid=30' }], navigation: [] as { name: string }[], scripts: [] as { textContent: string }[], reply: { code: 0, data: { dash: { video: [{ baseUrl: playUrl + '?SYNTHETIC_NEW_SIGNATURE' }] } } } };
  const location = { href: 'https://www.bilibili.com/video/BVfixture/?p=3' };
  vi.stubGlobal('location', location);
  vi.stubGlobal('document', { querySelector: () => model.element, get scripts() { return model.scripts; } });
  vi.stubGlobal('window', { player: { getManifest: () => ({ bvid: 'BVfixture', cid: model.cid }), mediaElement: () => model.element, getMediaInfo: () => ({ playUrl: model.source }) }, __INITIAL_STATE__: { videoData: { bvid: 'BVfixture', title: 'synthetic', pages: [{ page: 2, cid: 20, part: 'P2' }, { page: 3, cid: 30, part: 'P3' }] } } });
  vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? model.navigation : model.entries });
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => model.reply }));
  vi.stubGlobal('fetch', fetch);
  const binding = { platform: 'bilibili' as const, videoId: 'BVfixture', partId: '30', tabId: 1, documentId: 'doc', epoch: 1 };
  return { model, location, video, fetch, binding };
}

test('QA-T02-01: confirmed unprefixed media binds the selected part', async () => {
  const { binding, video } = fixture();
  expect(await inspectMedia()).toMatchObject({ status: 'supported', source: { videoId: 'BVfixture', partId: '30' } });
  expect(await seekMedia(binding, 5)).toEqual({ time: 5, paused: true });
  video.paused = false; video.readyState = 1;
  expect(await seekMedia(binding, 1)).toEqual({ time: 1, paused: false });
});

test('QA-T02-02: an in-place pages mutation cannot poison a later part with the old decoder', async () => {
  const { model, location, video, binding, fetch } = fixture();
  location.href = 'https://www.bilibili.com/video/BVfixture/?p=2'; model.cid = 20;
  model.entries[0].name = 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BVfixture&cid=20';
  const pages = (window as unknown as { __INITIAL_STATE__: { videoData: { pages: { cid: number }[] } } }).__INITIAL_STATE__.videoData.pages;
  fetch.mockImplementation(async () => { pages[0].cid = 30; return { ok: true, status: 200, json: async () => model.reply }; });
  expect((await inspectMedia()).status).toBe('loading');
  // Restore P2, announce P3, retain the P2 decoder. There is no P3 response.
  pages[0].cid = 20; model.cid = 30; location.href = 'https://www.bilibili.com/video/BVfixture/?p=3';
  fetch.mockImplementation(async () => { throw new Error('No new proof'); });
  expect((await inspectMedia()).status).toBe('loading');
  expect(await seekMedia(binding, 5)).toMatchObject({ code: 'stale-binding' });
  expect(video.currentTime).toBe(3);
});

test('QA-T02-01: a confirmed source stays usable after the site clears timing entries', async () => {
  const { model, binding } = fixture();
  expect((await inspectMedia()).status).toBe('supported');
  model.entries = [];
  expect((await inspectMedia()).status).toBe('supported');
  expect(await seekMedia(binding, 5)).toEqual({ time: 5, paused: true });
});

test.each(['old-path', 'unknown-response', 'missing-request', 'wrong-request-bv', 'wrong-request-cid', 'no-metadata', 'audio-only'])('QA-T02-01: %s cannot bind or move the reused old decoder', async kind => {
  const { model, video, binding } = fixture();
  if (kind === 'old-path') model.source = 'https://upos-synthetic.bilivideo.com/media/opaque-old.m4s';
  if (kind === 'unknown-response') model.reply.code = -1;
  if (kind === 'missing-request') model.entries = [];
  if (kind === 'wrong-request-bv') model.entries[0].name = 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BVother&cid=30';
  if (kind === 'wrong-request-cid') model.entries[0].name = 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BVfixture&cid=20';
  if (kind === 'no-metadata') video.readyState = 0;
  if (kind === 'audio-only') model.reply = { code: 0, data: { dash: { video: [] } } };
  expect((await inspectMedia()).status).toBe('loading');
  expect(await seekMedia(binding, 5)).toMatchObject({ code: 'stale-binding' });
  expect(video.currentTime).toBe(3);
});

test('QA-T02-01: immutable initial response uses document navigation, never mutable SPA cid', async () => {
  const { model, location, binding, video } = fixture();
  model.navigation = [{ name: location.href }]; model.entries = [];
  model.scripts = [{ textContent: 'window.__playinfo__=' + JSON.stringify(model.reply) }];
  expect((await inspectMedia()).status).toBe('supported');
  // Same video element and readyState, new manifest/URL, old initial response/source.
  model.cid = 20; location.href = 'https://www.bilibili.com/video/BVfixture/?p=2';
  expect((await inspectMedia()).status).toBe('loading');
  expect(await seekMedia({ ...binding, partId: '20' }, 5)).toMatchObject({ code: 'stale-binding' });
  expect(video.currentTime).toBe(3);
  // Late first observation after SPA, with no previously cached proof, also rejects.
  delete (window as unknown as { __vcampMediaPaths?: unknown }).__vcampMediaPaths;
  expect((await inspectMedia()).status).toBe('loading');
});

test.each(['element', 'current-src', 'play-url', 'selection', 'manifest', 'unfinished'])('QA-T02-01: late source proof after %s change cannot authorize old observation or seek', async kind => {
  const { model, location, video, binding, fetch } = fixture();
  const change = () => {
    if (kind === 'element') model.element = { ...video };
    if (kind === 'current-src') video.currentSrc += '-replacement';
    if (kind === 'play-url') model.source = 'https://upos-synthetic.bilivideo.com/media/opaque-B.m4s';
    if (kind === 'selection') location.href = 'https://www.bilibili.com/video/BVfixture/?p=2';
    if (kind === 'manifest') model.cid = 20;
    if (kind === 'unfinished') video.readyState = 0;
  };
  fetch.mockImplementation(async () => { change(); return { ok: true, status: 200, json: async () => model.reply }; });
  expect((await inspectMedia()).status).toBe('loading');
  expect(await seekMedia(binding, 5)).toMatchObject({ code: 'stale-binding' });
  expect(video.currentTime).toBe(3);
});

test.each(['element', 'current-src', 'play-url', 'selection'])('QA-T02-01: source change after seek begins is reported as stale (%s)', async kind => {
  const { model, location, video, binding } = fixture();
  const add = video.addEventListener;
  video.addEventListener = (event, callback) => add(event, () => {
    if (kind === 'element') model.element = { ...video };
    if (kind === 'current-src') video.currentSrc = 'blob:synthetic-B';
    if (kind === 'play-url') model.source = 'https://upos-synthetic.bilivideo.com/media/opaque-B.m4s';
    if (kind === 'selection') location.href = 'https://www.bilibili.com/video/BVfixture/?p=2';
    callback();
  });
  expect(await seekMedia(binding, 5)).toMatchObject({ code: 'stale-binding' });
  // A seek already started cannot be undone; it must not report success for the new source.
});

test('QA-T02-01: rapid P2→P3→P2 invalidates the epoch even when a late observation sees P2 again', async () => {
  let partId = '20', waiting = false;
  let release!: () => void, started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const listeners: ((details: { tabId: number; frameId: number }) => void)[] = [];
  const event = () => ({ addListener() {} });
  vi.stubGlobal('chrome', {
    permissions: { contains: async () => true, onAdded: event(), onRemoved: event() },
    scripting: { getRegisteredContentScripts: async () => [{ id: 'vcamp-video' }], executeScript: async (options: { func?: { name: string } }) => {
      if (options.func?.name === 'guardMedia') return [{ documentId: 'same-document', result: { revision: 0 } }];
      if (options.func?.name === 'inspectMedia') {
        const observed = partId;
        if (waiting) { waiting = false; started(); await gate; }
        return [{ documentId: 'same-document', result: { status: 'supported', source: { platform: 'bilibili', videoId: 'BVfixture', partId: observed, title: 'synthetic' } } }];
      }
      return [{ documentId: 'same-document', result: { http: 200, json: { code: 0, data: { subtitle: { subtitles: [] } } } } }];
    } },
    tabs: { get: async () => ({ url: `https://www.bilibili.com/video/BVfixture/?p=${partId === '20' ? 2 : 3}` }), query: async () => [], onRemoved: event(), onActivated: event() },
    webNavigation: { onCommitted: event(), onHistoryStateUpdated: { addListener: (listener: typeof listeners[number]) => listeners.push(listener) } }
  });
  const video = createChromeVideo(() => {});
  const old = (await video.observe(1)).binding!;
  // Let the initial subtitle completion/reobservation settle before delaying the next probe.
  await new Promise(resolve => setTimeout(resolve, 0));
  waiting = true; const late = video.observe(1); await start;
  partId = '30'; listeners[0]({ tabId: 1, frameId: 0 });
  partId = '20'; listeners[0]({ tabId: 1, frameId: 0 }); release();
  expect((await late).binding).toBeNull();
  const current = await video.observe(1);
  expect(current.binding?.partId).toBe('20'); expect(current.binding?.epoch).not.toBe(old.epoch);
  await expect(video.seek(old, 1, 'preserve')).rejects.toMatchObject({ code: 'stale-binding' });
});
