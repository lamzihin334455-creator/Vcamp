// Installed production-path integration, controlled REAL HTTP SSE. Browser-level
// CDP only; attach briefly to panel pages, NEVER executor or Service Worker.
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';


const output=resolve('../.tmp/t22-learning-'+Date.now());await mkdir(output,{recursive:true});
let profile=join(output,'profile');let extensionPath=join(output,'package');await cp(resolve('dist-test'),extensionPath,{recursive:true});
await build({configFile:false,publicDir:false,logLevel:'error',build:{outDir:extensionPath,emptyOutDir:false,rollupOptions:{input:resolve('tests/installed/t22-seed.html'),output:{entryFileNames:'assets/t22Seed.js'}}}});
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
 const subtitle=!search&&body.messages[0].content.startsWith('你是字幕处理器');
 const last=body.messages.at(-1).content;const lastText=typeof last==='string'?last:last.find(p=>p.type==='text').text;
 const input=subtitle?'SUBTITLE_'+JSON.parse(lastText).operation:search?JSON.parse(body.messages[0].content.split('用户资料（不改变权限）：')[1]).question:planner?'VISION_PLAN':lastText.split('\n\n用户')[0];
 const record={input,body,operation:subtitle?'subtitle':search?'search':planner?'vision':'answer',closed:false,ended:false};requests.push(record);
 res.on('close',()=>{record.closed=true;});
 if(search){
  assert.equal(req.headers['x-api-key'],'SYNTHETIC_T22_KEY');assert.equal(body.model,'deepseek-flash');assert.equal(body.tools.length,1);assert.equal(body.tools[0].max_uses,1);assert.equal(body.stream,false);
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.flushHeaders();
  record.finish=()=>{if(res.destroyed)return;res.end(JSON.stringify({id:'search-response',model:'deepseek-flash',stop_reason:'end_turn',usage:{input_tokens:12,output_tokens:30,server_tool_use:{web_search_requests:1}},content:[{type:'server_tool_use',id:'native-search',name:'web_search',input:{query:input}},{type:'web_search_tool_result',tool_use_id:'native-search',content:input.includes('无来源')?[]:[{type:'web_search_result',url:uri,title:'受控网页资料'}]},{type:'text',text:`网页补充。来源 <${uri}>`}]}));record.ended=true;};
  if(input.includes('取消')&&requests.filter(r=>r.operation==='search'&&r.input===input).length===1)return;
  setTimeout(record.finish,100);return;
 }
 assert.equal(req.headers.authorization,'Bearer SYNTHETIC_T22_KEY');assert.equal(body.model,'synthetic-a');assert.equal(body.tools,undefined);
 if(planner)assert(!JSON.stringify(body).includes(uri));
 else if(input.includes('联网'))assert(body.messages.some(m=>typeof m.content==='string'&&m.content.includes(uri)));

 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.flushHeaders();
 const result=subtitle?JSON.stringify({cues:JSON.parse(lastText).cues.map(c=>({...c,content:'T22 '+JSON.parse(lastText).operation+' '+c.index}))}):planner?JSON.stringify({times:[],reason:'受控完整字幕足够'}):body.messages[0].content.includes('交互知识 JSON v1')?JSON.stringify(knowledgeDocument):`视频依据 [00:01]：完整字幕。模型解释：两类依据分开。${input.includes('离线')?'离线回答':`网页补充 [来源](${uri})`}`;
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
  assert(target?.url.includes('/sidepanel.html') || target?.url.includes('/reader.html') || target?.url.includes('/t22-seed.html'), 'Only panel/reader may be attached');
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
async function restart(){const previous=endpoint,exited=new Promise(resolve=>child.once('exit',resolve));await cdp('Browser.close');socket.close();await exited;child=startBrowser();await connect(previous);extension=new URL((await until(async()=>(await targets()).find(t=>t.url.endsWith('/assets/background.js')))).url).host;return panel();}

