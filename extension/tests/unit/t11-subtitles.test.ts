import { expect, test, vi } from 'vitest';
import { readCompleteSubtitles } from '../../src/video/subtitles';
import { VideoSessions } from '../../src/video/sessions';
import { alignSubtitles } from '../../src/video/SubtitleTimeline';
import { createPlaybackChannel } from '../../src/video/playback-channel';
import type { Playback } from '../../src/contracts/video';

test('T11: playback channel coalesces busy events, rereads final pause, drops replies after disposal', async () => {
  let message!: (value: unknown) => void, disconnect!: () => void;
  const replies: unknown[] = [], pending: ((value: Playback) => void)[] = [];
  const port = { onMessage: { addListener: (fn: typeof message) => { message = fn; } }, onDisconnect: { addListener: (fn: typeof disconnect) => { disconnect = fn; } }, postMessage: (value: unknown) => replies.push(value) } as unknown as chrome.runtime.Port;
  const channel = createPlaybackChannel(() => new Promise(resolve => pending.push(resolve)));
  channel.connect(port);
  message({ binding: { platform: 'bilibili', videoId: 'BVfixture', partId: '20', tabId: 1, documentId: 'doc', epoch: 1 } });
  channel.notify(1, 'other'); channel.notify(1, 'doc'); channel.notify(1, 'doc');
  expect(pending).toHaveLength(1);
  pending[0]({ time: 1, paused: false, duration: 8 }); await Promise.resolve();
  expect(pending).toHaveLength(2);
  pending[1]({ time: 2, paused: true, duration: 8 }); await Promise.resolve();
  expect(replies).toHaveLength(2); expect(replies[1]).toMatchObject({ playback: { time: 2, paused: true } });
  channel.notify(1, 'doc'); disconnect(); pending[2]({ time: 3, paused: false, duration: 8 }); await Promise.resolve();
  expect(replies).toHaveLength(2);
});

test('T11: interval overlap supports split/merged languages and marks gaps without row-index pairing', () => {
  const cue = (from: number, to: number, content: string) => ({ from, to, content });
  const auxiliary = [cue(0.5, 1.5, 'A'), cue(1.5, 3.5, 'B'), cue(5, 6, 'C')];
  expect(alignSubtitles([cue(0, 2, '一'), cue(2, 3, '二'), cue(4, 5, '三')], auxiliary))
    .toEqual([[auxiliary[0], auxiliary[1]], [auxiliary[1]], []]);
});

test('a temporarily unavailable paused decoder recovers playback without another video event', async () => {
  vi.useFakeTimers();
  try {
    let message!: (value:unknown)=>void, disconnect!:()=>void;
    const replies:unknown[]=[];
    const port={onMessage:{addListener:(fn:typeof message)=>{message=fn;}},onDisconnect:{addListener:(fn:typeof disconnect)=>{disconnect=fn;}},postMessage:(value:unknown)=>replies.push(value)} as unknown as chrome.runtime.Port;
    const read=vi.fn().mockRejectedValueOnce(new Error('decoder loading')).mockResolvedValue({time:4,duration:8,paused:true});
    createPlaybackChannel(read).connect(port);
    message({binding:{platform:'bilibili',videoId:'BVfixture',partId:'20',tabId:1,documentId:'doc',epoch:1}});
    await vi.advanceTimersByTimeAsync(1200);
    expect(replies.at(-1)).toMatchObject({playback:{time:4,paused:true}});
    disconnect();const count=read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(read).toHaveBeenCalledTimes(count);
  } finally { vi.useRealTimers(); }
});

test('T11: native languages share one response; a failed auxiliary track does not replace the analysis source', async () => {
  const result = await readCompleteSubtitles({
    metadata: async () => ({ http: 200, json: { code: 0, data: { subtitle: { subtitles: ['zh-CN', 'en', 'ja'].map(lan => ({ lan, lan_doc: lan, subtitle_url: `https://aisubtitle.hdslb.com/${lan}.json` })) } } } }),
    track: async url => url.endsWith('/ja.json') ? { http: 403, json: null } : { http: 200, json: { body: [{ from: url.includes('/en.') ? 0.5 : 0, to: 2, content: url.includes('/en.') ? 'SYNTHETIC EN' : '合成主轨' }] } }
  }, new AbortController().signal);
  expect(result).toMatchObject({ status: 'ready', language: 'zh-CN', cues: [{ content: '合成主轨' }], tracks: [{ language: 'zh-CN', status: 'ready' }, { language: 'en', status: 'ready' }, { language: 'ja', status: 'permission-denied', cues: [] }] });
});

test('T11: late multi-track refresh cannot replace the new part', async () => {
  let cid = '20', delay = false, release!: (value: Awaited<ReturnType<typeof readCompleteSubtitles>>) => void;
  const value = (language: string) => ({ status: 'ready' as const, cues: [{ from: 0, to: 2, content: language }], language, tracks: [{ language, label: language, status: 'ready' as const, cues: [{ from: 0, to: 2, content: language }] }] });
  const sessions = new VideoSessions({
    observe: async () => ({ documentId: 'doc', marker: cid, source: { platform: 'bilibili', videoId: 'BVfixture', partId: cid, title: 'fixture' } }),
    read: async binding => delay && binding.partId === '20' ? new Promise(resolve => { release = resolve; }) : value(cid),
    seek: async () => ({ time: 0, paused: true })
  });
  const first = await sessions.observe(1); await new Promise(resolve => setTimeout(resolve, 0));
  delay = true; const pending = sessions.retry(first.binding!); await new Promise(resolve => setTimeout(resolve, 0));
  cid = '30'; sessions.invalidate(1); await sessions.observe(1); await new Promise(resolve => setTimeout(resolve, 0));
  release(value('OLD')); await pending;
  expect(await sessions.observe(1)).toMatchObject({ binding: { partId: '30' }, tracks: [{ language: '30' }] });
});
