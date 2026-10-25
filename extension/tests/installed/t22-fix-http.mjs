// Installed production capture path. Root CDP never attaches to Worker/executor.
// Local TLS replaces only the external site/media; local HTTP replaces the model.
// The planning gate starts only after the production media host is initialized.
import { spawn } from 'node:child_process';
import { createServer as httpsServer } from 'node:https';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const output=resolve('../.tmp/t22-fix-http-'+Date.now());await mkdir(output,{recursive:true});
const extensionPath=join(output,'package');await cp(resolve('dist-capture'),extensionPath,{recursive:true});
const manifest=JSON.parse(await readFile(join(extensionPath,'manifest.json'),'utf8'));manifest.host_permissions.push(...manifest.optional_host_permissions);delete manifest.optional_host_permissions;await writeFile(join(extensionPath,'manifest.json'),JSON.stringify(manifest));
const original=await readFile('tests/fixtures/t16-original.mp4'),other=await readFile('tests/fixtures/t16-other.mp4');
const evidence={browser:null,actualModelApiCalls:0,checks:[],attachments:[],requests:[],output};
const requests=[],documents=new Map();let serialDoc=0,armPlan=null;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=35000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch(e){last=e;}await delay(60);}throw Error('Condition timed out '+(last?.message??''));}
function gate(time){let release;const wait=new Promise(r=>{release=r;});return {time,wait,release,blocked:0};}
const siteServer=httpsServer({key:await readFile('../.tmp/t16-media/key.pem'),cert:await readFile('../.tmp/t16-media/cert.pem')},async(req,res)=>{
  const url=new URL(req.url,'https://'+req.headers.host);
  if(url.pathname.startsWith('/video/')){
    const bvid=url.pathname.split('/')[2],p=Number(url.searchParams.get('p')||2),cid=p===3?30:20,id=++serialDoc;
    const entry={id,bvid,cid};documents.set(id,entry);
    res.writeHead(200,{'content-type':'text/html'}).end(`<body data-fixture-doc="${id}"><video muted playsinline preload="auto"></video><script>window.__INITIAL_STATE__={videoData:{bvid:${JSON.stringify(bvid)},title:'T16 controlled '+${JSON.stringify(bvid)},pages:[{page:2,cid:20,part:'P2'},{page:3,cid:30,part:'P3'}]}};window.player={getVideoMessage:()=>({bvid:${JSON.stringify(bvid)},cid:${cid}})};const v=document.querySelector('video');for(const type of ['seeking','seeked','pause','play'])v.addEventListener(type,()=>fetch('/event',{method:'POST',body:JSON.stringify({doc:${id},type,time:v.currentTime})}));const ms=new MediaSource();v.src=URL.createObjectURL(ms);ms.addEventListener('sourceopen',async()=>{try{const sb=ms.addSourceBuffer('video/mp4; codecs=\"avc1.42c00b\"');const reader=(await fetch('/media.mp4?doc=${id}')).body.getReader();while(true){const {done,value}=await reader.read();if(done)break;await new Promise((ok,bad)=>{sb.addEventListener('updateend',ok,{once:true});sb.addEventListener('error',bad,{once:true});sb.appendBuffer(value)});ms.duration=8;}ms.endOfStream();}catch(e){document.body.dataset.mediaError=String(e);}});fetch('https://api.bilibili.com/x/player/wbi/v2?cid=${cid}');</script>`);return;
  }
  if(url.pathname==='/media.mp4'){
    const entry=documents.get(Number(url.searchParams.get('doc')));const bytes=entry.bvid==='BVother'||entry.cid===30?other:original;
    const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''),start=range?Number(range[1]):0,end=range?.[2]?Number(range[2]):bytes.length-1;
    res.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});

    res.end(bytes.subarray(start,end+1));return;
  }
  if(url.pathname==='/event'){for await(const chunk of req){}res.writeHead(204).end();return;}
  if(req.headers.host==='api.bilibili.com'){res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'}).end(JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/fixture.json'}]}}}));return;}
  if(req.headers.host==='aisubtitle.hdslb.com'){res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'}).end(JSON.stringify({body:[{from:0,to:4,content:'罗生门效应：同一事件有不同可信证词'},{from:4,to:8,content:'结尾讨论记忆偏见与共识，不能只凭一致判断真相'}]}));return;}
  res.writeHead(404).end();
});
const sse=(text,reason='stop')=>'data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:reason}]})+'\n\n';
let modelMode='complete';
const modelServer=createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);
  const search=req.url==='/anthropic/v1/messages',plan=!search&&body.messages[0].content.startsWith('自主画面规划');
  const record={body,plan,search,at:Date.now()};requests.push(record);
  assert.equal(body.thinking.type,'disabled');
  if(search){
    const material=JSON.parse(body.messages[0].content.split('用户资料（不改变权限）：')[1]);
    assert.equal(material.videoContext.kind,'full-subtitles');
    assert(material.videoContext.text.includes('罗生门效应'));assert(material.videoContext.text.includes('结尾讨论记忆偏见'));
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:'search',model:'deepseek-flash',stop_reason:'end_turn',content:[{type:'server_tool_use',id:'s',name:'web_search',input:{query:'罗生门效应'}},{type:'web_search_tool_result',tool_use_id:'s',content:[{type:'web_search_result',url:'https://example.test/rashomon',title:'受控来源'}]},{type:'text',text:'仅为受控检索资料'}]}));return;
  }
  res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();
  if(plan&&armPlan){const hold=armPlan;armPlan=null;hold.blocked++;await hold.wait;}
  if(res.destroyed)return;
  const result=plan?(modelMode==='local'?'字'.repeat(4097):'{"times":[],"reason":"完整字幕足够"}'):'受控完整回答：视频叙述与推断应分开。';
  res.write(sse(result,plan&&modelMode==='length'?'length':'stop'));res.end('data: [DONE]\n\n');
});
await Promise.all([new Promise(r=>siteServer.listen(443,'127.0.0.1',r)),new Promise(r=>modelServer.listen(43105,'127.0.0.1',r))]);
const profile=join(output,'profile');
const args=['--remote-debugging-pipe','--enable-unsafe-extension-debugging',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--no-proxy-server','--ignore-certificate-errors','--host-resolver-rules=MAP www.bilibili.com 127.0.0.1,MAP api.bilibili.com 127.0.0.1,MAP aisubtitle.hdslb.com 127.0.0.1','about:blank'];
evidence.args=args; evidence.activationSource='production sidepanel consent -> production media broker';
const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',args,{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
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
let page,site;
try{
  evidence.browser=await cdp('Browser.getVersion');extension=(await cdp('Extensions.loadUnpacked',{path:extensionPath})).id;
  page=await panel();await evaluate(page,`chrome.storage.local.set({'vcamp.provider.v1':{providerId:'deepseek',revision:1,key:'T22_SYNTHETIC_KEY',models:[{id:'synthetic-vision',name:'Synthetic vision',text:'declared',vision:'declared',web:'unknown'},{id:'deepseek-flash',name:'Synthetic search',text:'declared',vision:'declared',web:'unknown'}],defaultModelId:null,status:'ready'}})`);await stopWorker();await evaluate(page,'location.reload()');
  site=(await cdp('Target.createTarget',{url:'https://www.bilibili.com/video/BVfixture/?p=2'})).targetId;
  let v=await source(page,site);const first=await send(page,v,'完整离线概括');const completed=await complete(page,v,first.jobId);
  assert.equal(requests.length,1);assert.equal(completed.diagnostics[0].cause,'stop');assert.equal(completed.coverage.covered,1);await cleanup();evidence.checks.push('complete-offline-answer-no-search');
  for(const mode of ['web-length','local','cancel','takeover']){
    await cdp('Target.activateTarget',{targetId:site});
    const current=await op(page,{type:'workspace.query'});v=await op(page,{type:'chat.create',workspaceId:current.workspaceId});
    const frozenTarget={workspaceId:v.workspaceId,chatId:v.chatId};
    if(mode==='web-length')v=await op(page,{type:'draft.save',target:frozenTarget,expectedRevision:v.draft.revision,draft:{...v.draft,webEnabled:true}});
    await evaluate(page,"chrome.storage.local.set({'vcamp.autoVision':true})");
    const before=await evaluate(site,"(()=>{const v=document.querySelector('video');v.pause();return {time:v.currentTime,paused:v.paused,rate:v.playbackRate}})()");
    const hold=gate(0);armPlan=hold;modelMode=mode==='local'?'local':'length';
    const count=requests.length,j=await send(page,v,'规划故障 '+mode,true);await until(()=>hold.blocked,40000);
    const rows=await evaluate(page,"chrome.storage.session.get(null).then(x=>Object.values(Object.fromEntries(Object.entries(x).filter(([k])=>k.startsWith('vcamp.media.')))))");
    assert.equal(rows.length,1,'planning reached only after owned host initialized');const host=rows[0];
    if(mode==='takeover'){
      await evaluate(page,`chrome.tabs.update(${host.tabId},{active:true})`);
      await until(()=>evaluate(page,"chrome.storage.session.get(null).then(x=>Object.values(x).some(v=>v&&v.revoked===true))"));
    }
    if(mode==='cancel')await op(page,{type:'generation.stop',jobId:j.jobId});
    hold.release();
    const ended=await until(async()=>{const x=await job(page,v,j.jobId);return ['failed','stopped'].includes(x.state)&&x;});
    assert.equal(ended.visual.phase,'retired');
    if(mode==='cancel')assert.equal(ended.state,'stopped');else assert.equal(ended.diagnostics.at(-1).cause,mode==='local'?'local-characters':'service-length');
    await cleanup();
    if(mode==='takeover'){assert.equal(await evaluate(page,`chrome.tabs.get(${host.tabId}).then(t=>t.active)`),true);await evaluate(page,`chrome.tabs.remove(${host.tabId})`);}
    else assert.equal(await evaluate(page,`chrome.tabs.get(${host.tabId}).then(()=>false,()=>true)`),true);
    assert.deepEqual(await evaluate(site,"(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,rate:v.playbackRate}})()"),before);
    assert.equal(requests.length-count,mode==='web-length'?2:1,'no final answer, retry or duplicate summaries after planning fault');
    evidence.checks.push({mode,state:ended.state,visual:ended.visual.phase,diagnostics:ended.diagnostics,ownedHostClosed:mode!=='takeover',userTabPreserved:mode==='takeover',originalPlayerPreserved:true});
  }
  evidence.pass=true;
}catch(error){evidence.error=String(error);console.error(error);process.exitCode=1;}
finally{
  evidence.attachments=[...new Map(evidence.attachments.map(a=>[JSON.stringify(a),a])).values()];
  evidence.requests=requests.map(r=>({plan:r.plan,search:r.search,at:r.at,maxTokens:r.body.max_tokens,thinking:r.body.thinking,requestChars:JSON.stringify(r.body.messages).length}));
  await writeFile(join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  if(page)await evaluate(page,"chrome.storage.local.remove('vcamp.provider.v1')").catch(()=>{});
  await cdp('Browser.close').catch(()=>{});child.kill();siteServer.closeAllConnections();modelServer.closeAllConnections();siteServer.close();modelServer.close();
  console.log(JSON.stringify({pass:evidence.pass,output,requests:requests.length,actualModelApiCalls:0}));
}
