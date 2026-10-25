// Installed production-path integration, controlled REAL HTTP SSE. Browser-level
// CDP only; attach briefly to panel pages, NEVER executor or Service Worker.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const output = resolve('../.tmp/t09-template-compat-http-' + Date.now());
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


// Narrow repair path: the BASE package is seeded through the public backup API;
// all conversion, re-selection and generation actions below use the installed UI.
try {
 await connect(); evidence.browser = await cdp('Browser.getVersion');
 extension = new URL((await until(async () => (await targets()).find(t => t.url.endsWith('/assets/background.js')))).url).host;
 const page = await panel(), fixture = await readFile(new URL('../fixtures/t09-legacy-custom-backup.json', import.meta.url), 'utf8');
 const original = JSON.parse(fixture).payload, oldTemplate = original.templates[0];
 await until(async () => (await ui(page)).text.includes('草稿已保存'));
 const plan = (await op(page, { type: 'library.backup.preview', file: fixture })).library.backup.plan;
 await op(page, { type: 'library.backup.execute', planId: plan.planId, checksum: plan.checksum });
 await evaluate(page, `chrome.storage.local.set({'vcamp.provider.v1':{providerId:'deepseek',revision:1,key:'SYNTHETIC_T09_COMPAT_KEY',models:[{id:'synthetic-a',name:'Synthetic A',text:'declared',vision:'unknown',web:'unknown'}],defaultModelId:'synthetic-a',status:'ready'},'vcamp.test.video':${JSON.stringify(source('A'))}})`);
 await stopWorker(); await evaluate(page, 'location.reload()');
 await until(() => evaluate(page, 'document.body.innerText.includes("这是旧自由 HTML 模板")'));
 const target = await space(page), before = (await op(page, { type: 'workspace.query' })).draft;
 assert.deepEqual(before, original.workspaces[0].chats[0].draft);
 assert.equal((await ui(page)).enabled, false); await screenshot(page, 'legacy-blocked-360');
 const denied = await evaluate(page, `chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:${JSON.stringify({ type: 'generation.send', target, expectedRevision: before.revision, binding: { platform:'bilibili',videoId:'BVt05A',partId:'A',tabId:99,documentId:'t05-synthetic-document',epoch:1 } })}})`);
 assert.equal(denied.ok, false); assert.equal(denied.code, 'legacy-knowledge');
 assert.equal((await generation(page, target)).jobs.length, 0); assert.equal(requests.length, 0);
 assert.deepEqual((await op(page, { type:'workspace.query' })).draft, before);
 record('BASE old custom template and existing draft: visible recovery, disabled send, public send rejected, no job/HTTP', { code: denied.code });
 await click(page, '打开模板管理'); await click(page, '旧交互页面 · v1 · 旧自由 HTML');
 assert((await ui(page)).text.includes('任意 HTML/CSS/JavaScript 不再支持'));
 await click(page, '转换为交互知识');
 await field(page, '.template-manager textarea', '整理视频的概括、分类、概念关系与问答，区分依据与推断。');
 await evaluate(page, `document.querySelector('.template-manager [role=note]').scrollIntoView()`);
 await screenshot(page, 'conversion-review-360');
 await click(page, '确认转换并保存新版本');
 const latest = await until(async () => (await op(page, { type:'template.query' })).templates.templates.find(t => t.id === oldTemplate.id && t.revision === 2));
 assert.equal(latest.outputProtocol, 'knowledge-json-v1');
 const fixed = (await op(page, { type:'template.query', selected: before.template })).templates.revisions[0];
 assert.deepEqual(fixed, original.templateRevisions[0]);
 assert.deepEqual((await op(page, { type:'workspace.query' })).draft, before);
 await click(page, '关闭');
 await until(() => evaluate(page, 'document.body.innerText.includes("模板已有新版本")'));
 assert.equal((await ui(page)).enabled, false); assert.equal(requests.length, 0);
 await choose(page, '旧交互页面 · v2');
 await until(async () => (await op(page, { type:'workspace.query' })).draft.template?.revisionId === latest.revisionId);
 assert.equal((await op(page, { type:'workspace.query' })).draft.text, before.text);
 await until(async () => (await ui(page)).enabled); await screenshot(page, 'reselected-360');
 await click(page, '发送'); await final(page, target, 'completed', before.text); await noExecutors();
 const artifacts = (await op(page, { type:'knowledge.query', workspaceId:target.workspaceId })).knowledge.artifacts;
 assert.equal(artifacts.length, 1); assert.deepEqual(artifacts[0].document, knowledgeDocument);
 const packet = JSON.parse((await op(page, { type:'library.backup.export' })).library.backup.file);
 const job = packet.payload.jobs[0]; assert.equal(job.snapshot.knowledgeFormat, 1);
 assert.equal(job.snapshot.templateSnapshot.outputProtocol, 'knowledge-json-v1');
 assert.equal(job.snapshot.templateRevisionId, latest.revisionId);
 assert(!JSON.stringify(requests[0].body).includes('自包含 HTML 文件'));
 assert.equal(requests.length, 1);
 record('explicit reviewed conversion → v2 saved → original draft unchanged → manual reselect → complete JSON artifact', { modelRequests:requests.length, actualModelApiCalls:0, revision:latest.revision, oldRevisionUnchanged:true });
 await writeFile(join(output,'compat-backup.json'),JSON.stringify(packet,null,2));
 evidence.pass = true;
} catch(error) { evidence.failure = error.stack; evidence.panelStates = await Promise.all((await targets()).filter(t=>t.url.includes('/sidepanel.html')).map(t=>ui(t.targetId))).catch(()=>[]); console.error(error); process.exitCode = 1; }
finally { evidence.requests=requests.map(({input,operation,ended,closed})=>({input,operation,ended,closed})); await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2)); if(socket?.readyState===WebSocket.OPEN){await cdp('Browser.close',{},undefined,3000).catch(()=>{});socket.close();}child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));console.log('Evidence:',join(output,'result.json')); }
