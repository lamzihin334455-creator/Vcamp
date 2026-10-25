import { expect, test } from 'vitest';
import { readCompleteSubtitles } from '../../src/video/subtitles';

test('B: complete original track includes the tail without watching the video', async () => {
  const result = await readCompleteSubtitles({
    metadata: async () => ({ http: 200, json: { code: 0, data: { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: 'https://aisubtitle.hdslb.com/test.json' }] } } } }),
    track: async () => ({ http: 200, json: { body: [{ from: 0, to: 2, content: '开头' }, { from: 7198, to: 7200, content: '末尾' }] } })
  }, new AbortController().signal);
  const cues = [{ from: 0, to: 2, content: '开头' }, { from: 7198, to: 7200, content: '末尾' }];
  expect(result).toEqual({ status: 'ready', language: 'zh-CN', cues, tracks: [{ language: 'zh-CN', label: 'zh-CN', status: 'ready', cues, rawJson: JSON.stringify({ body: cues }) }] });
});

test.each([
  [200, { code: 0, data: { subtitle: { subtitles: [] } } }, 'no-subtitles'],
  [200, { code: 0, data: { subtitle: {} } }, 'read-failed'],
  [401, { code: -101 }, 'auth-failed'],
  [403, { code: -403 }, 'permission-denied'],
  [500, { code: 0 }, 'read-failed'],
  [200, { code: -404 }, 'read-failed']
])('B: metadata %j / %j is classified as %s', async (http, json, status) => {
  expect(await readCompleteSubtitles({ metadata: async () => ({ http, json }), track: async () => { throw new Error(); } }, new AbortController().signal)).toEqual({ status, cues: [], language: null });
});

test.each(['https://evil.example/subtitle', 'https://aisubtitle.hdslb.com@evil.example/subtitle', 'http://aisubtitle.hdslb.com/subtitle'])('B: site supplied subtitle URL cannot expand access: %s', async subtitle_url => {
  expect(await readCompleteSubtitles({ metadata: async () => ({ http: 200, json: { code: 0, data: { subtitle: { subtitles: [{ lan: 'zh', subtitle_url }] } } } }), track: async () => { throw new Error('must not access'); } }, new AbortController().signal)).toMatchObject({ status: 'read-failed', cues: [] });
});

test('B: malformed track body and network failure are retryable failures, not no subtitles', async () => {
  const metadata = async () => ({ http: 200, json: { code: 0, data: { subtitle: { subtitles: [{ lan: 'zh', subtitle_url: '//aisubtitle.hdslb.com/test' }] } } } });
  for (const body of [[], [{ from: 3, to: 2, content: '错误' }], [{ from: 3, to: 4, content: '后' }, { from: 1, to: 2, content: '前' }]]) {
    expect(await readCompleteSubtitles({ metadata, track: async () => ({ http: 200, json: { body } }) }, new AbortController().signal)).toMatchObject({ status: 'read-failed', cues: [] });
  }
  expect(await readCompleteSubtitles({ metadata: async () => { throw new Error('offline'); }, track: async () => { throw new Error(); } }, new AbortController().signal)).toMatchObject({ status: 'read-failed', cues: [] });
});

test('B: login-required wins over malformed or missing tracks', async () => {
  expect(await readCompleteSubtitles({ metadata: async () => ({ http: 200, json: { code: 0, data: { need_login_subtitle: true, subtitle: { subtitles: null } } } }), track: async () => { throw new Error('must not read'); } }, new AbortController().signal))
    .toMatchObject({ status: 'auth-failed', cues: [] });
});

test('a failed preferred track does not disable another complete native language', async () => {
  const cues=[{from:0,to:2,content:'Available English'}];
  const result=await readCompleteSubtitles({
    metadata:async()=>({http:200,json:{code:0,data:{subtitle:{subtitles:['zh-CN','en'].map(lan=>({lan,subtitle_url:`https://aisubtitle.hdslb.com/${lan}.json`}))}}}}),
    track:async url=>url.endsWith('/zh-CN.json')?{http:403,json:null}:{http:200,json:{body:cues}}
  },new AbortController().signal);
  expect(result).toMatchObject({status:'ready',language:'en',cues,tracks:[{language:'zh-CN',status:'permission-denied'},{language:'en',status:'ready'}]});
});
