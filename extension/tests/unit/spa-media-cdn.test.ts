import { afterEach, expect, test, vi } from 'vitest';
import { inspectMedia } from '../../src/video/page';

afterEach(() => vi.unstubAllGlobals());

function fixture(sameMirror = false) {
  // Minimized from the supplied A -> B season switch. A has a numeric filename;
  // B uses the observed opaque filename, and replay can choose another mirror.
  const video = { readyState: 4, currentSrc: 'blob:https://www.bilibili.com/decoder', currentTime: 0, duration: 785, paused: true };
  const location = { href: 'https://www.bilibili.com/video/BV1Y3rHBSE1n/' };
  const model = {
    bvid: 'BV1Y3rHBSE1n', cid: 35374040384,
    path: '/upgcxcode/84/03/35374040384/35374040384-1-100022.m4s',
    decodedHost: 'upos-sz-mirrorhwo1.bilivideo.com',
    replayHost: sameMirror ? 'upos-sz-mirrorhwo1.bilivideo.com' : 'upos-sz-mirrorhw.bilivideo.com',
    replayPath: '', audioOnly: false, entries: true
  };
  const state = { videoData: { bvid: model.bvid, title: 'A', pages: [{ page: 1, cid: model.cid, part: 'A' }] } };
  const select = (bvid: string, cid: number) => {
    model.bvid = bvid; model.cid = cid;
    location.href = `https://www.bilibili.com/video/${bvid}`;
    state.videoData = { bvid, title: bvid, pages: [{ page: 1, cid, part: bvid }] };
  };
  const selectB = () => {
    select('BV1aBAfzVEEm', 36427598437);
    model.path = '/upgcxcode/37/84/36427598437/36427598437_qe1-1-30011.m4s';
  };
  vi.stubGlobal('location', location);
  vi.stubGlobal('document', { querySelector: () => video });
  vi.stubGlobal('window', {
    __INITIAL_STATE__: state,
    player: { getManifest: () => ({ bvid: model.bvid, cid: model.cid }), mediaElement: () => video, getMediaInfo: () => ({ playUrl: `https://${model.decodedHost}${model.path}` }) }
  });
  vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'resource' && model.entries ? [{ name: `https://api.bilibili.com/x/player/wbi/playurl?bvid=${model.bvid}&cid=${model.cid}` }] : [] });
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: { dash: model.audioOnly ? { audio: [{ baseUrl: `https://${model.replayHost}${model.path}` }] } : { video: [{ baseUrl: `https://${model.replayHost}${model.replayPath || model.path}` }] } } }) }));
  vi.stubGlobal('fetch', fetch);
  return { model, fetch, select, selectB };
}

test.each([true, false])('a same-document season switch reads the new media (same CDN mirror: %s)', async sameMirror => {
  const f = fixture(sameMirror);
  expect(await inspectMedia()).toMatchObject({ status: 'supported', source: { videoId: f.model.bvid, partId: String(f.model.cid) } });
  f.selectB();
  expect(await inspectMedia()).toMatchObject({ status: 'supported', source: { videoId: f.model.bvid, partId: String(f.model.cid) } });
});

test('confirmed media survives a CDN mirror change and cleared timing entries without another request', async () => {
  const f = fixture(); f.selectB();
  expect((await inspectMedia()).status).toBe('supported');
  f.model.decodedHost = 'upos-sz-estgcos.bilivideo.com'; f.model.entries = false;
  expect((await inspectMedia()).status).toBe('supported');
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

test.each(['different-path', 'lookalike-host', 'untrusted-decoder', 'audio-only'])('CDN normalization still rejects %s', async kind => {
  const f = fixture(); f.selectB();
  if (kind === 'different-path') f.model.replayPath = '/another-video.m4s';
  if (kind === 'lookalike-host') f.model.replayHost = 'mirror.bilivideo.com.evil.test';
  if (kind === 'untrusted-decoder') f.model.decodedHost = 'video.evil.test';
  if (kind === 'audio-only') f.model.audioOnly = true;
  expect((await inspectMedia()).status).toBe('loading');
});

test('a different video cannot reuse an already associated file through another CDN mirror', async () => {
  const f = fixture(); f.selectB();
  expect((await inspectMedia()).status).toBe('supported');
  f.select('BVother', 999); f.model.decodedHost = 'upos-sz-estgcos.bilivideo.com';
  expect((await inspectMedia()).status).toBe('loading');
  expect(f.fetch).toHaveBeenCalledTimes(1);
});
