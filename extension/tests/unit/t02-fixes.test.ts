import 'fake-indexeddb/auto';
import { afterEach, expect, test, vi } from 'vitest';
import { inspectMedia } from '../../src/video/page';
import { seekMedia } from '../helpers/page';
import { createChromeVideo } from '../../src/video/chrome-video';
import { createMessageRouter } from '../../src/app/message-router';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';

afterEach(() => vi.unstubAllGlobals());

test.each(['missing-player', 'missing-cid', 'old-cid'])('STD-T02-01: %s cannot seek the retained old decoder under new P metadata', async kind => {
  vi.stubGlobal('location', { href: 'https://www.bilibili.com/video/BVfixture/?p=2' });
  const player = kind === 'missing-player' ? undefined : { getVideoMessage: () => kind === 'missing-cid' ? {} : { cid: 10, bvid: 'BVfixture' } };
  vi.stubGlobal('window', { player, __INITIAL_STATE__: { videoData: { bvid: 'BVfixture', title: 'synthetic', pages: [{ page: 2, cid: 20, part: 'P2' }] } } });
  let time = 3;
  const callbacks = new Map<string, () => void>();
  const video = { duration: 8, paused: true, get currentTime() { return time; }, set currentTime(value) { time = value; queueMicrotask(() => callbacks.get('seeked')?.()); }, addEventListener: (event: string, fn: () => void) => callbacks.set(event, fn), removeEventListener: (event: string) => callbacks.delete(event) };
  vi.stubGlobal('document', { querySelector: () => video });
  // Exercise seek independently as well as observation; neither may mutate the old decoder.
  const result = await seekMedia({ platform: 'bilibili', videoId: 'BVfixture', partId: '20', tabId: 1, documentId: 'doc', epoch: 1 }, 5);
  expect(result).toHaveProperty('code');
  expect(time).toBe(3);
  expect((await inspectMedia()).status).toBe('loading');
});

test.each([false, true])('STD-T02-01: current player manifest is accepted only with matching decoded media (%s)', async matching => {
  vi.stubGlobal('location', { href: 'https://www.bilibili.com/video/BVfixture/?p=2' });
  let time = 3;
  const callbacks = new Map<string, () => void>();
  // HAVE_METADATA keeps decoder identity even when seeking temporarily drops future frames.
  const video = { readyState: 1, duration: 8, paused: true, get currentTime() { return time; }, set currentTime(value) { time = value; queueMicrotask(() => callbacks.get('seeked')?.()); }, addEventListener: (event: string, fn: () => void) => callbacks.set(event, fn), removeEventListener: (event: string) => callbacks.delete(event) };
  vi.stubGlobal('window', { player: { getManifest: () => ({ bvid: 'BVfixture', cid: 20 }), mediaElement: () => video, getMediaInfo: () => ({ playUrl: `https://upos-synthetic.bilivideo.com/${matching ? 20 : 10}-1-30080.m4s` }) }, __INITIAL_STATE__: { videoData: { bvid: 'BVfixture', title: 'synthetic', pages: [{ page: 2, cid: 20, part: 'P2' }] } } });
  vi.stubGlobal('document', { querySelector: () => video });
  expect((await inspectMedia()).status).toBe(matching ? 'supported' : 'loading');
  const result = await seekMedia({ platform: 'bilibili', videoId: 'BVfixture', partId: '20', tabId: 1, documentId: 'doc', epoch: 1 }, 5);
  if (matching) expect(result).toEqual({ time: 5, paused: true });
  else { expect(result).toHaveProperty('code'); expect(time).toBe(3); }
});