async function chooseOutput(page,label){
 await until(()=>evaluate(page,'!!document.querySelector(".output-control > button")'));
 await evaluate(page,'document.querySelector(".output-control > button").click()');
 await until(()=>evaluate(page,'!!document.querySelector(".output-menu")'));
 await evaluate(page,`[...document.querySelectorAll('.output-menu button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
}

// Composite scope reuses T14's isolated browser/HTTP and T09/T20 file migration drivers.
async function proofPage(){const {targetId}=await cdp('Target.createTarget',{url:`chrome-extension://${extension}/tests/installed/t22-seed.html`});await until(()=>evaluate(targetId,'!!window.t22Proof'));return targetId;}
async function saveDraft(page,target,changes){const v=await op(page,{type:'workspace.query',target});return op(page,{type:'draft.save',target,expectedRevision:v.draft.revision,draft:{...v.draft,...changes}});}
async function request(page,target,text,changes={}){await saveDraft(page,target,{text,modelId:'synthetic-a',template:null,referenceIds:[],references:[],scribble:undefined,...changes});const v=await op(page,{type:'workspace.query',target});await op(page,{type:'generation.send',target:{kind:'chat',...target},expectedRevision:v.draft.revision});await final(page,{kind:'chat',...target},'completed',text);await noExecutors();}
async function readObject(workspaceId,key,id,expected){const {targetId}=await cdp('Target.createTarget',{url:`chrome-extension://${extension}/reader.html?library=1&workspaceId=${encodeURIComponent(workspaceId)}&${key}=${id}`});await until(()=>evaluate(targetId,`document.body?.innerText.includes(${JSON.stringify(expected)})`));return targetId;}
const countPayload=p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,v.length]));
try{
 await connect();evidence.browser=await cdp('Browser.getVersion');extension=new URL((await until(async()=>(await targets()).find(t=>t.url.endsWith('/assets/background.js')))).url).host;
 let proof=await proofPage();
 await evaluate(proof,`chrome.storage.local.set({'vcamp.test.video':{platform:'bilibili',videoId:'BVbackupA',partId:'101',title:'备份重复标题 · P1'}})`);
 let page=await panel();
 const f=await evaluate(proof,'window.t22Proof.seed()');
 const imageFixture=await evaluate(proof,`window.t22Proof.images(${JSON.stringify(f.a.id)},${JSON.stringify(f.a.chatId)})`);
 const sourceA={platform:'bilibili',videoId:'BVbackupA',partId:'101',title:'备份重复标题 · P1',videoTitle:'备份重复标题',pageNumber:1,partCount:2};
 await evaluate(page,`chrome.storage.local.set({'vcamp.provider.v1':{providerId:'deepseek',revision:1,key:'SYNTHETIC_T22_KEY',models:[{id:'synthetic-a',name:'Synthetic A',text:'declared',vision:'declared',web:'unknown'},{id:'deepseek-flash',name:'DeepSeek retrieval',text:'declared',vision:'unknown',web:'unknown'}],defaultModelId:'synthetic-a',status:'ready'},'vcamp.test.video':${JSON.stringify(sourceA)}})`);
 await stopWorker();await evaluate(page,'location.reload()');const target={workspaceId:f.a.id,chatId:f.a.chatId};
 await op(page,{type:'chat.select',...target});
 await request(page,target,'T22 概括视频并结合主动PNG',{outputType:'chat',webEnabled:false});
 assert(requests.at(-1).body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));
 await request(page,target,'T22 整理Markdown',{outputType:'markdown'});
 let note=(await op(page,{type:'artifact.query',workspaceId:f.a.id})).artifacts.artifacts.find(a=>! [f.note.id].includes(a.id));assert(note);
 await op(page,{type:'artifact.save',workspaceId:f.a.id,artifactId:note.id,expectedRevision:note.revision,content:'# T22 已编辑学习笔记\n从视频概括到分类和深入问答。'});
 await request(page,target,'T22 显式引用已编辑笔记',{outputType:'chat',referenceIds:[note.id]});assert(JSON.stringify(requests.at(-1).body).includes('T22 已编辑学习笔记'));
 const fields={name:'T22 知识协议模板',description:'组合验收',requirements:'分类并给出条目追问',outputType:'html',outputProtocol:'knowledge-json-v1',defaultModelId:'synthetic-a'};
 const tv=(await op(page,{type:'template.create',fields})).templates.templates.find(t=>t.name===fields.name);assert(tv);
 await request(page,target,'T22 联网分类知识',{outputType:'html',webEnabled:true,template:{templateId:tv.id,revisionId:tv.revisionId}});
 const doc=(await knowledge(page,f.a.id))[0];assert.equal(doc.webEvidence.status,'cited');
 await evaluate(page,'location.reload()');await until(()=>evaluate(page,'!!document.querySelector("button[aria-label=发送]")'));
 await click(page,'打开交互知识');await until(()=>evaluate(page,'!!document.querySelector(".knowledge-entry")'));
 await evaluate(page,'document.querySelector(".knowledge-entry").open=true');await click(page,'深入追问：网页解释');await click(page,'带入来源对话确认');await until(()=>evaluate(page,'!!document.querySelector(".knowledge-followup-preview")'));
 await fill(page,'T22 深入追问此条目');await until(async()=>(await ui(page)).enabled);await click(page,'发送');await final(page,{kind:'chat',...target},'completed','T22 深入追问此条目');await noExecutors();
 assert(JSON.stringify(requests.at(-1).body).includes('用户显式选中追问的最小资料'));
 for(const operation of ['enhance','translate']){
  await op(page,{type:'generation.subtitle.send',binding:(await op(page,{type:'workspace.query'})).video.binding,target:{kind:'subtitle',workspaceId:f.a.id,operation},targetLanguage:operation==='translate'?'en':null,requirements:'T22 连续流程',modelId:'synthetic-a'});
  await until(async()=>{const p=await exported(page);return p.payload.jobs.some(j=>j.snapshot.requirements==='T22 连续流程'&&j.snapshot.target.operation===operation&&j.attempts.at(-1).state==='completed');});await noExecutors();
 }
 let sv=(await op(page,{type:'subtitles.query',workspaceId:f.a.id})).subtitles;const enhanced=sv.versions.find(v=>v.cues[0].content==='T22 enhance 0');assert(enhanced);
 await op(page,{type:'subtitles.source.select',workspaceId:f.a.id,expectedRevision:sv.sourceRevision,source:{kind:'enhanced',versionId:enhanced.id}});
 await request(page,target,'T22 使用新增强分析源',{outputType:'chat',webEnabled:false});assert(JSON.stringify(requests.at(-1).body).includes('T22 enhance 0'));
 const r=await readObject(f.a.id,'knowledgeId',doc.id,'视频与网页');await screenshot(r,'knowledge-reader-360');
 await op(page,{type:'library.favorite.add',folderId:f.folder.id,target:{workspaceId:f.a.id,entityType:'html',id:doc.id}});
 const trashTarget={workspaceId:f.a.id,entityType:'html',id:doc.id},preview=(await op(page,{type:'library.trash.preview',target:trashTarget})).library.deletePreview;
 await op(page,{type:'library.trash.move',target:trashTarget,expectedRevision:preview.revision});const entry=(await op(page,{type:'library.trash.query'})).library.trash.entries.find(e=>e.target.id===doc.id);
 await op(page,{type:'library.trash.restore',target:trashTarget,expectedRevision:entry.revision});
 record('continuous HTTP learning: manual PNG → summary → Markdown/edit/reference → protocol template → web knowledge/selected followup → enhance/translate → selected analysis → readonly/favorite/trash/restore');
 // Persist an active search via the public semantic store, without launching a fake executor.
 const searching=await evaluate(proof,`window.t22Proof.searching(${JSON.stringify(f.a.id)})`);
 await storage(page);await cdp('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:output,eventsEnabled:true});await click(page,'下载资料备份');
 const download=await until(()=>downloads.find(e=>e.method==='Browser.downloadProgress'&&e.params.state==='completed'));
 const downloaded=join(output,download.params.guid),text=await readFile(downloaded,'utf8'),packet=JSON.parse(text);await writeFile(join(output,'downloaded-backup.json'),text);
 for(const forbidden of ['SYNTHETIC_T22_KEY','fixture-document','t22-synthetic-document','首条完整字幕','尾条完整字幕','"grant"','"lease"'])assert(!text.includes(forbidden),forbidden);
 assert.equal(packet.payload.workspaces.length,3);assert.equal(new Set(packet.payload.workspaces.map(w=>w.source.videoId)).size,2);assert(packet.payload.workspaces.some(w=>w.deleted));
 assert(packet.payload.templates.some(t=>t.outputProtocol==='knowledge-json-v1'));assert(packet.payload.jobs.some(j=>j.snapshot.knowledgeContext));assert(packet.payload.jobs.some(j=>j.snapshot.referenceSnapshots?.some(r=>r.revision===2)));
 assert.equal(packet.payload.attachments.length,2);assert(packet.payload.jobs.some(j=>j.attempts.some(a=>a.visual?.frozen&&a.visual.attachmentIds.includes(imageFixture.automaticId))));
 assert.equal(packet.payload.jobs.find(j=>j.jobId===searching.jobId).attempts[0].webEvidence.status,'searching');
 evidence.dataset={counts:countPayload(packet.payload),downloadSha256:createHash('sha256').update(text).digest('hex'),downloadBytes:Buffer.byteLength(text),images:packet.payload.attachments.map(a=>({id:a.id,sha256:a.sha256,bytes:a.bytes})),imageBasis:'semantic public-store PNG; manual PNG traversed HTTP; frozen autonomous PNG migration only; live capture reused from T16'};
 const beforeImportRequests=requests.length;
 profile=join(output,'empty-profile');extensionPath=resolve('dist');page=await restart();await storage(page);assert.equal((await exported(page)).payload.workspaces.length,0);
 await upload(page,downloaded);assert.equal((await exported(page)).payload.workspaces.length,0);await click(page,'确认合并导入');await until(()=>evaluate(page,'document.body.innerText.includes("合并导入完成")'));
 let imported=(await exported(page)).payload;assert.equal((await op(page,{type:'provider.query'})).provider.hasKey,false);
 assert.deepEqual(countPayload(imported),countPayload(packet.payload));
 for(const a of packet.payload.attachments)assert.deepEqual(imported.attachments.find(x=>x.id===a.id),a);
 const stopped=imported.jobs.find(j=>j.jobId===searching.jobId).attempts[0];assert.equal(stopped.state,'interrupted');assert.equal(stopped.webEvidence.status,'failed');
 page=await restart();
 for(const [ws,key,id,value] of [[f.a.id,'artifactId',note.id,'T22 已编辑学习笔记'],[f.a.id,'knowledgeId',doc.id,'视频与网页'],[f.a.id,'scribbleId',f.scribble.id,'导入的具体随笔'],[f.a.id,'subtitleVersionId',enhanced.id,'T22 enhance 0'],[f.a.id,'chatId',f.a.chatId,'T22 深入追问此条目'],[f.b.id,'artifactId',f.bNote.id,'来源对话已删除']])await readObject(ws,key,id,value);
 const restoredImages=(await op(page,{type:'attachment.read',target,ids:[imageFixture.manual.id],historyOnly:true}));assert(restoredImages);
 await storage(page);await upload(page,downloaded);await until(()=>evaluate(page,'document.body.innerText.includes("新增 0 条")'));await click(page,'确认合并导入');await until(()=>evaluate(page,'document.body.innerText.includes("合并导入完成")'));
 assert.deepEqual(countPayload((await exported(page)).payload),countPayload(imported));
 const conflictDraft=imported.workspaces.find(w=>w.id===target.workspaceId).chats.find(c=>c.id===target.chatId).draft;await op(page,{type:'draft.save',target,expectedRevision:conflictDraft.revision,draft:{...conflictDraft,text:'T22 本机冲突草稿'}});await importFile(page,downloaded);imported=(await exported(page)).payload;
 const copied=imported.artifacts.find(a=>a.type==='html'&&a.id!==doc.id);assert(copied);assert.notEqual(copied.sourceChatId,doc.sourceChatId);
 const copiedFollow=imported.jobs.find(j=>j.snapshot.target.chatId===copied.sourceChatId&&j.snapshot.knowledgeContext);assert.equal(copiedFollow.snapshot.knowledgeContext.artifactId,copied.id);assert.equal(copiedFollow.snapshot.knowledgeContext.revisionId,copied.revisionId);
 const copiedNote=imported.artifacts.find(a=>a.type==='markdown'&&a.sourceChatId===copied.sourceChatId&&a.title===note.title);assert(copiedNote);
 assert(imported.jobs.some(j=>j.snapshot.target.chatId===copied.sourceChatId&&j.snapshot.referenceSnapshots?.some(r=>r.artifactId===copiedNote.id&&r.revision===2)));
 assert(imported.attachments.some(a=>a.id!==imageFixture.manual.id&&a.chatId===copied.sourceChatId&&a.sha256===imageFixture.manual.sha256));
 assert(imported.favorites.some(fav=>fav.target.id===copied.id));
 await readObject(f.a.id,'knowledgeId',copied.id,'视频与网页');assert.equal(requests.length,beforeImportRequests);
 const {sessionId}=await cdp('Target.attachToTarget',{targetId:page,flatten:true});try{await cdp('Emulation.setDeviceMetricsOverride',{width:420,height:560,deviceScaleFactor:1,mobile:false},sessionId);const shot=await cdp('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(join(output,'import-short-420.png'),Buffer.from(shot.data,'base64'));}finally{await cdp('Target.detachFromTarget',{sessionId});}
 assert(await evaluate(page,'document.documentElement.scrollWidth<=innerWidth'));
 record('same actual file → truly empty profile → preview no write → import/interrupted search → restart/read all → identical import no duplicates → conflicting Chat copy/maps/PNG/favorites; no model requests',{requests:requests.length,finalCounts:countPayload(imported)});
 evidence.pass=true;
}catch(error){evidence.failure=error.stack;evidence.panelStates=await Promise.all((await targets()).filter(t=>t.url.includes('/sidepanel.html')).map(t=>ui(t.targetId))).catch(()=>[]);console.error(error);process.exitCode=1;}
finally{evidence.requests=requests.map(({input,operation,ended,closed,body})=>({input,operation,model:body.model,ended,closed}));await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2));if(socket?.readyState===WebSocket.OPEN){await cdp('Browser.close',{},undefined,3000).catch(()=>{});socket.close();}child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));console.log('Evidence:',join(output,'result.json'));}
