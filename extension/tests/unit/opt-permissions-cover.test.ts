import 'fake-indexeddb/auto';
import {test,expect,vi,afterEach} from 'vitest';
import {createChromeVideo} from '../../src/video/chrome-video';
import {coverUrl} from '../../src/video/cover';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedLibraryStore} from '../../src/data/library-store';
import {IndexedScribbleStore} from '../../src/data/scribble-store';
import {videoStatusLabel} from '../../src/contracts/video';
afterEach(()=>vi.unstubAllGlobals());
test('browser revocation invalidates cached subtitles; restoration re-reads automatically and site 403 stays distinct',async()=>{
  let pageAccess=true,subtitleAccess=true,siteDenied=false;const events=new Map<string,()=>void>(),event=(name:string)=>({addListener(fn:()=>void){events.set(name,fn);}});
  vi.stubGlobal('chrome',{
    permissions:{contains:async({origins}:{origins:string[]})=>origins.includes('https://www.bilibili.com/*')?pageAccess:subtitleAccess,onAdded:event('added'),onRemoved:event('removed')},
    tabs:{get:async()=>({url:'https://www.bilibili.com/video/BVfixture/'}),query:async(options:{url?:string})=>options.url?[]:[{id:1}],onRemoved:event('tabRemoved'),onActivated:event('active')},
    webNavigation:{onCommitted:event('commit'),onHistoryStateUpdated:event('history')},
    scripting:{getRegisteredContentScripts:async()=>[{id:'vcamp-video'}],executeScript:async(options:{func?:{name:string}})=>{
      if(options.func?.name==='guardMedia')return [{documentId:'doc',result:{revision:1}}];
      if(options.func?.name==='inspectMedia')return [{documentId:'doc',result:{status:'supported',source:{platform:'bilibili',videoId:'BVfixture',partId:'1',title:'夹具'}}}];
      return [{documentId:'doc',result:{http:siteDenied?403:200,json:{code:siteDenied?-403:0,data:{subtitle:{subtitles:[]}}}}}];
    }}
  });
  const port=createChromeVideo(()=>{}),settle=async()=>{await new Promise(resolve=>setTimeout(resolve,0));return port.current();};
  await port.current();expect((await settle()).status).toBe('no-subtitles');
  pageAccess=false;events.get('removed')!();expect((await settle()).status).toBe('permission-denied');
  pageAccess=true;subtitleAccess=false;events.get('added')!();await settle();const missing=await settle();expect(missing.status).toBe('browser-permission-denied');expect(videoStatusLabel(missing)).toContain('浏览器');
  subtitleAccess=true;siteDenied=true;events.get('added')!();await settle();const denied=await settle();expect(denied.status).toBe('permission-denied');expect(videoStatusLabel(denied)).toContain('字幕服务');
  siteDenied=false;events.get('added')!();await settle();expect((await settle()).status).toBe('no-subtitles');
});
test('trusted site cover normalizes HTTPS without URL parameters, backfills visited legacy P and shares same video',async()=>{
  expect(coverUrl('http://i1.hdslb.com/bfs/archive/real.jpg?token=hidden#x')).toBe('https://i1.hdslb.com/bfs/archive/real.jpg');
  for(const url of ['javascript:1','https://i1.hdslb.com.evil/bfs/a','https://user@i1.hdslb.com/bfs/a','https://i1.hdslb.com:81/bfs/a','https://i1.hdslb.com/other/a'])expect(coverUrl(url)).toBeUndefined();
  const db=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(db),library=new IndexedLibraryStore(db),source={platform:'bilibili' as const,videoId:'BVcover',partId:'1',title:'旧资料',pageNumber:1};
  const first=await spaces.open(source),second=await spaces.open({...source,partId:'2',pageNumber:2});
  // Recent library membership requires saved content, not merely browsing.
  await new IndexedScribbleStore(db).create(first.id,'封面测试资料',null);
  expect((await library.query()).videos[0].coverUrl).toBeUndefined();
  const url='https://i1.hdslb.com/bfs/archive/real.jpg';await library.recordObservation({...source,coverUrl:url},1,Date.now());expect((await spaces.read(second.id))!.source.coverUrl).toBe(url);expect((await library.query()).videos[0].coverUrl).toBe(url);await spaces.open(source);expect((await spaces.read(first.id))!.source.coverUrl).toBe(url);
});