test('SPEC-T02-01: an unsupported page keeps the last selected workspace while live media actions stay unavailable', async () => {
  let failed = false, granted = true, partId = '10', documentId = 'doc-1', videoId = 'BVfixture';
  const event = () => ({ addListener() {} });
  vi.stubGlobal('chrome', {
    permissions: { contains: async () => granted, onAdded: event(), onRemoved: event() },
    scripting: { getRegisteredContentScripts: async () => [{ id: 'vcamp-video' }], executeScript: async (options: { func?: { name: string } }) => {
      if (options.func?.name === 'guardMedia') return [{ documentId: documentId, result: { revision: 0 } }];
      if (options.func?.name === 'inspectMedia') {
        if (failed) throw new Error('synthetic inspection failure');
        return [{ documentId, result: { status: 'supported', source: { platform: 'bilibili', videoId, partId, title: 'synthetic' } } }];
      }
      if (options.func?.name === 'readMetadata') return [{ documentId, result: { http: 200, json: { code: 0, data: { subtitle: { subtitles: [] } } } } }];
      throw new Error('unexpected call');
    } },
    tabs: { get: async () => ({ url: `https://www.bilibili.com/video/${videoId}/` }), query: async (options: { url?: string; windowId?: number }) => options.url ? [] : [{ id: options.windowId === 2 ? 2 : 1 }], onRemoved: event(), onActivated: event() },
    webNavigation: { onCommitted: event(), onHistoryStateUpdated: event() }
  });
  const video = createChromeVideo(() => {});
  const router = createMessageRouter(new IndexedWorkspaceStore(crypto.randomUUID()), 'fix', async () => null, video);
  const sender = { id: 'fix', url: 'chrome-extension://fix/sidepanel.html', frameId: 0 };
  const request = (operation: unknown, windowId = 1) => router.handle({ version: 1, requestId: crypto.randomUUID(), windowId, operation }, sender);
  const initial = await request({ type: 'workspace.query' });
  if (!initial.ok || !initial.view.video?.binding) throw new Error('Expected confirmed space');
  const old = initial.view.video.binding;
  const target = { workspaceId: initial.view.workspaceId!, chatId: initial.view.chatId! };
  expect(await request({ type: 'draft.save', target, expectedRevision: 0, draft: { ...initial.view.draft, text: 'SYNTHETIC local draft' } })).toMatchObject({ ok: true });
  failed = true;
  expect(await request({ type: 'workspace.query' })).toMatchObject({ ok: true, view: { workspaceId: target.workspaceId, chatId: target.chatId, draft: { text: 'SYNTHETIC local draft' }, video: { binding: null, status: 'read-failed', cues: [] } } });
  expect(await request({ type: 'video.seek', binding: old, time: 1, policy: 'preserve' })).toMatchObject({ ok: false, code: 'stale-binding' });
  expect(await request({ type: 'workspace.query' }, 2)).toMatchObject({ ok: true, view: { workspaceId: null, video: { binding: null } } });
  failed = false;
  const recovered = await request({ type: 'workspace.query' });
  expect(recovered).toMatchObject({ ok: true, view: { workspaceId: target.workspaceId, chatId: target.chatId, draft: { text: 'SYNTHETIC local draft' } } });
  documentId = 'doc-2';
  const refreshed = await request({ type: 'workspace.query' });
  expect(refreshed).toMatchObject({ ok: true, view: { workspaceId: target.workspaceId, video: { binding: { documentId: 'doc-2' } } } });
  granted = false;
  expect(await request({ type: 'workspace.query' })).toMatchObject({ ok: true, view: { workspaceId: target.workspaceId, draft: { text: 'SYNTHETIC local draft' }, video: { status: 'permission-denied', binding: null } } });
  expect(await request({ type: 'video.retry', binding: old })).toMatchObject({ ok: false, code: 'stale-binding' });
  granted = true; partId = '20';
  const switched = await request({ type: 'workspace.query' });
  if (!switched.ok) throw new Error('Expected new part');
  expect(switched.view.workspaceId).not.toBe(target.workspaceId);
  expect(switched.view.draft?.text).toBe('');
  videoId = 'BVother';
  const otherVideo = await request({ type: 'workspace.query' });
  if (!otherVideo.ok) throw new Error('Expected another video');
  expect(otherVideo.view.workspaceId).not.toBe(switched.view.workspaceId);
  expect(otherVideo.view.draft?.text).toBe('');
  videoId = 'BVfixture';
  partId = '10';
  expect(await request({ type: 'workspace.query' })).toMatchObject({ ok: true, view: { workspaceId: target.workspaceId, draft: { text: 'SYNTHETIC local draft' } } });
});
