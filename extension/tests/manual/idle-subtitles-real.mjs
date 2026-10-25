// Owned isolated test profile only. Never reads or attaches to a personal browser.
import {chromium} from '@playwright/test';
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const output=resolve(process.env.VCAMP_IDLE_OUTPUT??'../.tmp/idle-real-baseline');
await mkdir(output,{recursive:true});
const bundle=await mkdtemp(resolve(output,'bundle-'));
await cp(resolve(process.env.VCAMP_IDLE_PACKAGE??'dist'),bundle,{recursive:true});
const version=JSON.parse(await readFile(resolve(bundle,'manifest.json'),'utf8')).version;
const context=await chromium.launchPersistentContext(resolve('../.tmp/spa-login-profile'),{channel:'chromium',headless:false,viewport:{width:1200,height:900},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
const result={version,stages:[],api:[],pass:false};
let panel,site;
try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  panel=await context.newPage();await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
  result.runtimeVersion=await panel.evaluate(()=>chrome.runtime.getManifest().version);
  assert.equal(result.runtimeVersion,version,'The isolated browser must run the selected package');
  site=await context.newPage();
  // Keep a short target video from auto-advancing into recommendations while
  // we diagnose its own binding. No player or extension identity is mocked.
  await site.addInitScript(()=>document.addEventListener('play',event=>{if(event.target instanceof HTMLVideoElement)event.target.pause();},true));
  site.on('response',async response=>{
    const url=new URL(response.url());
    if(url.origin==='https://api.bilibili.com'&&['/x/web-interface/view','/x/player/wbi/playurl','/x/player/wbi/v2','/x/player/v2'].includes(url.pathname)){
      const json=await response.json().catch(()=>null);
      result.api.push({path:url.pathname,http:response.status(),code:json?.code,bvid:url.searchParams.get('bvid'),cid:url.searchParams.get('cid'),tracks:json?.data?.subtitle?.subtitles?.length});
    }
  });
  const query=()=>panel.evaluate(async()=>Promise.race([
    chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'workspace.query'}}).then(r=>({ok:r.ok,code:r.code,title:r.view?.title,video:r.view?.video&&{binding:r.view.video.binding,status:r.view.video.status,cueCount:r.view.video.cues?.length,tracks:r.view.video.tracks?.map(t=>({language:t.language,status:t.status,cueCount:t.cues.length}))}})),
    new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),4000))
  ]));
  const stage=async(name,bvid)=>{
    const samples=[],start=Date.now();let ready=false;
    do{
      const sample=await query();samples.push({ms:Date.now()-start,...sample});
      if(sample.video?.binding?.videoId===bvid&&['ready','no-subtitles'].includes(sample.video.status)){ready=true;break;}
      await new Promise(r=>setTimeout(r,1000));
    }while(Date.now()-start<30000);
    const media=await site.evaluate(()=>{
      const v=document.querySelector('video'),p=window.player,s=window.__INITIAL_STATE__?.videoData;let decoded;
      try{const url=new URL(p?.getMediaInfo?.()?.playUrl);decoded={protocol:url.protocol,host:url.hostname,path:url.pathname};}catch{}
      let inlineVideo=[];
      for(const script of document.scripts){const match=/^\s*window\.__playinfo__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(script.textContent??'');if(match){try{const data=JSON.parse(match[1]).data;inlineVideo=[...(data?.dash?.video??[]).flatMap(v=>[v.baseUrl,v.base_url,...(v.backupUrl??v.backup_url??[])]),...(data?.durl??[]).flatMap(v=>[v.url,...(v.backup_url??[])])].filter(Boolean).map(raw=>{const u=new URL(raw);return {host:u.hostname,path:u.pathname};});}catch{}}}
      return {path:location.pathname,readyState:v?.readyState,playerElementMatches:p?.mediaElement?.()===v,blob:v?.currentSrc?.startsWith('blob:'),initialBvid:s?.bvid,pages:s?.pages?.map(p=>({page:p.page,cid:p.cid})),manifest:p?.getManifest?.(),decoded,inlineVideo,hasMessage:typeof p?.getVideoMessage==='function',requestPaths:performance.getEntriesByType('resource').filter(e=>e.name.startsWith('https://api.bilibili.com/')).map(e=>{const u=new URL(e.name);return {path:u.pathname,bvid:u.searchParams.get('bvid'),cid:u.searchParams.get('cid')};}).slice(-20)};
    });
    result.stages.push({name,ready,samples,media});
    console.log(name,JSON.stringify({ready,elapsed:Date.now()-start,last:samples.at(-1),media:{path:media.path,decoded:media.decoded,inlineVideoCount:media.inlineVideo.length}}));
    return ready;
  };
  const target='BV1Vtnn6TEd2';
  await site.goto('https://www.bilibili.com/video/BV1Y3rHBSE1n/',{waitUntil:'domcontentloaded',timeout:30000});
  await stage('initial-A','BV1Y3rHBSE1n');
  await site.evaluate(()=>document.querySelector('video')?.pause());
  await new Promise(r=>setTimeout(r,Number(process.env.VCAMP_IDLE_MS??15000)));
  if(process.argv.includes('--restart-worker')){
    const cdp=await context.newCDPSession(site),versions=new Map();
    cdp.on('ServiceWorker.workerVersionUpdated',event=>{for(const v of event.versions)versions.set(v.versionId,v);});
    await cdp.send('ServiceWorker.enable');
    const deadline=Date.now()+5000;
    while(![...versions.values()].some(v=>v.scriptURL===worker.url())&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
    const version=[...versions.values()].find(v=>v.scriptURL===worker.url());assert.ok(version);
    await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId});await cdp.detach();result.workerStopped=true;
  }
  await site.goto(`https://www.bilibili.com/video/${target}/`,{waitUntil:'domcontentloaded',timeout:30000});
  const first=await stage('idle-then-target',target);
  await site.reload({waitUntil:'domcontentloaded',timeout:30000});
  const refreshed=await stage('target-refresh',target);
  await panel.reload();
  const reopened=await stage('target-panel-reopen',target);
  const bound=await query();
  if(bound.video?.binding){
    const retry=await panel.evaluate(async binding=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'video.retry',binding}}),bound.video.binding);
    result.manualRetry={ok:retry.ok,code:retry.code};
    assert.equal(retry.ok,true,'Manual retry must complete after recovery');
    assert.equal(await stage('target-manual-retry',target),true);
  }
  if(first&&refreshed&&reopened){
    await panel.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await panel.locator('.subtitle-row').first().waitFor({state:'visible'});
    result.renderedCueCount=await panel.locator('.subtitle-row').count();assert.equal(result.renderedCueCount,13);
  }
  await panel.screenshot({path:resolve(output,'target-panel.png')});
  result.pass=first&&refreshed&&reopened;
  assert.equal(result.pass,true,'The user video must connect and expose complete subtitles across idle, refresh and panel reopen');
}catch(error){result.error=error.message;process.exitCode=1;console.log('FAIL',error.message);}
finally{await writeFile(resolve(output,'result.json'),JSON.stringify(result,null,2));await context.close();}
