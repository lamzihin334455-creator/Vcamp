import { expect, test, vi } from 'vitest';
import { VideoSessions } from '../../src/video/sessions';
import type { VideoView } from '../../src/contracts/video';

test('subtitle completion and existing observation waiters settle during a continuous stream of newer observations', async () => {
  let pumping = true, probes = 0, settled = false;
  let flooded!: () => void;
  const flood = new Promise<void>(resolve => {flooded = resolve;});
  const sessions = new VideoSessions({
    observe: async () => {
      if (pumping) {
        queueMicrotask(() => {void sessions.observe(1);});
        if (++probes === 12) flooded();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return {documentId: 'doc', marker: 'stable', source: {platform: 'bilibili', videoId: 'BVstream', partId: '11', title: '正常播放'}};
    },
    read: async () => ({status: 'ready', cues: [{from: 0, to: 1, content: '完整字幕'}], language: 'zh'}),
    seek: async () => ({time: 0, paused: true})
  });
  void sessions.observe(1);
  const pending = sessions.observe(1).then(value => {settled = true; return value;});
  await flood;
  const completedDuringPlayback = settled;
  pumping = false;
  await pending;
  expect(completedDuringPlayback, 'New notifications must not prolong a previously queued observation').toBe(true);
  expect(await sessions.observe(1)).toMatchObject({status: 'ready', cues: [{content: '完整字幕'}]});
  sessions.remove(1);
});

test('same-tab A -> B -> A cancels the departed read and never restores its late subtitles', async () => {
  let partId = 'A', reads = 0;
  let finishOld!: (value: Pick<VideoView, 'status' | 'cues' | 'language'>) => void;
  let oldSignal!: AbortSignal;
  const ready = (content: string) => ({ status: 'ready' as const, cues: [{ from: 0, to: 1, content }], language: 'zh-CN' });
  const sessions = new VideoSessions({
    observe: async () => ({ documentId: 'same-document', marker: partId, source: { platform: 'bilibili', videoId: 'BVseason', partId, title: partId } }),
    read: async (binding, signal) => {
      if (++reads === 1) { oldSignal = signal; return new Promise(resolve => { finishOld = resolve; }); }
      return ready(`current-${binding.partId}`);
    },
    seek: async () => { throw new Error('A stale binding must never reach the player'); }
  });
  const departed = (await sessions.observe(1)).binding!;
  sessions.invalidate(1); partId = 'B';
  expect(oldSignal.aborted).toBe(true);
  await vi.waitFor(async () => expect(await sessions.observe(1)).toMatchObject({ status: 'ready', binding: { partId: 'B' }, cues: [{ content: 'current-B' }] }));
  await expect(sessions.retry(departed)).rejects.toMatchObject({ code: 'stale-binding' });
  await expect(sessions.seek(departed, 0, 'preserve')).rejects.toMatchObject({ code: 'stale-binding' });
  sessions.invalidate(1); partId = 'A';
  await vi.waitFor(async () => expect(await sessions.observe(1)).toMatchObject({ status: 'ready', cues: [{ content: 'current-A' }] }));
  const returned = (await sessions.observe(1)).binding!;
  expect(returned.epoch).toBeGreaterThan(departed.epoch);
  finishOld(ready('departed-A'));
  await Promise.resolve();
  expect(await sessions.observe(1)).toMatchObject({ status: 'ready', binding: returned, cues: [{ content: 'current-A' }] });
  sessions.remove(1);
});

test('brief player identity gaps revoke live actions without downloading the same completed subtitles again',async()=>{
  let available=true,reads=0;
  const sessions=new VideoSessions({
    observe:async()=>({documentId:'same-document',marker:'stable-route',source:available?{platform:'bilibili' as const,videoId:'BVwatching',partId:'11',title:'正常播放'}:null,status:available?undefined:'loading' as const}),
    read:async()=>{reads++;return {status:'ready',language:'zh',cues:[{from:0,to:60,content:'已经读取的完整字幕'}]};},
    seek:async()=>{throw Error('Revoked binding must not reach the player');}
  });
  await vi.waitFor(async()=>expect((await sessions.observe(1)).status).toBe('ready'));
  const initial=(await sessions.observe(1)).binding!;
  for(let gap=0;gap<6;gap++){
    available=false;
    expect(await sessions.observe(1)).toMatchObject({binding:null,status:'loading',cues:[]});
    await expect(sessions.seek(initial,1,'preserve')).rejects.toMatchObject({code:'stale-binding'});
    available=true;
    await vi.waitFor(async()=>expect(await sessions.observe(1)).toMatchObject({status:'ready',cues:[{content:'已经读取的完整字幕'}]}));
  }
  expect(reads,'confirmed, complete subtitles survive short readiness gaps').toBe(1);
  sessions.remove(1);
});

test('a stable unreadable track stops automatic retries at the configured bound',async()=>{
  let reads=0;
  const sessions=new VideoSessions({
    observe:async()=>({documentId:'same-document',marker:'stable-route',source:{platform:'bilibili',videoId:'BVfailed',partId:'11',title:'失败样本'}}),
    read:async()=>{reads++;return {status:'read-failed',cues:[],language:null};},
    seek:async()=>({time:0,paused:true})
  },()=>{},[5,10]);
  await sessions.observe(1);
  await vi.waitFor(()=>expect(reads).toBe(3));
  for(let tick=0;tick<12;tick++)await sessions.observe(1);
  expect(reads).toBe(3);
  sessions.remove(1);
});

test('completed payload reuse still honors explicit refresh, document replacement and permission revocation',async()=>{
  let documentId='first-document',available=true,allowed=true,reads=0;
  const sessions=new VideoSessions({
    observe:async()=>({documentId,marker:'stable-route',source:available&&allowed?{platform:'bilibili' as const,videoId:'BVwatching',partId:'11',title:'正常播放'}:null,status:!allowed?'permission-denied' as const:available?undefined:'loading' as const}),
    read:async()=>({status:'ready',language:'zh',cues:[{from:0,to:60,content:`版本 ${++reads}`}]}),
    seek:async()=>({time:0,paused:true})
  });
  await vi.waitFor(async()=>expect((await sessions.observe(1)).status).toBe('ready'));
  await sessions.retry((await sessions.observe(1)).binding!);
  expect(await sessions.observe(1)).toMatchObject({status:'ready',cues:[{content:'版本 2'}]});
  available=false;await sessions.observe(1);available=true;
  expect(await sessions.observe(1)).toMatchObject({status:'ready',cues:[{content:'版本 2'}]});
  expect(reads).toBe(2);
  documentId='replacement-document';
  await vi.waitFor(async()=>expect(await sessions.observe(1)).toMatchObject({status:'ready',cues:[{content:'版本 3'}]}));
  allowed=false;expect((await sessions.observe(1)).binding).toBeNull();allowed=true;
  await vi.waitFor(async()=>expect(await sessions.observe(1)).toMatchObject({status:'ready',cues:[{content:'版本 4'}]}));
  sessions.invalidate(1);
  await vi.waitFor(async()=>expect(await sessions.observe(1)).toMatchObject({status:'ready',cues:[{content:'版本 5'}]}));
  sessions.remove(1);
});
