import {chromium,expect,test} from '@playwright/test';
import {cp,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

test('rapid same-document video and part switches settle on the latest complete subtitles without refresh',async()=>{
  test.setTimeout(90_000);
  const output=resolve('../.tmp/video-switch-stress');await mkdir(output,{recursive:true});
  const bundle=await mkdtemp(resolve(output,'bundle-'));await cp(resolve(process.env.EXPERIENCE_BUNDLE ?? 'dist'),bundle,{recursive:true});
  const context=await chromium.launchPersistentContext(await mkdtemp(resolve(output,'profile-')),{channel:'chromium',headless:true,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
  const requests:number[]=[];
  try{
    await context.route('https://www.bilibili.com/video/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><video></video><script>
      let current={index:0,part:1,cid:1};
      function apply(index,part){const cid=index*10+part;current={index,part,cid};window.__INITIAL_STATE__={videoData:{bvid:'BVstress'+index,title:'压力视频 '+index,pages:[{page:1,cid:index*10+1,part:'第一部分'},{page:2,cid:index*10+2,part:'第二部分'}]}};window.player={getVideoMessage:()=>({bvid:'BVstress'+current.index,cid:current.cid})};}
      window.go=(index,part)=>{apply(index,part);history.pushState({},'', '/video/BVstress'+index+'/?p='+part);return fetch('https://api.bilibili.com/x/player/wbi/v2?cid='+(index*10+part)+'&bvid=BVstress'+index);};
      apply(0,1);window.go(0,1);
    </script>`}));
    await context.route('https://api.bilibili.com/**',async route=>{const cid=Number(new URL(route.request().url()).searchParams.get('cid'));requests.push(cid);await new Promise(r=>setTimeout(r,cid%4===0?120:5));await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',lan_doc:'中文',subtitle_url:`https://aisubtitle.hdslb.com/${cid}.json`}]}}})});});
    await context.route('https://aisubtitle.hdslb.com/**',async route=>{const cid=Number(new URL(route.request().url()).pathname.slice(1,-5));await new Promise(r=>setTimeout(r,cid%5===0?180:8));await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({body:[{from:0,to:2,content:`STRESS-SUBTITLE-${cid}`} ]})});});
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const site=await context.newPage();await site.goto('https://www.bilibili.com/video/BVstress0/?p=1');await site.bringToFront();
    const query=()=>panel.evaluate(async()=> (await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation:{type:'workspace.query'}})).view);
    await expect.poll(async()=> (await query())?.video?.status,{timeout:20_000}).toBe('ready');
    await site.evaluate(async()=>{for(let i=1;i<=40;i++){await (window as any).go(i,i%2+1);await new Promise(r=>setTimeout(r,4));}});
    const started=Date.now();
    await expect.poll(async()=>{const video=(await query())?.video;return {source:video?.binding?.videoId,part:video?.binding?.partId,status:video?.status,cue:video?.cues?.[0]?.content};},{timeout:10_000,intervals:[20,40,80,120]}).toEqual({source:'BVstress40',part:'401',status:'ready',cue:'STRESS-SUBTITLE-401'});
    const elapsed=Date.now()-started;
    expect(elapsed).toBeLessThan(1_500);
    await panel.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(panel.getByText('STRESS-SUBTITLE-401',{exact:true})).toBeVisible();
    await expect(panel.getByText(/STRESS-SUBTITLE-(?!401)/)).toHaveCount(0);
    await writeFile(resolve(output,'result.json'),JSON.stringify({switches:40,elapsed,playerRequests:requests.length,final:'BVstress40/401'},null,2));
  }finally{await context.close();}
});

