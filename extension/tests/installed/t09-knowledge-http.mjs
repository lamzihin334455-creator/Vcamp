// Installed production-path integration, controlled REAL HTTP SSE. Browser-level
// CDP only; attach briefly to panel pages, NEVER executor or Service Worker.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const output = resolve('../.tmp/t09-knowledge-http-' + Date.now());
await mkdir(output, { recursive: true });
let profile = join(output, 'profile'); const extensionPath = resolve('dist-test');
const evidence = { browser: null, stages: [], attachments: [], requests: [], actualModelApiCalls: 0 };
evidence.bundleHashes={};for(const file of ['manifest.json','sidepanel.html',...(await readdir(join(extensionPath,'assets'))).map(f=>'assets/'+f)])evidence.bundleHashes[file]=createHash('sha256').update(await readFile(join(extensionPath,file))).digest('hex');
const requests = [], downloads = [];
const knowledgeDocument = {version:1,title:'能量与运动',summary:'视频概括：运动与能量的联系。<img src="https://bad.example/x" onerror="alert(1)">',groups:[{id:'g1',title:'基础知识',items:[{id:'i1',title:'动能',body:'SELECTED_ONLY 运动物体具有动能。',basis:'video',question:'速度为何影响动能？'}]},{id:'g2',title:'拓展',items:[{id:'i2',title:'势能',body:'UNSELECTED_SECRET 势能与位置有关。',basis:'explanation',question:'如何计算势能？'}]}],concepts:[{id:'c1',title:'能量守恒',body:'理想孤立系统总能量守恒。',basis:'explanation',question:'实际系统如何验证？'}],relations:[{from:'i1',to:'c1',label:'遵循'}],questions:[{id:'q1',title:'深入问题',body:'需要分清系统边界。',basis:'inference',question:'边界如何选择？'}]};
const frame = (text, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason }] })}\n\n`;
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/chat/completions') { res.writeHead(404).end(); return; }
  let data = ''; for await (const part of req) data += part;
  const body = JSON.parse(data); let payload;
  try { payload = JSON.parse(body.messages.at(-1).content); } catch {}
  const input = payload?.cues ? payload.requirements : body.messages.at(-1).content.split('\n\n用户')[0];
  const record = { input, body, operation: payload?.operation ?? 'chat', closed: false, ended: false }; requests.push(record);
  res.on('close', () => { record.closed = true; });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }); res.flushHeaders();
  const result = payload?.cues ? JSON.stringify({ cues: payload.cues.map(cue => ({ ...cue, content: `ENHANCED ${cue.index} 能量与运动` })) }) : body.messages[0].content.includes('本次产物固定为交互知识 JSON v1') ? JSON.stringify(knowledgeDocument) : '已保存深入回答：速度翻倍时动能增至四倍。';
  const split = Math.ceil(result.length / 2); res.write(frame(result.slice(0, split)));
  record.finish = () => { if (res.destroyed) return; res.write(frame(result.slice(split), 'stop')); res.end('data: [DONE]\n\n'); record.ended = true; };
  setTimeout(record.finish, 180);
});
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(43105, '127.0.0.1', resolve); });
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
try {
 await connect();evidence.browser=await cdp('Browser.getVersion');extension=new URL((await until(async()=>(await targets()).find(t=>t.url.endsWith('/assets/background.js')))).url).host;
 let page=await panel();
 await evaluate(page,`chrome.storage.local.set({'vcamp.provider.v1':{providerId:'deepseek',revision:1,key:'SYNTHETIC_T09_KEY',models:[{id:'synthetic-a',name:'Synthetic A',text:'declared',vision:'unknown',web:'unknown'}],defaultModelId:'synthetic-a',status:'ready'},'vcamp.test.video':${JSON.stringify(source('A'))}})`);
 await stopWorker();await evaluate(page,'location.reload()');await until(()=>evaluate(page,'document.querySelector("select[aria-label=当前模型]")?.value==="synthetic-a"'));
 const a=await space(page),ws=a.workspaceId;
 // Save an enhanced analysis source through the public executor/HTTP chain.
 await click(page,'字幕');await until(()=>evaluate(page,'!!document.querySelector(".subtitle-ai-controls")'));await evaluate(page,'document.querySelector(".subtitle-ai-controls details").open=true');
 await until(()=>evaluate(page,'!document.querySelector(".subtitle-ai-controls button").disabled'));await field(page,'textarea[aria-label=字幕处理要求]','ENHANCE');await click(page,'增强并保存新版本');
 const enhanced=await until(async()=>(await op(page,{type:'subtitles.query',workspaceId:ws})).subtitles.versions.find(v=>v.type==='enhance'));await noExecutors();
 await field(page,'select[aria-label="Chat 分析源"]',enhanced.id);await until(async()=>(await op(page,{type:'subtitles.query',workspaceId:ws})).subtitles.analysisSource.kind==='enhanced');
 await click(page,'问答');await choose(page,'学习导图 · v2');await send(page,'整理视频中的能量与运动');await final(page,a,'completed','整理视频中的能量与运动');await noExecutors();
 const artifacts=await knowledge(page,ws);assert.equal(artifacts.length,1);const artifact=artifacts[0];assert.deepEqual(artifact.document,knowledgeDocument);
 assert.equal(await evaluate(page,'!!document.querySelector(".chat-thread")'),true);assert.equal(await evaluate(page,'!!document.querySelector(".knowledge-document")'),false);
 const creation=requests.find(r=>r.input==='整理视频中的能量与运动');assert(JSON.stringify(creation.body).includes('ENHANCED 1'));assert(!JSON.stringify(creation.body).includes('首条完整字幕'));
 await fill(page,'完整保留草稿');await until(async()=>(await op(page,{type:'workspace.query'})).draft.text==='完整保留草稿');const original=(await op(page,{type:'workspace.query'})).draft;
 await click(page,'打开交互知识');await until(()=>evaluate(page,'!!document.querySelector(".knowledge-document")'));await screenshot(page,'knowledge-360');
 assert.equal(await evaluate(page,'document.querySelectorAll(".knowledge-document img,.knowledge-document iframe,.knowledge-document script,.knowledge-document a").length'),0);
 // Native details keyboard activation; category and relationship state stay local.
 const {sessionId}=await cdp('Target.attachToTarget',{targetId:page,flatten:true});
 try{await cdp('Page.bringToFront',{},sessionId);await cdp('Runtime.evaluate',{expression:'document.querySelector(".knowledge-entry summary").focus()'},sessionId);await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'},sessionId);await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessionId);}finally{await cdp('Target.detachFromTarget',{sessionId});}
 await until(()=>evaluate(page,'document.querySelector(".knowledge-entry").open'));
 await field(page,'select[aria-label=浏览分类]','g2');assert.equal(await evaluate(page,'document.querySelectorAll(".knowledge-document section").length'),1);await field(page,'select[aria-label=浏览分类]','all');
 await evaluate(page,'document.querySelector(".knowledge-relation button").click()');assert.equal(await evaluate(page,'!!document.querySelector(".knowledge-document aside")'),true);await click(page,'关闭关系详情');
 const before=requests.length;const keySession=(await cdp('Target.attachToTarget',{targetId:page,flatten:true})).sessionId;try{await cdp('Runtime.evaluate',{expression:'document.querySelector(".knowledge-entry summary").focus()'},keySession);await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'},keySession);await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},keySession);await cdp('Runtime.evaluate',{expression:'document.querySelector(".knowledge-entry button").focus()'},keySession);await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'},keySession);await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},keySession);}finally{await cdp('Target.detachFromTarget',{sessionId:keySession});}await until(()=>evaluate(page,'!!document.querySelector(".knowledge-followup")'));await field(page,'textarea[aria-label=编辑追问问题]','请用速度翻倍的例子解释');await screenshot(page,'followup-preview-360');await click(page,'带入来源对话确认');await until(()=>evaluate(page,'!!document.querySelector(".knowledge-followup-preview")'));assert.equal(requests.length,before);await screenshot(page,'chat-confirmation-360');
 await field(page,'textarea[aria-label=输入草稿]','');await until(async()=>(await op(page,{type:'workspace.query'})).draft.knowledgeFollowup.question==='');assert.equal((await ui(page)).enabled,false);await field(page,'textarea[aria-label=输入草稿]','编辑后确认：速度翻倍如何影响动能？');await until(async()=>(await ui(page)).enabled);await click(page,'发送');await final(page,a,'completed','编辑后确认：速度翻倍如何影响动能？');await noExecutors();
 const follow=requests.at(-1);assert(follow.body.messages.at(-1).content.includes('SELECTED_ONLY'));assert(!JSON.stringify(follow.body).includes('UNSELECTED_SECRET'));assert(!JSON.stringify(follow.body).includes(knowledgeDocument.summary));
 const restored=(await op(page,{type:'workspace.query'})).draft;assert.deepEqual({...restored,revision:original.revision},original);assert.equal(await evaluate(page,'document.querySelector("textarea[aria-label=输入草稿]").value'),'完整保留草稿');
 record('enhanced-video → immutable knowledge → active open → keyboard/category/relation → edited explicit HTTP followup → saved answer + full draft retained',{modelRequests:requests.length,minimalContext:true});
 page=await restart();let r=await reader(page,ws,artifact.id);await screenshot(r,'readonly-reopened-360');const readCount=requests.length;
 await evaluate(r,'document.querySelector(".knowledge-entry").open=true');assert.equal(await evaluate(r,'document.querySelectorAll("textarea,.knowledge-followup").length'),0);assert.equal(requests.length,readCount);
 const fixed=await reader(page,ws,artifact.id,false);const rv=await op(fixed,{type:'workspace.query'});assert.equal(rv.video,undefined);assert.equal(rv.chatId,null);
 const denied=await evaluate(fixed,`chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'chat.create',workspaceId:${JSON.stringify(ws)}}})`);assert.equal(denied.code,'forbidden');
 await storage(page);await click(page,'返回资料库');await click(page,'新建文件夹');await field(page,'input[aria-label=文件夹名称]','知识收藏');await evaluate(page,'document.querySelector(".library-folder-form").requestSubmit()');await until(async()=>(await op(page,{type:'library.query'})).library.folders.length===1);
 await click(page,'具体资料');await until(()=>evaluate(page,'!![...document.querySelectorAll(".library-object")].find(e=>e.textContent.includes("能量与运动"))'));
 await evaluate(page,'[...document.querySelectorAll(".library-object")].find(e=>e.textContent.includes("能量与运动")).querySelectorAll("button")[1].click()');await click(page,'加入 知识收藏');await click(page,'完成收藏');
 await evaluate(page,'[...document.querySelectorAll(".library-object")].find(e=>e.textContent.includes("能量与运动")).querySelectorAll("button")[2].click()');await click(page,'确认移至回收站');await until(async()=>(await knowledge(page,ws)).length===0);
 await click(page,'回收站');await until(()=>evaluate(page,'!!document.querySelector(".trash-entry")'));await click(page,'恢复');await until(async()=>(await knowledge(page,ws)).length===1);await click(page,'返回资料库');
 assert((await op(page,{type:'library.query',folderId:'all'})).library.favorites.some(f=>f.target.entityType==='html'&&f.available));
 await click(page,'存储管理');await cdp('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:output,eventsEnabled:true});await click(page,'下载资料备份');
 const completed=await until(()=>downloads.find(e=>e.method==='Browser.downloadProgress'&&e.params.state==='completed'));const downloaded=join(output,completed.params.guid),text=await readFile(downloaded,'utf8'),packet=JSON.parse(text);await writeFile(join(output,'downloaded-backup.json'),text);
 assert.equal(packet.manifest.formatVersion,3);assert(!text.includes('SYNTHETIC_T09_KEY'));assert.equal(packet.payload.artifacts.filter(a=>a.type==='html').length,1);record('restart → both fixed readers offline → favorite → trash/restore → actual browser download',{bytes:Buffer.byteLength(text)});
 // Same package copied into a genuinely empty second browser profile, through actual file input.
 profile=join(output,'empty-profile');page=await restart();await evaluate(page,`chrome.storage.local.set({'vcamp.test.video':${JSON.stringify(source('A'))}})`);await evaluate(page,'location.reload()');await until(async()=>(await op(page,{type:'workspace.query'})).workspaceId===ws);await storage(page);assert.equal((await exported(page)).payload.artifacts.length,0);await importFile(page,downloaded);
 let imported=await exported(page);assert.equal(imported.payload.artifacts.length,1);r=await reader(page,ws,artifact.id);await screenshot(r,'empty-profile-import-360');
 const read=await op(page,{type:'workspace.query',target:{workspaceId:ws,chatId:artifact.sourceChatId}});await op(page,{type:'draft.save',target:{workspaceId:ws,chatId:artifact.sourceChatId},expectedRevision:read.draft.revision,draft:{...read.draft,text:'本机冲突草稿'}});
 await importFile(page,downloaded);imported=await exported(page);const copy=imported.payload.artifacts.find(a=>a.type==='html'&&a.id!==artifact.id);assert(copy);assert.notEqual(copy.sourceChatId,artifact.sourceChatId);
 const copiedFollow=imported.payload.jobs.find(j=>j.snapshot.target.chatId===copy.sourceChatId&&j.snapshot.knowledgeContext);assert.equal(copiedFollow.snapshot.knowledgeContext.artifactId,copy.id);assert.equal(copiedFollow.snapshot.knowledgeContext.revisionId,copy.revisionId);assert.equal(copiedFollow.snapshot.knowledgeContext.entry.id,'i1');
 r=await reader(page,ws,copy.id);await screenshot(r,'conflict-copy-reader-360');assert.equal(requests.length,readCount);
 record('actual downloaded file → empty profile input/import → conflict copy identity remap → reopened reader',{artifacts:imported.payload.artifacts.length,modelCallsOnReadOrImport:0});evidence.pass=true;
} catch(error){evidence.failure=error.stack;evidence.panelStates=await Promise.all((await targets()).filter(t=>t.url.includes('/sidepanel.html')).map(t=>ui(t.targetId))).catch(()=>[]);console.error(error);process.exitCode=1;}
finally{evidence.requests=requests.map(({input,operation,ended,closed})=>({input,operation,ended,closed}));await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2));if(socket?.readyState===WebSocket.OPEN){await cdp('Browser.close',{},undefined,3000).catch(()=>{});socket.close();}child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));console.log('Evidence:',join(output,'result.json'));}
