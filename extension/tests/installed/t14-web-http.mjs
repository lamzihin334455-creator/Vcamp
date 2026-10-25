// Installed production-path integration, controlled REAL HTTP SSE. Browser-level
// CDP only; attach briefly to panel pages, NEVER executor or Service Worker.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';


const output=resolve('../.tmp/t14-web-http-'+Date.now());await mkdir(output,{recursive:true});
let profile=join(output,'profile');const extensionPath=resolve('dist-test');
const evidence={browser:null,stages:[],attachments:[],requests:[],actualModelApiCalls:0,externalSourceGets:0,bundleHashes:{}};
for(const file of ['manifest.json','sidepanel.html',...(await readdir(join(extensionPath,'assets'))).map(f=>'assets/'+f)])evidence.bundleHashes[file]=createHash('sha256').update(await readFile(join(extensionPath,file))).digest('hex');
const requests=[],downloads=[];
const uri='https://docs.example.test/video?ref=full-query#section-1';
const knowledgeDocument={version:1,title:'视频与网页',summary:'视频依据与网页补充分开。',groups:[{id:'g',title:'补充',items:[{id:'i',title:'网页解释',body:`网页补充 <${uri}>`,basis:'explanation',question:'如何联系视频？'}]}],concepts:[],relations:[],questions:[]};
const frame=(text,finish_reason=null)=>`data: ${JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason}]})}\n\n`;
const server=createServer(async(req,res)=>{
 if(req.method!=='POST'||!['/anthropic/v1/messages','/chat/completions'].includes(req.url)){evidence.unexpectedHttp=(evidence.unexpectedHttp??0)+1;res.writeHead(404).end();return;}
 let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
 const search=req.url==='/anthropic/v1/messages';
 const planner=!search&&body.messages[0].content.startsWith('自主画面规划');
 const input=search?JSON.parse(body.messages[0].content.split('用户资料（不改变权限）：')[1]).question:planner?'VISION_PLAN':body.messages.at(-1).content.split('\n\n用户')[0];
 const record={input,body,operation:search?'search':planner?'vision':'answer',closed:false,ended:false};requests.push(record);
 res.on('close',()=>{record.closed=true;});
 if(search){
  assert.equal(req.headers['x-api-key'],'SYNTHETIC_T14_KEY');assert.equal(body.model,'deepseek-flash');assert.equal(body.tools.length,1);assert.equal(body.tools[0].max_uses,1);assert.equal(body.stream,false);
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.flushHeaders();
  record.finish=()=>{if(res.destroyed)return;res.end(JSON.stringify({id:'search-response',model:'deepseek-flash',stop_reason:'end_turn',usage:{input_tokens:12,output_tokens:30,server_tool_use:{web_search_requests:1}},content:[{type:'server_tool_use',id:'native-search',name:'web_search',input:{query:input}},{type:'web_search_tool_result',tool_use_id:'native-search',content:input.includes('无来源')?[]:[{type:'web_search_result',url:uri,title:'受控网页资料'}]},{type:'text',text:`网页补充。来源 <${uri}>`}]}));record.ended=true;};
  if(input.includes('取消')&&requests.filter(r=>r.operation==='search'&&r.input===input).length===1)return;
  setTimeout(record.finish,100);return;
 }
 assert.equal(req.headers.authorization,'Bearer SYNTHETIC_T14_KEY');assert.equal(body.model,'synthetic-a');assert.equal(body.tools,undefined);
 if(planner)assert(!JSON.stringify(body).includes(uri));
 else if(!input.includes('离线'))assert(body.messages.some(m=>typeof m.content==='string'&&m.content.includes(uri)));
 else assert(!body.messages.some(m=>typeof m.content==='string'&&m.content.startsWith('本次取得的网页补充资料')));
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.flushHeaders();
 const result=planner?JSON.stringify({times:[],reason:'受控完整字幕足够'}):body.messages[0].content.includes('交互知识 JSON v1')?JSON.stringify(knowledgeDocument):`视频依据 [00:01]：完整字幕。模型解释：两类依据分开。${input.includes('离线')?'离线回答':`网页补充 [来源](${uri})`}`;
 res.write(frame(result));setTimeout(()=>{if(res.destroyed)return;res.write(frame('','stop'));res.end('data: [DONE]\n\n');record.ended=true;},80);
});
await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(43105,'127.0.0.1',resolve);});
const startBrowser = () => spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-port=0', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let child = startBrowser();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 10000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(100); } throw Error('Condition timed out'); }
let endpoint, socket, serial = 0, extension;
const pending = new Map();
function cdp(method, params = {}, sessionId, timeout = 10000) {
  const id = ++serial;
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, timeout); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
}
async function targets() { return (await cdp('Target.getTargets')).targetInfos; }
async function evaluate(targetId, expression) {
  const target = (await targets()).find(item => item.targetId === targetId);
  assert(target?.url.includes('/sidepanel.html') || target?.url.includes('/reader.html'), 'Only panel/reader may be attached');
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  evidence.attachments.push({ url: target.url, type: target.type });
  try { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
  finally { await cdp('Target.detachFromTarget', { sessionId }); }
}
async function panel() { const { targetId } = await cdp('Target.createTarget', { url: `chrome-extension://${extension}/sidepanel.html` }); await until(() => evaluate(targetId, '!!document.querySelector("main")')); return targetId; }
const op = (page, operation) => evaluate(page, `chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:${JSON.stringify(operation)}}).then(r=>{if(!r.ok)throw Error(r.code);return r.view})`);
const ui = page => evaluate(page, '({text:document.body.innerText,draft:document.querySelector("textarea")?.value,enabled:!document.querySelector("button[aria-label=发送]")?.disabled})');
const click = async (page, label) => { const {sessionId}=await cdp('Target.attachToTarget',{targetId:page,flatten:true});try{await cdp('Page.bringToFront',{},sessionId);}finally{await cdp('Target.detachFromTarget',{sessionId});} await until(() => evaluate(page, `!![...document.querySelectorAll('button')].find(b=>!b.disabled&&(b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent===${JSON.stringify(label)}))`)); return evaluate(page, `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Missing enabled button');button.click();return true})()`); };
const fill = (page, text) => evaluate(page, `(()=>{const el=document.querySelector('textarea[aria-label=输入草稿]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
async function send(page, text) { await fill(page, text); await until(async () => (await ui(page)).enabled); await click(page, '发送'); await until(() => requests.some(request => request.input === text)); }
async function space(page) { const view = await op(page, { type: 'workspace.query' }); return { kind: 'chat', workspaceId: view.workspaceId, chatId: view.chatId }; }
async function generation(page, target) { return (await op(page, { type: 'generation.query', target })).generation; }
async function final(page, target, state, input) { return until(async () => { const view = await generation(page, target); const jobId = view.messages.find(message => message.role === 'user' && message.text === input)?.jobId; return view.jobs.find(job => job.jobId === jobId && job.state === state) && view; }); }
async function noExecutors() { return until(async () => !(await targets()).some(target => target.url.includes('/executor.html#'))); }
async function stopWorker() { const worker = await until(async () => (await targets()).find(target => target.type === 'service_worker' && target.url.includes(extension))); assert.equal(worker.attached, false); await cdp('Target.closeTarget', { targetId: worker.targetId }); await until(async () => !(await targets()).some(target => target.targetId === worker.targetId)); return worker.targetId; }
const source = partId => ({ platform: 'bilibili', videoId: 'BVt05' + partId, partId, title: partId + ' 本地 HTTP 视频' });
async function selectSource(page, partId) { await evaluate(page, `chrome.storage.local.set({'vcamp.test.video':${JSON.stringify(source(partId))}})`); await evaluate(page, 'location.reload()'); await until(async () => (await ui(page)).text.includes(partId + ' 本地 HTTP 视频')); await until(() => evaluate(page, 'document.querySelector("select[aria-label=当前模型]")?.value==="synthetic-a"')); }
function record(name, value = {}) { evidence.stages.push({ name, ...value }); console.log(name, JSON.stringify(value)); }
async function connect(previous) {
  endpoint = await until(async () => { try { const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); const value = `ws://127.0.0.1:${port}${path}`; return value !== previous && value; } catch { return null; } });
  socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => { const value = JSON.parse(event.data); if(value.method?.startsWith('Browser.download'))downloads.push(value); const item = pending.get(value.id); if (!item) return; pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(Error(JSON.stringify(value.error))) : item.resolve(value.result); };
}
async function field(page, selector, value) {
  await evaluate(page, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing field');const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`);
}
async function choose(page, name) { if(await evaluate(page,'!!document.querySelector(".reference-menu")')) { await evaluate(page,`document.querySelector('.reference-picker').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await until(() => evaluate(page,'!document.querySelector(".reference-menu")')); } await click(page, '@ 添加'); await until(() => evaluate(page, '!!document.querySelector(".reference-menu")')); await click(page, name); }
async function screenshot(page, name) {
  const {sessionId}=await cdp('Target.attachToTarget',{targetId:page,flatten:true});
  try { await cdp('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:false},sessionId); const shot=await cdp('Page.captureScreenshot',{format:'png'},sessionId); await writeFile(join(output,name+'.png'),Buffer.from(shot.data,'base64')); }
  finally { await cdp('Target.detachFromTarget',{sessionId}); }
  assert.equal(await evaluate(page,'document.documentElement.scrollWidth<=360'),true);
}


const knowledge = async (page,workspaceId) => (await op(page,{type:'knowledge.query',workspaceId})).knowledge.artifacts;
const exported = async page => JSON.parse((await op(page,{type:'library.backup.export'})).library.backup.file);
const storage = async page => { await click(page,'资料库');await click(page,'存储管理');await until(()=>evaluate(page,'!!document.querySelector("input[type=file]")')); };
async function upload(page,file) {
 const {sessionId}=await cdp('Target.attachToTarget',{targetId:page,flatten:true});
 try {await cdp('Page.bringToFront',{},sessionId);const {root}=await cdp('DOM.getDocument',{},sessionId);const {nodeId}=await cdp('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'},sessionId);await cdp('DOM.setFileInputFiles',{nodeId,files:[file]},sessionId);}finally{await cdp('Target.detachFromTarget',{sessionId});}
 await until(()=>evaluate(page,'document.body.innerText.includes("合并导入概览")'));
}
async function importFile(page,file){await upload(page,file);await click(page,'确认合并导入');await until(()=>evaluate(page,'document.body.innerText.includes("合并导入完成")'));}
async function reader(page,workspaceId,id,library=true){const {targetId}=await cdp('Target.createTarget',{url:`chrome-extension://${extension}/reader.html?${library?'library=1&':''}workspaceId=${encodeURIComponent(workspaceId)}&knowledgeId=${id}`});await until(()=>evaluate(targetId,'!!document.querySelector(".knowledge-document")'));return targetId;}
async function restart(){const previous=endpoint,exited=new Promise(resolve=>child.once('exit',resolve));await cdp('Browser.close');socket.close();await exited;child=startBrowser();await connect(previous);return panel();}

async function chooseOutput(page,label){
 await until(()=>evaluate(page,'!!document.querySelector(".output-control > button")'));
 await evaluate(page,'document.querySelector(".output-control > button").click()');
 await until(()=>evaluate(page,'!!document.querySelector(".output-menu")'));
 await evaluate(page,`[...document.querySelectorAll('.output-menu button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
}
try{
 await connect();evidence.browser=await cdp('Browser.getVersion');extension=new URL((await until(async()=>(await targets()).find(t=>t.url.endsWith('/assets/background.js')))).url).host;
 let page=await panel();
 await evaluate(page,`chrome.storage.local.set({'vcamp.provider.v1':{providerId:'deepseek',revision:1,key:'SYNTHETIC_T14_KEY',models:[{id:'synthetic-a',name:'Synthetic A',text:'declared',vision:'declared',web:'unknown'},{id:'synthetic-b',name:'Synthetic B',text:'declared',vision:'declared',web:'unknown'},{id:'deepseek-flash',name:'DeepSeek retrieval',text:'declared',vision:'unknown',web:'unknown'}],defaultModelId:'synthetic-a',status:'ready'},'vcamp.test.video':${JSON.stringify(source('WEB'))}})`);
 await stopWorker();await evaluate(page,'location.reload()');await until(()=>evaluate(page,'document.querySelector("select[aria-label=当前模型]")?.value==="synthetic-a"'));
 const old=await space(page);assert.equal((await op(page,{type:'workspace.query'})).draft.webEnabled??false,false);
 await click(page,'设置');await until(()=>evaluate(page,'!!document.querySelector("input[aria-label=新对话默认联网]")'));
 await evaluate(page,'document.querySelector("input[aria-label=新对话默认联网]").click()');await until(()=>evaluate(page,'chrome.storage.local.get("vcamp.webDefault").then(v=>v["vcamp.webDefault"]===true)'));
 await click(page,'关闭');assert.equal((await op(page,{type:'workspace.query'})).draft.webEnabled??false,false);
 await click(page,'新对话');await until(async()=>(await space(page)).chatId!==old.chatId);const target=await space(page),ws=target.workspaceId;
 await until(()=>evaluate(page,'document.querySelector("button[aria-label=当前对话联网]")?.getAttribute("aria-pressed")==="true"'));
 await send(page,'联系视频的网页问题');await final(page,target,'completed','联系视频的网页问题');await noExecutors();
 const first=(await generation(page,target)).messages.at(-1);assert.equal(first.webEvidence.status,'cited');assert.equal(first.webEvidence.sources[0].uri,uri);assert.deepEqual(first.webEvidence.references,[{uri,sourceId:'s0'}]);
 await until(()=>evaluate(page,'!!document.querySelector(".web-sources a")'));
 assert.equal(await evaluate(page,'document.querySelector(".web-sources a").getAttribute("href")'),uri);
 assert.equal(await evaluate(page,'document.querySelector(".web-sources a").getAttribute("rel")'),'noopener noreferrer');
 await screenshot(page,'chat-sources-360');record('default applies to future Chat only; installed question → linked native search → selected-model answer → exact sources',{searches:1});
 await chooseOutput(page,'Markdown 笔记');await send(page,'整理视频与网页为笔记');await final(page,target,'completed','整理视频与网页为笔记');await noExecutors();
 const notes=(await op(page,{type:'artifact.query',workspaceId:ws})).artifacts.artifacts;assert.equal(notes.length,1);assert.equal(notes[0].webEvidence.status,'cited');
 await click(page,'打开笔记');await until(()=>evaluate(page,'!!document.querySelector(".markdown-workbench .web-sources")'));await screenshot(page,'markdown-sources-360');await click(page,'问答');
 await chooseOutput(page,'交互知识');await click(page,'自主识别关');
 await fill(page,'视频与网页的交互知识');await until(async()=>(await ui(page)).enabled);await click(page,'发送');await click(page,'先规划后决定');
 await final(page,target,'completed','视频与网页的交互知识');await noExecutors();
 const docs=await knowledge(page,ws);assert.equal(docs.length,1);assert.deepEqual(docs[0].document,knowledgeDocument);assert.equal(docs[0].webEvidence.status,'cited');
 assert.equal(requests.filter(r=>r.operation==='vision').length,1);assert.equal(requests.filter(r=>r.operation==='search').length,3);
 await click(page,'打开交互知识');await until(()=>evaluate(page,'!!document.querySelector(".knowledge-document .web-sources")'));await screenshot(page,'knowledge-sources-360');
 assert.equal(await evaluate(page,'document.querySelectorAll(".knowledge-document iframe,.knowledge-document script,.knowledge-document img").length'),0);
 await click(page,'问答');await click(page,'自主识别开');await chooseOutput(page,'Chat 问答');
 record('Markdown and strict knowledge sources; real executor T16 no-frame planning + final answering, one search each',{searches:3,plannerCalls:1});
 await send(page,'取消这次网页检索');await until(()=>evaluate(page,'document.body.innerText.includes("正在检索网页")'));
 const held=requests.at(-1),beforeAnswers=requests.filter(r=>r.operation==='answer').length;
 await click(page,'停止生成');await final(page,target,'stopped','取消这次网页检索');await noExecutors();await until(()=>held.closed);held.finish();
 assert.equal(requests.filter(r=>r.operation==='answer').length,beforeAnswers);assert.equal((await generation(page,target)).messages.at(-1).webEvidence.status,'failed');
 await click(page,'当前对话联网');await field(page,'select[aria-label=当前模型]','synthetic-b');
 await until(async()=>(await op(page,{type:'workspace.query'})).draft.webEnabled===false);
 await click(page,'重试原请求');await final(page,target,'completed','取消这次网页检索');await noExecutors();
 const retryFile=await exported(page),retried=retryFile.payload.jobs.find(j=>j.snapshot.input==='取消这次网页检索');
 assert.equal(retried.snapshot.webEnabled,true);assert.equal(retried.snapshot.modelId,'synthetic-a');assert.equal(retried.attempts.length,2);assert.equal(retried.attempts[0].webEvidence.status,'failed');assert.equal(retried.attempts[1].webEvidence.status,'cited');
 await field(page,'select[aria-label=当前模型]','synthetic-a');await click(page,'当前对话联网');await send(page,'无来源需要明确失败');await final(page,target,'failed','无来源需要明确失败');await noExecutors();
 const failure=(await generation(page,target)).jobs.find(j=>j.error==='web-no-sources');assert(failure);assert.equal(requests.filter(r=>r.operation==='answer').length,beforeAnswers+1);
 record('search cancellation aborts HTTP and cleans executor; late reply cannot commit; manual retry freezes original web/model; empty sources fail before final answer');
 await click(page,'当前对话联网');const searches=requests.filter(r=>r.operation==='search').length;await send(page,'离线视频问题');await final(page,target,'completed','离线视频问题');await noExecutors();assert.equal(requests.filter(r=>r.operation==='search').length,searches);
 page=await restart();await until(async()=>(await space(page)).chatId===target.chatId);assert.equal((await op(page,{type:'workspace.query'})).draft.webEnabled,false);
 assert.equal((await generation(page,target)).messages.find(m=>m.messageId===first.messageId).webEvidence.sources[0].uri,uri);
 const readonly=await reader(page,ws,docs[0].id);assert.equal(await evaluate(readonly,'document.querySelector(".web-sources a").getAttribute("href")'),uri);await screenshot(readonly,'reopened-readonly-sources-360');
 const beforeImport=requests.length;await storage(page);await importFile(page,resolve('tests/fixtures/t09-legacy-custom-backup.json'));
 const imported=await exported(page);assert(imported.payload.templates.some(t=>t.id==='013261fc-f896-4e47-a4b6-6081f3afb2de'&&t.name==='旧交互页面'&&!t.outputProtocol));assert.equal(requests.length,beforeImport);
 const packet=await exported(page),text=JSON.stringify(packet);assert.equal(packet.manifest.formatVersion,3);assert.equal(packet.manifest.databaseVersion,8);assert(!text.includes('SYNTHETIC_T14_KEY'));assert.equal(packet.payload.jobs.find(j=>j.snapshot.input==='联系视频的网页问题').attempts[0].webEvidence.sources[0].uri,uri);
 assert.equal(evidence.unexpectedHttp??0,0);record('offline sends no search; browser restart preserves options/evidence; readonly sources; actual format2 file input/import makes zero model requests',{controlledRequests:requests.length,searches,externalSourceGets:0});
 evidence.pass=true;
}catch(error){evidence.failure=error.stack;evidence.panelStates=await Promise.all((await targets()).filter(t=>t.url.includes('/sidepanel.html')).map(t=>ui(t.targetId))).catch(()=>[]);console.error(error);process.exitCode=1;}
finally{evidence.requests=requests.map(({input,operation,ended,closed,body})=>({input,operation,model:body.model,ended,closed}));await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2));if(socket?.readyState===WebSocket.OPEN){await cdp('Browser.close',{},undefined,3000).catch(()=>{});socket.close();}child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));console.log('Evidence:',join(output,'result.json'));}