test('rapid video-tab activation and a non-video tab retain and recover the latest ready subtitles',async()=>{
  test.setTimeout(90_000);
  const output=resolve('../.tmp/video-tab-stress');await mkdir(output,{recursive:true});
  const bundle=await mkdtemp(resolve(output,'bundle-'));await cp(resolve(process.env.EXPERIENCE_BUNDLE ?? 'dist'),bundle,{recursive:true});
  const context=await chromium.launchPersistentContext(await mkdtemp(resolve(output,'profile-')),{channel:'chromium',headless:true,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
  try{
    await context.route('https://www.bilibili.com/video/**',route=>{const url=new URL(route.request().url()),videoId=url.pathname.split('/')[2],index=Number(videoId.replace('BVtabs','')),cid=index*100+1;return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><video></video><script>window.__INITIAL_STATE__={videoData:{bvid:'${videoId}',title:'标签视频 ${index}',pages:[{page:1,cid:${cid},part:'唯一部分'}]}};window.player={getVideoMessage:()=>({bvid:'${videoId}',cid:${cid}})};fetch('https://api.bilibili.com/x/player/wbi/v2?cid=${cid}&bvid=${videoId}');</script>`});});
    await context.route('https://api.bilibili.com/**',async route=>{const cid=Number(new URL(route.request().url()).searchParams.get('cid'));await new Promise(r=>setTimeout(r,cid%300===1?140:12));await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',lan_doc:'中文',subtitle_url:`https://aisubtitle.hdslb.com/tab-${cid}.json`}]}}})});});
    await context.route('https://aisubtitle.hdslb.com/**',async route=>{const cid=Number(/tab-(\d+)\.json/.exec(new URL(route.request().url()).pathname)?.[1]);await new Promise(r=>setTimeout(r,cid%200===1?120:6));await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({body:[{from:0,to:2,content:`TAB-SUBTITLE-${cid}`}]})});});
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const tabs=[];for(let i=1;i<=4;i++){const tab=await context.newPage();await tab.goto(`https://www.bilibili.com/video/BVtabs${i}/?p=1`);tabs.push(tab);}
    const nonVideo=await context.newPage();await nonVideo.goto('data:text/html,<title>普通页面</title>');
    const query=()=>panel.evaluate(async()=> (await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation:{type:'workspace.query'}})).view);
    for(let round=0;round<12;round++)for(const tab of [...tabs].reverse())await tab.bringToFront();
    await tabs[3].bringToFront();
    await expect.poll(async()=>{const video=(await query())?.video;return {videoId:video?.binding?.videoId,status:video?.status,cue:video?.cues?.[0]?.content};},{timeout:10_000,intervals:[20,40,80]}).toEqual({videoId:'BVtabs4',status:'ready',cue:'TAB-SUBTITLE-401'});
    await panel.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(panel.getByText('TAB-SUBTITLE-401',{exact:true})).toBeVisible();
    await nonVideo.bringToFront();await new Promise(r=>setTimeout(r,300));
    await expect(panel.getByText('TAB-SUBTITLE-401',{exact:true})).toBeVisible();
    expect((await query()).title).toContain('标签视频 4');
    await tabs[1].bringToFront();
    await expect.poll(async()=>{const video=(await query())?.video;return {videoId:video?.binding?.videoId,status:video?.status,cue:video?.cues?.[0]?.content};},{timeout:5_000,intervals:[20,40,80]}).toEqual({videoId:'BVtabs2',status:'ready',cue:'TAB-SUBTITLE-201'});
  }finally{await context.close();}
});

