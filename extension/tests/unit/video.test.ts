import { expect, test } from 'vitest';
import { VideoSessions, type SiteAdapter } from '../../src/video/sessions';
import { sendConditions } from '../../src/contracts/video';

test('B: same named parts and tabs have stable media keys but distinct live bindings', async () => {
  const site: SiteAdapter = {
    observe: async tabId => ({ documentId: `doc-${tabId}`, marker: '1', source: { platform: 'bilibili', videoId: 'BV1', partId: tabId === 1 ? '10' : '20', title: '同名' } }),
    read: async () => ({ status: 'no-subtitles', cues: [], language: null }),
    seek: async () => ({ time: 3, paused: true })
  };
  const sessions = new VideoSessions(site);
  const a = await sessions.observe(1), b = await sessions.observe(2);
  expect(a.binding).toMatchObject({ videoId: 'BV1', partId: '10', tabId: 1, documentId: 'doc-1' });
  expect(b.binding).toMatchObject({ videoId: 'BV1', partId: '20', tabId: 2 });
  expect((await sessions.observe(1)).binding).toEqual(a.binding);
});

test('B: an older document observation resolving last cannot resurrect it', async () => {
  let first = true;
  let finish!: (observation: { documentId: string; marker: string; source: { platform: 'bilibili'; videoId: string; partId: string; title: string } }) => void;
  const source = { platform: 'bilibili' as const, videoId: 'BV1', partId: '10', title: '视频' };
  const sessions = new VideoSessions({
    observe: async () => { if (first) { first = false; return new Promise(resolve => { finish = resolve; }); } return { documentId: 'new', marker: '2', source }; },
    read: async () => new Promise(() => {}), seek: async () => ({ time: 0, paused: true })
  });
  const a = sessions.observe(1);
  await Promise.resolve();
  const b = sessions.observe(1);
  await Promise.resolve();
  finish({ documentId: 'old', marker: '1', source });
  await Promise.all([a, b]);
  expect((await sessions.observe(1)).binding?.documentId).toBe('new');
});

test('B: refreshing or leaving and returning invalidates the old binding and seek', async () => {
  let documentId = 'old', marker = '1';
  const sessions = new VideoSessions({
    observe: async () => ({ documentId, marker, source: { platform: 'bilibili', videoId: 'BV1', partId: '10', title: '视频' } }),
    read: async () => ({ status: 'ready', language: 'zh', cues: [{ from: 0, to: 2, content: '全文' }] }),
    seek: async () => ({ time: 1, paused: true })
  });
  const old = (await sessions.observe(1)).binding!;
  documentId = 'new'; marker = '3';
  await sessions.observe(1);
  await expect(sessions.seek(old, 1, 'preserve')).rejects.toMatchObject({ code: 'stale-binding' });
  await expect(sessions.retry(old)).rejects.toMatchObject({ code: 'stale-binding' });
  await new Promise(resolve => setTimeout(resolve, 0));
  const ready = await sessions.observe(1);
  expect(sendConditions(ready)).toEqual({ subtitleReady: true, generationReady: false, canSend: false });
  expect(sendConditions({ ...ready, status: 'loading' }).subtitleReady).toBe(false);
});

test('B: a failed read can retry in the same binding; removed sessions release their original text', async () => {
  let attempts = 0;
  const sessions = new VideoSessions({
    observe: async () => ({ documentId: 'doc', marker: '1', source: { platform: 'bilibili', videoId: 'BV1', partId: '10', title: '视频' } }),
    read: async () => ++attempts === 1 ? { status: 'read-failed', cues: [], language: null } : { status: 'ready', cues: [{ from: 0, to: 60, content: '全部原字幕' }], language: 'zh' },
    seek: async () => ({ time: 1, paused: false })
  });
  const first = await sessions.observe(1);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect((await sessions.observe(1)).status).toBe('read-failed');
  await sessions.retry(first.binding!);
  expect(await sessions.observe(1)).toMatchObject({ status: 'ready', cues: [{ content: '全部原字幕' }] });
  sessions.remove(1);
  expect(await sessions.observe(1)).toMatchObject({ status: 'loading', cues: [] });
});

test('B: late full subtitles after a rapid part change never enter the new space', async () => {
  let part = '10';
  let finish!: (value: { status: 'ready'; cues: { from: number; to: number; content: string }[]; language: string }) => void;
  const sessions = new VideoSessions({
    observe: async () => ({ documentId: 'doc', marker: part, source: { platform: 'bilibili', videoId: 'BV1', partId: part, title: '同名' } }),
    read: async binding => binding.partId === '10' ? new Promise(resolve => { finish = resolve; }) : { status: 'no-subtitles', cues: [], language: null },
    seek: async () => ({ time: 0, paused: true })
  });
  const old = await sessions.observe(1);
  expect(old.status).toBe('loading');
  part = '20';
  const next = await sessions.observe(1);
  finish({ status: 'ready', cues: [{ from: 0, to: 4, content: 'OLD ORIGINAL' }], language: 'zh' });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(await sessions.observe(1)).toMatchObject({ binding: { partId: '20' }, status: 'no-subtitles', cues: [] });
  expect(next.binding!.epoch).toBeGreaterThan(old.binding!.epoch);
});

test('B: a burst of invalidations coalesces obsolete observations instead of building a page-script backlog', async () => {
  let part='1',calls=0;
  const sessions=new VideoSessions({
    observe:async()=>{const captured=part;calls++;await new Promise(r=>setTimeout(r,6));return {documentId:'doc',marker:captured,source:{platform:'bilibili' as const,videoId:'BVburst',partId:captured,title:`P${captured}`}};},
    read:async()=>({status:'ready' as const,cues:[{from:0,to:1,content:`字幕 ${part}`}],language:'zh'}),
    seek:async()=>({time:0,paused:true})
  });
  const started=Date.now(),pending:Promise<unknown>[]=[];
  for(let i=1;i<=40;i++){part=String(i);sessions.invalidate(1);pending.push(sessions.observe(1));}
  await Promise.all(pending);
  const latest=await sessions.observe(1),elapsed=Date.now()-started;
  expect(latest.binding?.partId).toBe('40');
  expect(calls).toBeLessThanOrEqual(4);
  expect(elapsed).toBeLessThan(100);
});

test('B: a transient subtitle read failure recovers without a page refresh or manual retry', async () => {
  let attempts=0;
  const sessions=new VideoSessions({
    observe:async()=>({documentId:'doc',marker:'1',source:{platform:'bilibili' as const,videoId:'BVrecover',partId:'1',title:'恢复测试'}}),
    read:async()=>++attempts===1?{status:'read-failed' as const,cues:[],language:null}:{status:'ready' as const,cues:[{from:0,to:1,content:'自动恢复字幕'}],language:'zh'},
    seek:async()=>({time:0,paused:true})
  });
  await sessions.observe(1);
  await new Promise(r=>setTimeout(r,800));
  expect(await sessions.observe(1)).toMatchObject({status:'ready',cues:[{content:'自动恢复字幕'}]});
  expect(attempts).toBe(2);
});
