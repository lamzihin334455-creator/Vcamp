// Installed production capture path. Root CDP never attaches to Worker/executor.
// Local TLS replaces only the external site/media; local HTTP replaces the model.
// Media gates withhold actual encoded packets, never pixels or capture results.
import { spawn } from 'node:child_process';
import { createServer as httpsServer } from 'node:https';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const output=resolve('../.tmp/t16-http-'+Date.now());await mkdir(output,{recursive:true});
const extensionPath=join(output,'package');await cp(resolve('dist-capture'),extensionPath,{recursive:true});
const manifest=JSON.parse(await readFile(join(extensionPath,'manifest.json'),'utf8'));manifest.host_permissions.push(...manifest.optional_host_permissions);delete manifest.optional_host_permissions;await writeFile(join(extensionPath,'manifest.json'),JSON.stringify(manifest));
const original=await readFile('tests/fixtures/t16-original.mp4'),other=await readFile('tests/fixtures/t16-other.mp4');
const packets=JSON.parse((await readFile('tests/fixtures/t16-packets.json','utf8')).replace(/^\uFEFF/,'' )).fragments;
const resourcesOnly=process.env.T16_READY_RESOURCES==='1';
const basicOnly=process.env.T16_BASIC_ONLY==='1';
const assistMedia=process.env.T16_ASSIST_MEDIA==='1';
const evidence={assistedMediaFocus:assistMedia,acceptanceEligible:!assistMedia,browser:null,actualModelApiCalls:0,grid:[],checks:[],attachments:[],requests:[],output};
const requests=[],events=[],documents=new Map();let serialDoc=0,armMedia=null,armPlan=null,armDocument=null;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=35000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch(e){last=e;}await delay(60);}throw Error('Condition timed out '+(last?.message??''));}
function gate(time){let release;const wait=new Promise(r=>{release=r;});return {time,wait,release,blocked:0};}
const siteServer=httpsServer({key:await readFile('../.tmp/t16-media/key.pem'),cert:await readFile('../.tmp/t16-media/cert.pem')},async(req,res)=>{
  const url=new URL(req.url,'https://'+req.headers.host);
  if(url.pathname.startsWith('/video/')){
    const bvid=url.pathname.split('/')[2],p=Number(url.searchParams.get('p')||2),cid=p===3?30:20,id=++serialDoc;
    if(armDocument){const held=armDocument;armDocument=null;held.blocked++;await held.wait;if(res.destroyed)return;}
    const entry={id,bvid,cid,gate:armMedia};armMedia=null;documents.set(id,entry);
    res.writeHead(200,{'content-type':'text/html'}).end(`<body data-fixture-doc="${id}"><video muted playsinline preload="auto"></video><script>window.__INITIAL_STATE__={videoData:{bvid:${JSON.stringify(bvid)},title:'T16 controlled '+${JSON.stringify(bvid)},pages:[{page:2,cid:20,part:'P2'},{page:3,cid:30,part:'P3'}]}};window.player={getVideoMessage:()=>({bvid:${JSON.stringify(bvid)},cid:${cid}})};const v=document.querySelector('video');for(const type of ['seeking','seeked','pause','play'])v.addEventListener(type,()=>fetch('/event',{method:'POST',body:JSON.stringify({doc:${id},type,time:v.currentTime})}));const ms=new MediaSource();v.src=URL.createObjectURL(ms);ms.addEventListener('sourceopen',async()=>{try{const sb=ms.addSourceBuffer('video/mp4; codecs=\"avc1.42c00b\"');const reader=(await fetch('/media.mp4?doc=${id}')).body.getReader();while(true){const {done,value}=await reader.read();if(done)break;await new Promise((ok,bad)=>{sb.addEventListener('updateend',ok,{once:true});sb.addEventListener('error',bad,{once:true});sb.appendBuffer(value)});ms.duration=8;}ms.endOfStream();}catch(e){document.body.dataset.mediaError=String(e);}});fetch('https://api.bilibili.com/x/player/wbi/v2?cid=${cid}');</script>`);return;
  }
  if(url.pathname==='/media.mp4'){
    const entry=documents.get(Number(url.searchParams.get('doc')));const bytes=entry.bvid==='BVother'||entry.cid===30?other:original;
    const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''),start=range?Number(range[1]):0,end=range?.[2]?Number(range[2]):bytes.length-1;
    res.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});

    const cutoff=entry.gate?packets[Math.round(entry.gate.time)]:bytes.length;
    const split=Math.max(start,Math.min(end+1,cutoff));if(split>start)res.write(bytes.subarray(start,split));
    if(split<=end&&entry.gate){entry.gate.blocked++;await entry.gate.wait;}if(!res.destroyed)res.end(bytes.subarray(split,end+1));return;
  }
  if(url.pathname==='/event'){let text='';for await(const chunk of req)text+=chunk;events.push({...JSON.parse(text),at:Date.now()});res.writeHead(204).end();return;}
  if(req.headers.host==='api.bilibili.com'){res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'}).end(JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/fixture.json'}]}}}));return;}
  if(req.headers.host==='aisubtitle.hdslb.com'){res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'}).end(JSON.stringify({body:[{from:0,to:4,content:'前段完整字幕，红色到绿色画面'},{from:4,to:8,content:'后段完整字幕，蓝色到黄色画面'}]}));return;}
  res.writeHead(404).end();
});
const sse=(text,reason='stop')=>'data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:reason}]})+'\n\n';
const modelServer=createServer(async(req,res)=>{
  if(req.url!=='/chat/completions'){res.writeHead(404).end();return;}let text='';for await(const c of req)text+=c;const body=JSON.parse(text),plan=body.messages[0].content.startsWith('自主画面规划');
  const entry={body,plan,at:Date.now()};requests.push(entry);res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();
  if(plan&&armPlan){const hold=armPlan;armPlan=null;hold.blocked++;await hold.wait;}
  if(res.destroyed)return;
  const input=typeof body.messages.at(-1).content==='string'?body.messages.at(-1).content:body.messages.at(-1).content[0].text;
  res.write(sse(plan?JSON.stringify({times:input.includes('无需画面')?[]:[1,3],reason:'根据完整字幕检查原视频两个画面'}):'受控回答已完成'));res.end('data: [DONE]\n\n');
});
await Promise.all([new Promise(r=>siteServer.listen(443,'127.0.0.1',r)),new Promise(r=>modelServer.listen(43105,'127.0.0.1',r))]);
const profile=join(output,'profile');
const args=['--remote-debugging-pipe','--enable-unsafe-extension-debugging',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--no-proxy-server','--ignore-certificate-errors','--host-resolver-rules=MAP www.bilibili.com 127.0.0.1,MAP api.bilibili.com 127.0.0.1,MAP aisubtitle.hdslb.com 127.0.0.1','about:blank'];
evidence.args=args; evidence.activationSource='production sidepanel consent -> production media broker';
const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',args,{windowsHide:false,stdio:['ignore','ignore','ignore','pipe','pipe']});
let socket,seq=0,extension,buffer=Buffer.alloc(0);const pending=new Map();
child.stdio[4].on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);let index;while((index=buffer.indexOf(0))>=0){const text=buffer.subarray(0,index).toString();buffer=buffer.subarray(index+1);if(!text)continue;const x=JSON.parse(text),p=pending.get(x.id);if(!p)continue;pending.delete(x.id);clearTimeout(p.timer);x.error?p.reject(Error(JSON.stringify(x.error))):p.resolve(x.result);}});
function cdp(method,params={},sessionId,timeout=20000){const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},timeout);pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});}
const targets=async()=>(await cdp('Target.getTargets')).targetInfos;
async function evaluate(id,expression){const target=(await targets()).find(t=>t.targetId===id);assert(target?.url.includes('/sidepanel.html')||id===site);const {sessionId}=await cdp('Target.attachToTarget',{targetId:id,flatten:true});evidence.attachments.push({url:target.url,type:target.type});try{const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}finally{await cdp('Target.detachFromTarget',{sessionId});}}
async function panel(){
  const {targetId}=await cdp('Target.createTarget',{url:`chrome-extension://${extension}/sidepanel.html`});
  await until(()=>evaluate(targetId,'!!document.querySelector("textarea")'));
  if(site) await cdp('Target.activateTarget',{targetId:site});
  const windowId=await evaluate(targetId,'chrome.windows.getCurrent().then(w=>w.id)');
  await evaluate(targetId,`chrome.sidePanel.open({windowId:${windowId}})`);
  const real=await until(async()=>(await targets()).find(t=>t.targetId!==targetId&&t.url===`chrome-extension://${extension}/sidepanel.html`));
  await cdp('Target.closeTarget',{targetId});
  await until(()=>evaluate(real.targetId,'!!document.querySelector("textarea")'));
  return real.targetId;
}
const op=(page,operation)=>evaluate(page,`chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:${JSON.stringify(operation)}}).then(r=>{if(!r.ok)throw Error(r.code);return r.view})`);
async function navigate(id,url){const {sessionId}=await cdp('Target.attachToTarget',{targetId:id,flatten:true});try{await cdp('Page.navigate',{url},sessionId);}finally{await cdp('Target.detachFromTarget',{sessionId});}await delay(100);}
async function source(page,site,bvid='BVfixture',part=2){
  const previous=await evaluate(site,'document.body?.dataset.fixtureDoc');
  await navigate(site,`https://www.bilibili.com/video/${bvid}/?p=${part}`);await cdp('Target.activateTarget',{targetId:site});
  await until(()=>evaluate(site,`!!document.body?.dataset.fixtureDoc&&document.body.dataset.fixtureDoc!==${JSON.stringify(previous??'')}`));
  return until(async()=>{const v=await op(page,{type:'workspace.query'});return v.video?.status==='ready'&&v.video.binding.videoId===bvid&&v.video.binding.partId===String(part===3?30:20)&&v;});
}
const target=v=>({kind:'chat',workspaceId:v.workspaceId,chatId:v.chatId});
async function click(page,text) {
  const point=await evaluate(page,`(()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)});if(!el||el.disabled)throw Error('button unavailable: '+${JSON.stringify(text)});el.scrollIntoView();const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const {sessionId}=await cdp('Target.attachToTarget',{targetId:page,flatten:true});try{await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point},sessionId);await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point},sessionId);}finally{await cdp('Target.detachFromTarget',{sessionId});}
}
async function send(page,view,text,preauthorize=false){
  let v=await op(page,{type:'workspace.query',target:{workspaceId:view.workspaceId,chatId:view.chatId}});
  v=await op(page,{type:'draft.save',target:{workspaceId:v.workspaceId,chatId:v.chatId},expectedRevision:v.draft.revision,draft:{...v.draft,text,modelId:'synthetic-vision'}});
  if(preauthorize){
    await op(page,{type:'chat.select',workspaceId:v.workspaceId,chatId:v.chatId});await evaluate(page,'location.reload()');
    await until(()=>evaluate(page,'!!document.querySelector("#chat-select")'));
    await evaluate(page,`(()=>{const el=document.querySelector('#chat-select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(v.chatId)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(()=>evaluate(page,`document.querySelector('#chat-select')?.value===${JSON.stringify(v.chatId)}&&document.querySelector('textarea')?.value===${JSON.stringify(text)}`));
    await until(()=>evaluate(page,'document.querySelector("button[aria-label=发送]")&&!document.querySelector("button[aria-label=发送]").disabled'));
    await click(page,'发送');await until(()=>evaluate(page,'!!document.querySelector("dialog[open]")'));
    assert((await evaluate(page,'document.querySelector("dialog").textContent')).includes('显示当前视频'));
    await click(page,typeof preauthorize==='string'?preauthorize:'授权本请求取帧并发送');
  } else await op(page,{type:'generation.send',target:target(v),expectedRevision:v.draft.revision,binding:view.video.binding});
  return until(async()=>{const g=(await op(page,{type:'generation.query',target:target(v)})).generation;return g.jobs.find(j=>j.jobId===g.messages.find(m=>m.text===text&&m.role==='user')?.jobId);});
}
const job=(page,view,id)=>op(page,{type:'generation.query',target:target(view)}).then(v=>v.generation.jobs.find(j=>j.jobId===id));
async function complete(page,view,id){return until(async()=>{const j=await job(page,view,id);if(['failed','interrupted'].includes(j.state))throw Error('Job '+JSON.stringify(j));return j.state==='completed'&&j;});}
async function cleanup(){await until(async()=>!(await targets()).some(t=>t.url.includes('/executor.html#')));assert.deepEqual(await evaluate(page,"chrome.storage.session.get(null).then(x=>Object.keys(x).filter(k=>k.startsWith('vcamp.media.')||k.startsWith('vcamp.mediaPending.')||k.startsWith('vcamp.visionGrant.')))"),[]);}
async function stopWorker(){const worker=await until(async()=>(await targets()).find(t=>t.type==='service_worker'&&t.url.includes(extension)));assert.equal(worker.attached,false);await cdp('Target.closeTarget',{targetId:worker.targetId});await until(async()=>!(await targets()).some(t=>t.targetId===worker.targetId));}
async function assistHost(){
  const t=await until(async()=>(await targets()).find(t=>t.type==='page'&&t.targetId!==site&&t.url.startsWith('https://www.bilibili.com/video/')));
  const {sessionId}=await cdp('Target.attachToTarget',{targetId:t.targetId,flatten:true});evidence.attachments.push({url:t.url,type:'page',diagnosticFocusOverride:true});
  try{await cdp('Emulation.setFocusEmulationEnabled',{enabled:true},sessionId);await until(async()=>{const r=await cdp('Runtime.evaluate',{expression:'document.querySelector("video")?.readyState>=2',returnByValue:true},sessionId);return r.result.value});await delay(300);}
  finally{ /* Deliberately keep diagnostic media focus until the owned host closes. */ }
}
let page,site;
testing: try{
  evidence.browser=await cdp('Browser.getVersion');extension=(await cdp('Extensions.loadUnpacked',{path:extensionPath})).id;
  page=await panel();await evaluate(page,`chrome.storage.local.set({'vcamp.provider.v1':{providerId:'deepseek',revision:1,key:'T16_SYNTHETIC_KEY',models:[{id:'synthetic-vision',name:'Synthetic vision',text:'declared',vision:'declared',web:'unknown'}],defaultModelId:null,status:'ready'}})`);await stopWorker();await evaluate(page,'location.reload()');
  site=(await cdp('Target.createTarget',{url:'https://www.bilibili.com/video/BVfixture/?p=2'})).targetId;
  let v=await source(page,site);assert.equal(await evaluate(page,"chrome.storage.local.get('vcamp.autoVision').then(x=>x['vcamp.autoVision']===true)"),false);
  const offDocuments=documents.size;const off=await send(page,v,'默认关闭文字');await complete(page,v,off.jobId);assert.equal(requests.length,1);assert.equal(documents.size,offDocuments);await cleanup();evidence.checks.push('default-off-no-planner-no-media-host');
  if(process.env.T16_UI_ONLY!=='1'){
  if(resourcesOnly){
    assert.equal(assistMedia,false);
    for(const navigateHost of [false,true]){
      v=await source(page,site);v=await op(page,{type:'chat.create',workspaceId:v.workspaceId});
      await evaluate(page,"chrome.storage.local.set({'vcamp.autoVision':true})");
      const beforeTabs=await evaluate(page,'chrome.tabs.query({}).then(t=>t.map(x=>x.id))');const held=gate(0);armDocument=held;const j=await send(page,v,'pre-stamp-owner-destroyed',true);await until(()=>held.blocked);
      const tabs=await evaluate(page,"chrome.tabs.query({})"),host=tabs.find(t=>!beforeTabs.includes(t.id)&&!t.url.includes('/executor.html#'));
      assert(host);assert.equal(await evaluate(page,"chrome.storage.session.get(null).then(x=>Object.keys(x).filter(k=>k.startsWith('vcamp.media.')).length)"),0);
      if(navigateHost){await evaluate(page,`chrome.tabs.update(${host.id},{url:'about:blank'})`);await until(()=>evaluate(page,`chrome.tabs.get(${host.id}).then(t=>t.url==='about:blank'&&!t.pendingUrl)`));}
      await stopWorker();const executor=(await targets()).find(t=>t.url.includes('/executor.html#'+j.jobId+'/'));assert(executor&&!executor.attached);await cdp('Target.closeTarget',{targetId:executor.targetId});
      await until(async()=>(await job(page,v,j.jobId)).state==='interrupted');
      if(navigateHost){assert.equal(await evaluate(page,`chrome.tabs.get(${host.id}).then(t=>t.url)`),'about:blank');await evaluate(page,`chrome.tabs.remove(${host.id})`);}
      else await until(()=>evaluate(page,`chrome.tabs.get(${host.id}).then(()=>false,()=>true)`),5000);
      held.release();await cleanup();evidence.checks.push(navigateHost?'pre-stamp-owner-death-preserves-navigated-tab':'pre-stamp-owner-death-closes-owned-tab');
    }
    for(const choice of ['subtitle','stop']){
      v=await source(page,site);v=await op(page,{type:'chat.create',workspaceId:v.workspaceId});
      await until(()=>evaluate(site,"document.querySelector('video')?.readyState>=2"));
      for(let i=0;i<5;i++){await op(page,{type:'attachment.capture',target:{workspaceId:v.workspaceId,chatId:v.chatId},binding:v.video.binding,expectedRevision:v.draft.revision,consent:'capture-and-send'});v=await op(page,{type:'workspace.query',target:{workspaceId:v.workspaceId,chatId:v.chatId}});}
      await evaluate(page,"chrome.storage.local.set({'vcamp.autoVision':true})");assert.equal(v.draft.attachmentIds.length,5);const count=documents.size,j=await send(page,v,'resource-over-budget-'+choice);
      const waiting=await until(async()=>{const current=await job(page,v,j.jobId);return current.state==='awaiting-permission'&&current;});assert.equal(waiting.visual.issue,'resource');assert.equal(waiting.visual.attachmentIds.length,0);assert.equal(documents.size,count);
      if(choice==='stop')await op(page,{type:'generation.stop',jobId:j.jobId});else{await op(page,{type:'generation.vision.decide',jobId:j.jobId,choice:'subtitle'});const done=await complete(page,v,j.jobId);assert.equal(done.visual.resolution,'subtitle');assert.equal(done.visual.frozen,true);}
      await cleanup();evidence.checks.push('resource-explicit-'+choice);
    }
    evidence.pass=true;break testing;
  }
  for(const phase of (basicOnly?[]:['pre-plan','pre-first','partial']))for(const change of ['video','part']){
    v=await source(page,site);v=await op(page,{type:'chat.create',workspaceId:v.workspaceId});
    await evaluate(page,"chrome.storage.local.set({'vcamp.autoVision':true})");
    const hold=gate(phase==='partial'?3:1);if(phase==='pre-plan')armPlan=hold;else armMedia=hold;
    const label=`${phase}-${change}`,j=await send(page,v,label,true);
    if(phase==='pre-plan')await until(()=>hold.blocked);
    else await until(async()=>{const value=await job(page,v,j.jobId);return hold.blocked&&value.visual?.phase==='capturing'&&value.visual.attachmentIds.length===(phase==='partial'?1:0);});
    const before=await job(page,v,j.jobId);assert(before.visual);assert.equal(before.visual.attachmentIds.length,phase==='partial'?1:0);
    const active=(await targets()).filter(t=>t.type==='service_worker'||t.url.includes('/executor.html#'));assert(active.every(t=>!t.attached));
    const changed=await source(page,site,change==='video'?'BVother':'BVfixture',change==='part'?3:2);
    const operation=await evaluate(site,"new Promise(r=>{const v=document.querySelector('video');v.pause();v.playbackRate=1.25;v.addEventListener('seeked',()=>r({time:v.currentTime,paused:v.paused,rate:v.playbackRate}),{once:true});v.currentTime=4})");
    await evaluate(page,"chrome.storage.local.set({'vcamp.autoVision':false})");
    const second=await send(page,changed,'新空间立即发送 '+label);const secondDone=await complete(page,changed,second.jobId);
    if(label==='partial-part'){await cdp('Target.closeTarget',{targetId:page});await stopWorker();page=await panel();}
    hold.release();const done=await complete(page,v,j.jobId);assert.equal(done.visual.attachmentIds.length,2);assert.equal(done.visual.frozen,true);
    const images=(await op(page,{type:'attachment.read',target:{workspaceId:v.workspaceId,chatId:v.chatId},ids:done.visual.attachmentIds,historyOnly:true})).attachment.images;
    assert(images.every(i=>i.source.videoId==='BVfixture'&&i.source.partId==='20'));assert(images.every((i,n)=>Math.abs(i.time-[1,3][n])<0.2));
    const pixels=await evaluate(page,`Promise.all(${JSON.stringify(images.map(i=>i.dataUrl))}.map(async url=>{const img=new Image();img.src=url;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);return [...x.getImageData(0,0,1,1).data]}))`);assert(pixels.every((pixel,i)=>pixel.slice(0,3).every((c,k)=>Math.abs(c-[[253,0,0],[0,127,0]][i][k])<=32)));
    const req=requests.find(r=>!r.plan&&Array.isArray(r.body.messages.at(-1).content)&&r.body.messages.at(-1).content[0].text===label);assert(req);assert.deepEqual(req.body.messages.at(-1).content.filter(p=>p.type==='image_url').map(p=>p.image_url.url),images.map(i=>i.dataUrl));
    const after=await evaluate(site,"(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,rate:v.playbackRate}})()");assert.deepEqual(after,operation);await cleanup();
    evidence.grid.push({phase,change,state:done.state,source:images[0].source,times:images.map(i=>i.time),sha256:images.map(i=>i.sha256),pixels,newSpace:secondDone.state,sourceOperationPreserved:true,workerRestart:label==='partial-part'});console.log('GRID',label,'PASS');
  }
  if(process.env.T16_CLEANUP_ONLY!=='1'){
  v=await source(page,site);v=await op(page,{type:'chat.create',workspaceId:v.workspaceId});await evaluate(page,"chrome.storage.local.set({'vcamp.autoVision':true})");
  const plainDocs=documents.size,plainCount=requests.length,plain=await send(page,v,'明确仅文本','继续纯文本');await complete(page,v,plain.jobId);
  assert.equal(documents.size,plainDocs);assert.equal(requests.length,plainCount+1);await cleanup();evidence.checks.push('production-consent-pure-text-no-host-no-plan');
  // No-image and explicit refusal: no preauthorization means no media navigation.
  for(const mode of ['无需画面','拒绝授权']){
    v=await source(page,site);v=await op(page,{type:'chat.create',workspaceId:v.workspaceId});await evaluate(page,"chrome.storage.local.set({'vcamp.autoVision':true})");const count=documents.size,j=await send(page,v,mode);
    if(mode==='拒绝授权'){await until(async()=>(await job(page,v,j.jobId)).state==='awaiting-permission');assert.equal(documents.size,count);await op(page,{type:'generation.vision.decide',jobId:j.jobId,choice:'subtitle'});}
    const done=await complete(page,v,j.jobId);assert.equal(done.visual.attachmentIds.length,0);assert.equal(documents.size,count);await cleanup();evidence.checks.push(mode);
  }
  // User leaves during initialization: the late ready callback must not select home.
  v=await source(page,site);v=await op(page,{type:'chat.create',workspaceId:v.workspaceId});await evaluate(page,"chrome.storage.local.set({'vcamp.autoVision':true})");
  const visibleHold=gate(0);armDocument=visibleHold;const switched=await send(page,v,'initialization-user-switch',true);await until(()=>visibleHold.blocked);
  const userTab=await evaluate(page,"chrome.tabs.create({url:'about:blank',active:true})");
  visibleHold.release();const switchOutcome=await until(async()=>{const j=await job(page,v,switched.jobId);return ['completed','awaiting-permission'].includes(j.state)&&j;},40000);if(switchOutcome.state==='awaiting-permission'){assert.equal(switchOutcome.visual.issue,'media');await op(page,{type:'generation.stop',jobId:switched.jobId});}assert.equal(await evaluate(page,`chrome.tabs.get(${userTab.id}).then(t=>t.active)`),true);await cleanup();await evaluate(page,`chrome.tabs.remove(${userTab.id})`);evidence.checks.push('late-ready-does-not-return-after-user-switch');
  }
  // Capture failure, stop, delete, and a navigated disposable tab must not be closed.
  for(const mode of ['fault-choice','stop','delete','navigated-host','user-takeover']){
    v=await source(page,site);v=await op(page,{type:'chat.create',workspaceId:v.workspaceId});await evaluate(page,"chrome.storage.local.set({'vcamp.autoVision':true})");const hold=gate(1);armMedia=hold;const j=await send(page,v,mode,true);await until(async()=>hold.blocked&&(await job(page,v,j.jobId)).visual?.phase==='capturing');
    const host=await evaluate(page,"chrome.storage.session.get(null).then(x=>Object.entries(x).find(([k])=>k.startsWith('vcamp.media.'))?.[1])");assert(host);
    if(mode==='user-takeover'){await evaluate(page,`chrome.tabs.update(${host.tabId},{active:true})`);await until(async()=>(await job(page,v,j.jobId)).state==='awaiting-permission');await op(page,{type:'generation.stop',jobId:j.jobId});assert.equal(await evaluate(page,`chrome.tabs.get(${host.tabId}).then(t=>t.active)`),true);await evaluate(page,`chrome.tabs.remove(${host.tabId})`);}
    else if(mode==='stop')await op(page,{type:'generation.stop',jobId:j.jobId});
    else if(mode==='delete'){const t={workspaceId:v.workspaceId,entityType:'chat',id:v.chatId};const p=(await op(page,{type:'library.trash.preview',target:t})).library.deletePreview;await op(page,{type:'library.trash.move',target:t,expectedRevision:p.revision});}
    else {await evaluate(page,`chrome.tabs.${mode==='navigated-host'?'update('+host.tabId+',{url:"about:blank"})':'remove('+host.tabId+')'}`);await until(async()=>(await job(page,v,j.jobId)).state==='awaiting-permission');await op(page,{type:'generation.vision.decide',jobId:j.jobId,choice:'subtitle'});await complete(page,v,j.jobId);if(mode==='navigated-host'){assert.equal(await evaluate(page,`chrome.tabs.get(${host.tabId}).then(x=>x.url)`),'about:blank');await evaluate(page,`chrome.tabs.remove(${host.tabId})`);}}
    hold.release();await cleanup();evidence.checks.push(mode);
  }
  }
  // Narrow composer and request-consent layout from the actual React UI.
  v=await source(page,site);await evaluate(page,"chrome.storage.local.set({'vcamp.autoVision':true})");await evaluate(page,'location.reload()');
  await until(()=>evaluate(page,'!!document.querySelector("#chat-select")'));
  await click(page,'新对话');await until(()=>evaluate(page,'!document.querySelector("#chat-select").disabled'));
  await evaluate(page,`(()=>{const el=document.querySelector('select[aria-label="当前模型"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'synthetic-vision');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const {sessionId}=await cdp('Target.attachToTarget',{targetId:page,flatten:true});try{await cdp('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:false},sessionId);await cdp('Runtime.evaluate',{expression:`(()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'界面授权检查');el.dispatchEvent(new Event('input',{bubbles:true}));})()`},sessionId);}finally{await cdp('Target.detachFromTarget',{sessionId});}
  await until(()=>evaluate(page,'!document.querySelector("button[aria-label=发送]").disabled'));await evaluate(page,'document.querySelector("button[aria-label=发送]").click()');await until(()=>evaluate(page,'!!document.querySelector("dialog[open]")'));
  const screenshotSession=(await cdp('Target.attachToTarget',{targetId:page,flatten:true})).sessionId;try{const shot=await cdp('Page.captureScreenshot',{},screenshotSession);await writeFile(join(output,'consent-360.png'),Buffer.from(shot.data,'base64'));const width=await cdp('Runtime.evaluate',{expression:'({viewport:innerWidth,document:document.documentElement.scrollWidth,dialog:document.querySelector("dialog").getBoundingClientRect().width})',returnByValue:true},screenshotSession);assert(width.result.value.document<=360);evidence.checks.push({layout:width.result.value});}finally{await cdp('Target.detachFromTarget',{sessionId:screenshotSession});}
  const cancelRequests=requests.length,cancelDocs=documents.size;await click(page,'停止并保留草稿');await until(()=>evaluate(page,'!document.querySelector("dialog[open]")'));assert.equal(requests.length,cancelRequests);assert.equal(documents.size,cancelDocs);evidence.checks.push('production-consent-cancel-preserves-draft-no-request');
  evidence.pass=true;
}catch(error){evidence.error=String(error);console.error(error);try{evidence.failureUI=await evaluate(page,'document.body.innerText');evidence.failureState=await evaluate(page,`new Promise(r=>{const q=indexedDB.open('vcamp');q.onsuccess=()=>{const t=q.result.transaction('jobs');const x=t.objectStore('jobs').getAll();x.onsuccess=()=>r(x.result)}})`);evidence.failureTabs=await targets();evidence.failureMedia=await evaluate(page,`chrome.storage.session.get(null)`);evidence.hostRegistry=await evaluate(page,"chrome.storage.session.get(null).then(x=>Object.fromEntries(Object.entries(x).filter(([k])=>k.startsWith('vcamp.media'))))");evidence.documents=[...documents.values()].map(d=>({...d,gate:d.gate&&{time:d.gate.time,blocked:d.gate.blocked}}));console.error(JSON.stringify(evidence.failureState.map(j=>({seq:j.seq,attempt:j.attempts.at(-1)}))));}catch{}process.exitCode=1;}
finally{evidence.requests=requests.map(r=>({plan:r.plan,at:r.at,messages:r.body.messages.map(m=>({role:m.role,content:typeof m.content==='string'?m.content:m.content.map(p=>p.type==='text'?p:{type:'image_url',bytes:p.image_url.url.length})}))}));evidence.events=events;await writeFile(join(output,'results.json'),JSON.stringify(evidence,null,2));await cdp('Browser.close').catch(()=>{});child.kill();siteServer.closeAllConnections();modelServer.closeAllConnections();siteServer.close();modelServer.close();console.log('EVIDENCE',output);}