test('a one-off subtitle metadata failure automatically recovers without refreshing the video or extension',async()=>{
  test.setTimeout(60_000);
  const output=resolve('../.tmp/video-recovery-stress');await mkdir(output,{recursive:true});
  const bundle=await mkdtemp(resolve(output,'bundle-'));await cp(resolve(process.env.EXPERIENCE_BUNDLE ?? 'dist'),bundle,{recursive:true});
  const context=await chromium.launchPersistentContext(await mkdtemp(resolve(output,'profile-')),{channel:'chromium',headless:true,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
  let metadataCalls=0;
  try{
    await context.route('https://www.bilibili.com/video/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><video></video><script>window.__INITIAL_STATE__={videoData:{bvid:'BVrecover',title:'自动恢复视频',pages:[{page:1,cid:77,part:'唯一部分'}]}};window.player={getVideoMessage:()=>({bvid:'BVrecover',cid:77})};fetch('https://api.bilibili.com/x/player/wbi/v2?cid=77&bvid=BVrecover');</script>`}));
    await context.route('https://api.bilibili.com/**',route=>{metadataCalls++;const ok=metadataCalls>=3;return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify(ok?{code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',lan_doc:'中文',subtitle_url:'https://aisubtitle.hdslb.com/recover.json'}]}}}:{code:-500,data:null})});});
    await context.route('https://aisubtitle.hdslb.com/recover.json',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({body:[{from:0,to:2,content:'RECOVERED-SUBTITLE'}]})}));
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const site=await context.newPage();await site.goto('https://www.bilibili.com/video/BVrecover/?p=1');await site.bringToFront();
    await expect(panel.locator('.context-current-button strong')).toContainText('自动恢复视频',{timeout:10_000});
    await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪',{timeout:10_000});
    await panel.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(panel.getByText('RECOVERED-SUBTITLE',{exact:true})).toBeVisible();
    expect(metadataCalls).toBe(3);
  }finally{await context.close();}
});

test('a same-tab SPA jump recovers when the new player identity becomes ready after the last navigation event',async()=>{
  test.setTimeout(60_000);
  const output=resolve('../.tmp/video-delayed-player-switch');await mkdir(output,{recursive:true});
  const bundle=await mkdtemp(resolve(output,'bundle-'));await cp(resolve(process.env.EXPERIENCE_BUNDLE ?? 'dist'),bundle,{recursive:true});
  const context=await chromium.launchPersistentContext(await mkdtemp(resolve(output,'profile-')),{channel:'chromium',headless:true,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
  try{
    await context.route('https://www.bilibili.com/video/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><video></video><script>
      let live={bvid:'BVdelayedA',cid:101};
      const state=(bvid,cid,title)=>({videoData:{bvid,title,pages:[{page:1,cid,part:'唯一部分'}]}});
      window.__INITIAL_STATE__=state('BVdelayedA',101,'延迟切换 A');
      window.player={getVideoMessage:()=>live};
      window.jumpToB=()=>{
        history.pushState({},'', '/video/BVdelayedB/?p=1');
        fetch('https://api.bilibili.com/x/web-interface/view?bvid=BVdelayedB');
        fetch('https://api.bilibili.com/x/player/wbi/v2?cid=202&bvid=BVdelayedB');
        setTimeout(()=>{live={bvid:'BVdelayedB',cid:202};},450);
      };
      fetch('https://api.bilibili.com/x/player/wbi/v2?cid=101&bvid=BVdelayedA');
    </script>`}));
    await context.route('https://api.bilibili.com/**',route=>{const url=new URL(route.request().url());if(url.pathname==='/x/web-interface/view')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{bvid:'BVdelayedB',title:'延迟切换 B',pages:[{page:1,cid:202,part:'唯一部分'}]}})});const cid=Number(url.searchParams.get('cid'));return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',lan_doc:'中文',subtitle_url:`https://aisubtitle.hdslb.com/delayed-${cid}.json`}]}}})});});
    await context.route('https://aisubtitle.hdslb.com/**',route=>{const cid=Number(/delayed-(\d+)\.json/.exec(new URL(route.request().url()).pathname)?.[1]);return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({body:[{from:0,to:2,content:`DELAYED-SUBTITLE-${cid}`}]})});});
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const site=await context.newPage();await site.goto('https://www.bilibili.com/video/BVdelayedA/?p=1');await site.bringToFront();
    const query=()=>panel.evaluate(async()=> (await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation:{type:'workspace.query'}})).view);
    await expect.poll(async()=>{const video=(await query())?.video;return {videoId:video?.binding?.videoId,status:video?.status,cue:video?.cues?.[0]?.content};},{timeout:10_000}).toEqual({videoId:'BVdelayedA',status:'ready',cue:'DELAYED-SUBTITLE-101'});
    await site.evaluate(()=>(window as any).jumpToB());
    await expect.poll(async()=>{const video=(await query())?.video;return {videoId:video?.binding?.videoId,status:video?.status,cue:video?.cues?.[0]?.content};},{timeout:5_000,intervals:[50,100,200,500]}).toEqual({videoId:'BVdelayedB',status:'ready',cue:'DELAYED-SUBTITLE-202'});
  }finally{await context.close();}
});

test('clicking an internal video link in the same tab settles on a delayed no-subtitle video without refresh',async()=>{
  test.setTimeout(60_000);
  const output=resolve('../.tmp/video-internal-link-switch');await mkdir(output,{recursive:true});
  const bundle=await mkdtemp(resolve(output,'bundle-'));await cp(resolve(process.env.EXPERIENCE_BUNDLE ?? 'dist'),bundle,{recursive:true});
  const context=await chromium.launchPersistentContext(await mkdtemp(resolve(output,'profile-')),{channel:'chromium',headless:true,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
  try{
    await context.route('https://www.bilibili.com/video/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><video></video><a id="internal" href="/video/BVlinkB/?p=1">站内视频 B</a><script>
      let live={bvid:'BVlinkA',cid:301};
      window.__INITIAL_STATE__={videoData:{bvid:'BVlinkA',title:'站内跳转 A',pages:[{page:1,cid:301,part:'唯一部分'}]}};
      window.player={getVideoMessage:()=>live};
      document.querySelector('#internal').addEventListener('click',event=>{
        event.preventDefault();history.pushState({},'',event.currentTarget.href);
        fetch('https://api.bilibili.com/x/player/wbi/v2?cid=302');
        fetch('https://api.bilibili.com/x/web-interface/view?bvid=BVlinkB');
        setTimeout(()=>{live={bvid:'BVlinkB',cid:302};},2400);
      });
      fetch('https://api.bilibili.com/x/player/wbi/v2?cid=301&bvid=BVlinkA');
    </script>`}));
    await context.route('https://api.bilibili.com/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/x/web-interface/view'){await new Promise(resolve=>setTimeout(resolve,650));return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{bvid:'BVlinkB',title:'站内跳转 B（无字幕）',pages:[{page:1,cid:302,part:'唯一部分'}]}})});}const cid=Number(url.searchParams.get('cid'));return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify(cid===301?{code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',lan_doc:'中文',subtitle_url:'https://aisubtitle.hdslb.com/link-a.json'}]}}}:{code:0,data:{subtitle:{subtitles:[]}}})});});
    await context.route('https://aisubtitle.hdslb.com/link-a.json',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({body:[{from:0,to:2,content:'LINK-A-SUBTITLE'}]})}));
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const site=await context.newPage();await site.goto('https://www.bilibili.com/video/BVlinkA/?p=1');await site.bringToFront();
    const query=()=>panel.evaluate(async()=> (await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation:{type:'workspace.query'}})).view);
    await expect.poll(async()=>{const video=(await query())?.video;return {videoId:video?.binding?.videoId,status:video?.status};},{timeout:10_000}).toEqual({videoId:'BVlinkA',status:'ready'});
    await site.locator('#internal').click();
    await expect.poll(async()=>{const view=await query(),video=view?.video;return {title:view?.title,videoId:video?.binding?.videoId,status:video?.status,cues:video?.cues?.length};},{timeout:8_000,intervals:[50,100,250,500]}).toEqual({title:'站内跳转 B（无字幕）',videoId:'BVlinkB',status:'no-subtitles',cues:0});
  }finally{await context.close();}
});

test('a real Bilibili-shaped SPA switch works without legacy window.player identity APIs',async()=>{
  test.setTimeout(45_000);
  const output=resolve('../.tmp/video-real-spa-shape');await mkdir(output,{recursive:true});
  const bundle=await mkdtemp(resolve(output,'bundle-'));await cp(resolve(process.env.EXPERIENCE_BUNDLE ?? 'dist'),bundle,{recursive:true});
  const context=await chromium.launchPersistentContext(await mkdtemp(resolve(output,'profile-')),{channel:'chromium',headless:true,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
  try{
    await context.route('https://www.bilibili.com/video/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><video></video><a id="internal" href="/video/BVrealB/">站内视频 B</a><script>
      window.__INITIAL_STATE__={videoData:{bvid:'BVrealA',title:'真实形态 A',pages:[{page:1,cid:701,part:'唯一部分'}]}};
      window.player={};
      const media=document.querySelector('video');let decoder='blob:https://www.bilibili.com/decoder-a';
      Object.defineProperty(media,'currentSrc',{configurable:true,get:()=>decoder});Object.defineProperty(media,'readyState',{configurable:true,get:()=>4});
      document.querySelector('#internal').addEventListener('click',event=>{
        event.preventDefault();history.pushState({},'',event.currentTarget.href);
        fetch('https://api.bilibili.com/x/web-interface/view?bvid=BVrealB');
        fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BVrealB&cid=702');
        fetch('https://api.bilibili.com/x/player/wbi/v2?bvid=BVrealB&cid=702');
        setTimeout(()=>{media.dispatchEvent(new Event('loadstart'));decoder='blob:https://www.bilibili.com/decoder-b';media.dispatchEvent(new Event('loadedmetadata'));},250);
      });
      fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BVrealA&cid=701');
      fetch('https://api.bilibili.com/x/player/wbi/v2?bvid=BVrealA&cid=701');
    </script>`}));
    await context.route('https://api.bilibili.com/**',route=>{const url=new URL(route.request().url());
      if(url.pathname==='/x/web-interface/view')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{bvid:'BVrealB',title:'真实形态 B',pages:[{page:1,cid:702,part:'唯一部分'}]}})});
      if(url.pathname==='/x/player/wbi/playurl')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{dash:{video:[{baseUrl:'https://cdn.example.test/video.m4s'}]}}})});
      const cid=Number(url.searchParams.get('cid'));return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',lan_doc:'中文',subtitle_url:`https://aisubtitle.hdslb.com/real-${cid}.json`}]}}})});
    });
    await context.route('https://aisubtitle.hdslb.com/**',route=>{const cid=Number(/real-(\d+)\.json/.exec(new URL(route.request().url()).pathname)?.[1]);return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({body:[{from:0,to:2,content:`REAL-SPA-SUBTITLE-${cid}`}]})});});
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const site=await context.newPage();await site.goto('https://www.bilibili.com/video/BVrealA/');await site.bringToFront();
    const query=()=>panel.evaluate(async()=> (await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation:{type:'workspace.query'}})).view);
    await expect.poll(async()=>{const video=(await query())?.video;return {videoId:video?.binding?.videoId,status:video?.status,cue:video?.cues?.[0]?.content};},{timeout:8_000,intervals:[50,100,250]}).toEqual({videoId:'BVrealA',status:'ready',cue:'REAL-SPA-SUBTITLE-701'});
    await site.locator('#internal').click();
    await expect.poll(async()=>{const video=(await query())?.video;return {videoId:video?.binding?.videoId,status:video?.status,cue:video?.cues?.[0]?.content};},{timeout:8_000,intervals:[50,100,250]}).toEqual({videoId:'BVrealB',status:'ready',cue:'REAL-SPA-SUBTITLE-702'});
  }finally{await context.close();}
});
