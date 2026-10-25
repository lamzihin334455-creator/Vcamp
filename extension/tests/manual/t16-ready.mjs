// Raw browser pipe: no Playwright connection, media-target attach, focus emulation,
// background throttling switches or autoplay overrides. Disposable profile only.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const executable=process.env.T16_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe';
const headless=process.env.T16_HEADLESS==='1';
const nativeDiagnostic=process.env.T16_NATIVE_DIAGNOSTIC==='1';
const nativeData=nativeDiagnostic?'data:video/mp4;base64,'+(await readFile('tests/fixtures/t16-original.mp4')).toString('base64'):null;
const output=resolve('../.tmp/t16-frame-'+Date.now());await mkdir(output,{recursive:true});
const bundle=join(output,'package');await cp(resolve('dist-capture'),bundle,{recursive:true});
const manifest=JSON.parse(await readFile(join(bundle,'manifest.json'),'utf8'));manifest.host_permissions.push(...manifest.optional_host_permissions);delete manifest.optional_host_permissions;await writeFile(join(bundle,'manifest.json'),JSON.stringify(manifest));
const args=[...(headless?['--headless=new']:[]),'--remote-debugging-pipe','--enable-unsafe-extension-debugging',`--user-data-dir=${join(output,'profile')}`,'--no-first-run','--no-default-browser-check','about:blank'];
const evidence={executable,args,headless,nativeDiagnostic,focusEmulation:false,actualModelApiCalls:0,attachments:[],samples:[],frames:[],output};
const child=spawn(executable,args,{windowsHide:false,stdio:['ignore','ignore','ignore','pipe','pipe']});
let seq=0,buffer=Buffer.alloc(0);const pending=new Map();
child.stdio[4].on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);let index;while((index=buffer.indexOf(0))>=0){const text=buffer.subarray(0,index).toString();buffer=buffer.subarray(index+1);if(!text)continue;const x=JSON.parse(text),p=pending.get(x.id);if(!p)continue;pending.delete(x.id);clearTimeout(p.timer);x.error?p.reject(Error(JSON.stringify(x.error))):p.resolve(x.result);}});
function cdp(method,params={},sessionId){const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},45000);pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=40000){const end=Date.now()+timeout;let error;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){error=e;}await delay(200);}throw Error('timeout: '+(error??''));}
const targets=async()=>(await cdp('Target.getTargets')).targetInfos;
let probe,site;
async function evaluate(id,expression){assert(id===probe||id===site);const t=(await targets()).find(t=>t.targetId===id);const {sessionId}=await cdp('Target.attachToTarget',{targetId:id,flatten:true});evidence.attachments.push({url:t.url,type:t.type});try{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}finally{await cdp('Target.detachFromTarget',{sessionId});}}
const observe=`(async()=>{const tabs=await chrome.tabs.query({url:'https://www.bilibili.com/video/*'});return Promise.all(tabs.map(async t=>{let state;try{[state]=await chrome.scripting.executeScript({target:{tabId:t.id},func:()=>{const v=document.querySelector('video');return {visibility:document.visibilityState,focus:document.hasFocus(),readyState:v?.readyState,networkState:v?.networkState,currentTime:v?.currentTime,duration:Number.isFinite(v?.duration)?v.duration:null,paused:v?.paused,muted:v?.muted,videoWidth:v?.videoWidth,videoHeight:v?.videoHeight,decoded:v?.getVideoPlaybackQuality().totalVideoFrames,hasSource:!!v?.currentSrc,nativeDiagnostic:window.t16Native&&{ready:window.t16Native.readyState,network:window.t16Native.networkState,decoded:window.t16Native.getVideoPlaybackQuality().totalVideoFrames,error:window.t16Native.error?.code,events:window.t16NativeEvents}};}})}catch(e){state={error:String(e)}}return {tabId:t.id,url:t.url,active:t.active,muted:t.mutedInfo?.muted,status:t.status,window:await chrome.windows.get(t.windowId),state};}));})()`;
try{
  evidence.browser=await cdp('Browser.getVersion');
  const {id}=await cdp('Extensions.loadUnpacked',{path:bundle});evidence.extension=id;
  probe=(await cdp('Target.createTarget',{url:`chrome-extension://${id}/tests/installed/t16-media-probe.html`})).targetId;
  await until(()=>evaluate(probe,'typeof window.acquireOriginal==="function"'));
  if(process.env.T16_FRAME_SAMPLE==='1') {
    evidence.diagnosticOnly=true;
    await cdp('Target.activateTarget',{targetId:probe});
    const sample='data:video/mp4;base64,'+(await readFile('tests/fixtures/t16-original.mp4')).toString('base64');
    await evaluate(probe,`window.prepareLocalMedia(${JSON.stringify(sample)})`);
    for(const [visibility,times] of [['visible',[1,3,5,7]],['hidden',[1,3,5,7,3,3]]]) {
      if(visibility==='hidden') { site=(await cdp('Target.createTarget',{url:'about:blank'})).targetId; await cdp('Target.activateTarget',{targetId:site}); }
      for(const time of times) {
        const result=await evaluate(probe,`window.captureLocal(${time})`);
        evidence.frames.push({visibility,time,ok:result.ok,pixel:result.pixel,trace:result.trace,error:result.error});
        assert(result.ok,JSON.stringify(result));
        const expected=time<2?[253,0,0]:time<4?[0,127,0]:time<6?[0,0,254]:[255,255,0];
        assert(result.pixel.slice(0,3).every((c,i)=>Math.abs(c-expected[i])<=32),JSON.stringify({time,expected,pixel:result.pixel}));
        await writeFile(join(output,`sample-${visibility}-${time}.png`),Buffer.from(result.frame.dataUrl.slice(22),'base64'));
      }
    }
    evidence.pass=true;
  } else {
  site=(await cdp('Target.createTarget',{url:'https://www.bilibili.com/video/BV1UR4y1K7Fw/?p=2'})).targetId;
  await cdp('Target.activateTarget',{targetId:site});
  await until(()=>evaluate(site,"document.querySelector('video')?.readyState>=2"));
  const tabId=await evaluate(probe,"chrome.tabs.query({url:'https://www.bilibili.com/video/*'}).then(x=>x.find(t=>t.active)?.id)");assert(tabId);
  evidence.samples.push({phase:'source-ready',tabs:await evaluate(probe,observe)});
  await cdp('Target.activateTarget',{targetId:probe}); // User opens consent, never the media copy.
  await evaluate(probe,`window.prepareConsent(${tabId});true`);
  const rect=await evaluate(probe,"(()=>{const r=document.querySelector('#confirm').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  const clickSession=(await cdp('Target.attachToTarget',{targetId:probe,flatten:true})).sessionId;
  try { await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect},clickSession); await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect},clickSession); } finally { await cdp('Target.detachFromTarget',{sessionId:clickSession}); }
  evidence.activationSource='trusted consent button -> production media.create broker; no media target CDP';
  if(nativeDiagnostic){await delay(3000);await evaluate(probe,"chrome.tabs.query({url:'https://www.bilibili.com/video/*'}).then(tabs=>chrome.scripting.executeScript({target:{tabId:tabs.find(t=>!t.active).id},func:(url)=>{const v=document.createElement('video');window.t16Native=v;window.t16NativeEvents=[];for(const e of ['loadedmetadata','loadeddata','error','play','playing'])v.addEventListener(e,()=>window.t16NativeEvents.push(e));v.muted=true;v.preload='auto';v.src=url;document.body.append(v);v.load();void v.play().catch(e=>window.t16NativeEvents.push(e.name));},args:["+JSON.stringify(nativeData)+"]}))" );}
  const start=Date.now();let outcome;
  do{await delay(1500);evidence.samples.push({elapsed:Date.now()-start,tabs:await evaluate(probe,observe)});outcome=await evaluate(probe,'window.readyOutcome');}while(!outcome&&Date.now()-start<45000);
  evidence.ready=outcome;assert(outcome?.ok,JSON.stringify(outcome));assert.equal(outcome.value.initialization?.returned,true,'product returned to original work page');
  const save=async time=>{const frame=await evaluate(probe,`window.captureOriginal(${time})`);assert(Math.abs(frame.time-time)<.2);const bytes=Buffer.from(frame.dataUrl.slice(22),'base64');await writeFile(join(output,`frame-${time}.png`),bytes);evidence.frames.push({time:frame.time,width:frame.width,height:frame.height,sha256:createHash('sha256').update(bytes).digest('hex')});};
  await save(1);
  await cdp('Target.activateTarget',{targetId:site}); // A new user source-page operation after background frame success.
  const {sessionId}=await cdp('Target.attachToTarget',{targetId:site,flatten:true});try{await cdp('Page.navigate',{url:'https://www.bilibili.com/video/BV1UR4y1K7Fw/?p=3'},sessionId);}finally{await cdp('Target.detachFromTarget',{sessionId});}
  await until(()=>evaluate(site,"document.querySelector('video')?.readyState>=2"));
  const before=await evaluate(site,"new Promise(r=>{const v=document.querySelector('video');v.pause();v.playbackRate=1.25;v.addEventListener('seeked',()=>r({time:v.currentTime,paused:v.paused,rate:v.playbackRate}),{once:true});v.currentTime=3})");
  await save(5);const after=await evaluate(site,"(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,rate:v.playbackRate}})()");assert.deepEqual(after,before);evidence.sourceOperations={before,after};
  evidence.samples.push({phase:'captured-after-switch',tabs:await evaluate(probe,observe)});await evaluate(probe,'window.releaseOriginal()');evidence.pass=true;
  }
}catch(error){evidence.pass=false;evidence.error=String(error);console.error(error);process.exitCode=1;}
finally{if(probe)try{evidence.captureDiagnostics=await evaluate(probe,'window.captureDiagnostics()');await evaluate(probe,'window.releaseOriginal()');evidence.remaining=await evaluate(probe,"chrome.storage.session.get(null).then(x=>Object.keys(x).filter(k=>k.startsWith('vcamp.media.')||k.startsWith('vcamp.mediaPending.')||k.startsWith('vcamp.visionGrant.')))");}catch{}evidence.targets=await targets().catch(()=>[]);await writeFile(join(output,'results.json'),JSON.stringify(evidence,null,2));await cdp('Browser.close').catch(()=>{});child.kill();console.log('READY_EVIDENCE',output);}
