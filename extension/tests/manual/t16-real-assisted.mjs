// Diagnostic only: Playwright applies page focus emulation. No provider config, model requests or user profile.
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const output=resolve('../.tmp/t16-real-'+Date.now());await mkdir(output,{recursive:true});
const bundle=join(output,'package');await cp(resolve('dist-capture'),bundle,{recursive:true});
const manifest=JSON.parse(await readFile(join(bundle,'manifest.json'),'utf8'));manifest.host_permissions.push(...manifest.optional_host_permissions);delete manifest.optional_host_permissions;await writeFile(join(bundle,'manifest.json'),JSON.stringify(manifest));
const result={acceptanceEligible:false,assistedMediaFocus:true,date:new Date().toISOString(),actualModelApiCalls:0,profile:join(output,'profile'),scope:'One real-site production lease: 1s, source P2->P3, 5s. No real model-quality claim.',checks:[]};
const context=await chromium.launchPersistentContext(result.profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${bundle}`,`--load-extension=${bundle}`],viewport:{width:1280,height:800}});
try{
  result.browser=context.browser().version();const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const probe=await context.newPage();await probe.goto(`chrome-extension://${id}/tests/installed/t16-media-probe.html`);await probe.waitForFunction(()=>typeof window.acquireOriginal==='function');
  const site=await context.newPage();await site.goto('https://www.bilibili.com/video/BV1UR4y1K7Fw/?p=2',{waitUntil:'domcontentloaded'});
  await site.waitForFunction(()=>document.querySelector('video')?.readyState>=2,{},{timeout:40000});
  const tab=await probe.evaluate(async()=> (await chrome.tabs.query({url:'https://www.bilibili.com/video/*'})).find(t=>t.active)?.id);assert(tab);
  const ready=await probe.evaluate(tab=>window.acquireOriginal(tab),tab);result.ready=ready;
  const save=async(time)=>{const frame=await probe.evaluate(time=>window.captureOriginal(time),time);assert(Math.abs(frame.time-time)<0.2);const bytes=Buffer.from(frame.dataUrl.slice(22),'base64');await writeFile(join(output,`frame-${time}.png`),bytes);result.checks.push({time:frame.time,width:frame.width,height:frame.height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});};
  await save(1);
  await site.goto('https://www.bilibili.com/video/BV1UR4y1K7Fw/?p=3',{waitUntil:'domcontentloaded'});await site.waitForFunction(()=>document.querySelector('video')?.readyState>=2,{},{timeout:40000});
  const before=await site.evaluate(async()=>{const v=document.querySelector('video');v.pause();v.playbackRate=1.25;await new Promise(r=>{v.addEventListener('seeked',r,{once:true});v.currentTime=3;});window.t16Events=[];for(const e of ['seeking','play','pause'])v.addEventListener(e,()=>window.t16Events.push(e));return {time:v.currentTime,paused:v.paused,rate:v.playbackRate};});
  await save(5);const after=await site.evaluate(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,rate:v.playbackRate,events:window.t16Events};});assert.deepEqual({...after,events:undefined},{...before,events:undefined});assert.deepEqual(after.events,[]);result.sourceOperations={before,after};
  await probe.evaluate(()=>window.releaseOriginal());assert.equal(await probe.evaluate(()=>chrome.storage.session.get(null).then(x=>Object.keys(x).filter(k=>k.startsWith('vcamp.media.')).length)),0);result.pass=true;
}catch(error){result.pass=false;result.error=String(error);console.error(error);process.exitCode=1;}
finally{await writeFile(join(output,'results.json'),JSON.stringify(result,null,2));await context.close();console.log('REAL_EVIDENCE',output);}
