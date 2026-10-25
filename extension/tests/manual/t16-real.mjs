// Normal Chrome root CDP; never attaches to or activates the disposable host.
// No model configuration, model API or user profile.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const output=resolve('../.tmp/t16-real-normal-'+Date.now());await mkdir(output,{recursive:true});
const bundle=join(output,'package');await cp(resolve('dist-capture'),bundle,{recursive:true});
const manifest=JSON.parse(await readFile(join(bundle,'manifest.json'),'utf8'));manifest.host_permissions.push(...manifest.optional_host_permissions);delete manifest.optional_host_permissions;await writeFile(join(bundle,'manifest.json'),JSON.stringify(manifest));
const profile=join(output,'profile'),result={date:new Date().toISOString(),profile,actualModelApiCalls:0,assistedMediaFocus:false,checks:[]};
const child=spawn(chromium.executablePath(),['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,`--disable-extensions-except=${bundle}`,`--load-extension=${bundle}`,'--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,ms=40000){const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await delay(200);}throw Error('timeout');}
let socket,serial=0;const pending=new Map();
function cdp(method,params={},sessionId){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},45000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
const targets=async()=>(await cdp('Target.getTargets')).targetInfos;
async function evaluate(targetId,expression){const t=(await targets()).find(t=>t.targetId===targetId);assert(t.url.includes('/t16-media-probe.html')||t.url.startsWith('https://www.bilibili.com/video/'));const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});try{const x=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);if(x.exceptionDetails)throw Error(x.exceptionDetails.exception?.description??x.exceptionDetails.text);return x.result.value;}finally{await cdp('Target.detachFromTarget',{sessionId});}}
let probe,site;
try{
  const endpoint=await until(async()=>{try{const [port,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);return `ws://127.0.0.1:${port}${path}`;}catch{return null;}});socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});socket.onmessage=e=>{const x=JSON.parse(e.data),p=pending.get(x.id);if(!p)return;pending.delete(x.id);clearTimeout(p.timer);x.error?p.reject(Error(JSON.stringify(x.error))):p.resolve(x.result);};result.browser=await cdp('Browser.getVersion');const id=new URL((await until(async()=>(await targets()).find(t=>t.url.endsWith('/assets/background.js')))).url).host;
  probe=(await cdp('Target.createTarget',{url:`chrome-extension://${id}/tests/installed/t16-media-probe.html`})).targetId;await until(()=>evaluate(probe,'typeof window.acquireOriginal==="function"'));
  site=(await cdp('Target.createTarget',{url:'https://www.bilibili.com/video/BV1UR4y1K7Fw/?p=2'})).targetId;await cdp('Target.activateTarget',{targetId:site});await until(()=>evaluate(site,"document.querySelector('video')?.readyState>=2"));
  const tabId=await evaluate(probe,"chrome.tabs.query({url:'https://www.bilibili.com/video/*'}).then(x=>x.find(t=>t.active)?.id)");assert(tabId);
  result.ready=await evaluate(probe,`window.acquireOriginal(${tabId})`);
  const save=async time=>{const frame=await evaluate(probe,`window.captureOriginal(${time})`);assert(Math.abs(frame.time-time)<.2);await writeFile(join(output,`frame-${time}.png`),Buffer.from(frame.dataUrl.slice(22),'base64'));result.checks.push({time:frame.time,width:frame.width,height:frame.height});};await save(1);
  const {sessionId}=await cdp('Target.attachToTarget',{targetId:site,flatten:true});try{await cdp('Page.navigate',{url:'https://www.bilibili.com/video/BV1UR4y1K7Fw/?p=3'},sessionId);}finally{await cdp('Target.detachFromTarget',{sessionId});}await until(()=>evaluate(site,"document.querySelector('video')?.readyState>=2"));
  const before=await evaluate(site,"new Promise(r=>{const v=document.querySelector('video');v.pause();v.playbackRate=1.25;v.addEventListener('seeked',()=>r({time:v.currentTime,paused:v.paused,rate:v.playbackRate}),{once:true});v.currentTime=3})");await save(5);const after=await evaluate(site,"(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,rate:v.playbackRate}})()");assert.deepEqual(after,before);result.sourceOperations={before,after};await evaluate(probe,'window.releaseOriginal()');result.pass=true;
}catch(error){result.pass=false;result.error=String(error);console.error(error);process.exitCode=1;}
finally{if(probe)try{result.remainingMedia=await evaluate(probe,"chrome.storage.session.get(null).then(x=>Object.keys(x).filter(k=>k.startsWith('vcamp.media.')||k.startsWith('vcamp.visionGrant.')))");}catch{}if(socket)result.targets=await targets().catch(()=>[]);await writeFile(join(output,'results.json'),JSON.stringify(result,null,2));socket?.close();child.kill();console.log('REAL_NORMAL_EVIDENCE',output);}
