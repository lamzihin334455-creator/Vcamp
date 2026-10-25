// Installed production-path integration, controlled REAL HTTP SSE. Browser-level
// CDP only; attach briefly to panel pages, NEVER executor or Service Worker.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const output = resolve('../.tmp/t12-t13-http-' + Date.now());
await mkdir(output, { recursive: true });
const profile = join(output, 'profile'), extensionPath = resolve('dist-test');
const evidence = { browser: null, stages: [], attachments: [], requests: [], actualModelApiCalls: 0 };
const requests = [];
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
  const result = payload?.cues ? JSON.stringify({ cues: payload.cues.map(cue => ({ ...cue, content: `${payload.operation === 'translate' ? 'TRANSLATED' : 'ENHANCED'} ${cue.index}` })) }) : '# Controlled answer';
  const split = Math.ceil(result.length / 2); res.write(frame(result.slice(0, split)));
  record.finish = () => { if (res.destroyed) return; res.write(frame(result.slice(split), 'stop')); res.end('data: [DONE]\n\n'); record.ended = true; };
  if (!input.includes('HOLD') || requests.filter(r => r.input === input).length > 1) setTimeout(record.finish, 180);
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
const click = async (page, label) => { await until(() => evaluate(page, `!![...document.querySelectorAll('button')].find(b=>!b.disabled&&(b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent===${JSON.stringify(label)}))`)); return evaluate(page, `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Missing enabled button');button.click();return true})()`); };
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
  socket.onmessage = event => { const value = JSON.parse(event.data), item = pending.get(value.id); if (!item) return; pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(Error(JSON.stringify(value.error))) : item.resolve(value.result); };
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

const sub = async (page, workspaceId, versionId) => (await op(page, { type:'subtitles.query', workspaceId, ...(versionId?{versionId}:{}) })).subtitles;
const subtitleTarget = workspaceId => ({ kind:'subtitle', workspaceId, operation:'translate' });
const subtitleState = (page, target, id, state) => until(async () => (await generation(page,target)).jobs.find(j=>j.jobId===id&&j.state===state));
async function subtitleSend(page, operation, requirements) {
  await click(page,'字幕'); await until(()=>evaluate(page,'!!document.querySelector(".subtitle-ai-controls")'));
  await evaluate(page,'document.querySelector(".subtitle-ai-controls details").open=true');
  await until(()=>evaluate(page,'!document.querySelector(".subtitle-ai-controls button").disabled'));
  await field(page,'textarea[aria-label=字幕处理要求]',requirements); await click(page,operation==='translate'?'翻译并保存新版本':'增强并保存新版本');
}
try {
  await connect(); evidence.browser=await cdp('Browser.getVersion');
  extension=new URL((await until(async ()=>(await targets()).find(t=>t.url.endsWith('/assets/background.js')))).url).host;
  let page=await panel();
  await evaluate(page,`chrome.storage.local.set({'vcamp.provider.v1':{providerId:'deepseek',revision:1,key:'SYNTHETIC_T12_T13_KEY',models:[{id:'synthetic-a',name:'Synthetic A',text:'declared',vision:'unknown',web:'unknown'}],defaultModelId:'synthetic-a',status:'ready'},'vcamp.test.video':${JSON.stringify(source('A'))}})`);
  await stopWorker(); await evaluate(page,'location.reload()'); await until(()=>evaluate(page,'document.querySelector("select[aria-label=当前模型]")?.value==="synthetic-a"'));
  const initial=await space(page), ws=initial.workspaceId, target=subtitleTarget(ws);
  // Fixture setup only: the production task paths below have no Chat and may not invent one.
  await evaluate(page,`new Promise((resolve,reject)=>{const open=indexedDB.open('vcamp',5);open.onsuccess=()=>{const tx=open.result.transaction('workspaces','readwrite'), rows=tx.objectStore('workspaces'), r=rows.get(${JSON.stringify(ws)});r.onsuccess=()=>rows.put({...r.result,chats:[],recentChatId:''});tx.oncomplete=()=>{open.result.close();resolve(true)};tx.onabort=reject}})`);
  await evaluate(page,'location.reload()'); await until(async ()=>(await op(page,{type:'workspace.query'})).chatId===null);
  await subtitleSend(page,'translate','HOLD_TRANSLATE'); await until(()=>requests.some(r=>r.input==='HOLD_TRANSLATE'));
  let jobs=(await generation(page,target)).jobs; const first=jobs[0]; assert.equal(first.state,'running'); assert.equal((await op(page,{type:'workspace.query'})).chatId,null);
  assert.equal((await generation(page,target)).messages.length,0);
  await click(page,'新对话'); await click(page,'问答'); await until(()=>evaluate(page,'!!document.querySelector("textarea[aria-label=输入草稿]")'));
  const a=await space(page); await send(page,'HOLD_CHAT');
  await subtitleSend(page,'translate','QUEUED_SUBTITLE'); await until(async ()=>(await generation(page,target)).jobs.length===2);
  jobs=(await generation(page,target)).jobs; const queued=jobs.find(j=>j.jobId!==first.jobId); assert.equal(queued.state,'queued');
  assert.equal((await targets()).filter(t=>t.url.includes('/executor.html#')).length,2);
  await evaluate(page,`document.querySelector('[data-subtitle-job-id="${queued.jobId}"] button').click()`);
  await subtitleState(page,target,queued.jobId,'stopped'); assert(!requests.some(r=>r.input==='QUEUED_SUBTITLE'));
  assert.equal((await generation(page,a)).jobs[0].state,'running'); assert.equal((await generation(page,target)).jobs.find(j=>j.jobId===first.jobId).state,'running');
  requests.find(r=>r.input==='HOLD_TRANSLATE').finish(); requests.find(r=>r.input==='HOLD_CHAT').finish();
  await subtitleState(page,target,first.jobId,'completed'); await final(page,a,'completed','HOLD_CHAT'); await noExecutors();
  let versions=(await sub(page,ws)).versions; assert.equal(versions.length,1); const translated=versions[0]; assert.equal(translated.type,'translate'); assert.equal(translated.cues.length,2);
  await field(page,'select[aria-label=查看字幕版本]',translated.id); await until(()=>evaluate(page,'document.querySelector(".subtitle-list")?.innerText.includes("TRANSLATED 0")'));
  await evaluate(page,'document.querySelector(".subtitle-settings").open=true'); await field(page,'select[aria-label=主语言]','zh');
  await evaluate(page,'[...document.querySelectorAll(".subtitle-settings label")].find(l=>l.textContent.includes("双语显示")).querySelector("input").click()');
  await field(page,'select[aria-label=辅助语言]','saved:'+translated.id); await until(()=>evaluate(page,'document.querySelector(".subtitle-secondary")?.innerText.includes("TRANSLATED 0")'));
  assert.equal((await sub(page,ws)).analysisSource.kind,'native'); record('no-chat-parallel-slots-queued-cancel-bilingual',{versions:1,executorsReleased:true});
  await subtitleSend(page,'enhance','ENHANCE'); await until(async ()=>(await sub(page,ws)).versions.length===2); await noExecutors();
  const enhanced=(await sub(page,ws)).versions.find(v=>v.type==='enhance'); await field(page,'select[aria-label="Chat 分析源"]',enhanced.id); await until(async ()=>(await sub(page,ws)).analysisSource.kind==='enhanced');
  // Saved enhancement supports Chat and Markdown while the original site is unavailable.
  await evaluate(page,"chrome.storage.local.set({'vcamp.test.status':'no-subtitles'})"); await evaluate(page,'location.reload()'); await until(()=>evaluate(page,'document.querySelector("select[aria-label=当前模型]")?.value==="synthetic-a"'));
  await send(page,'ENHANCED_CHAT_ONE'); await final(page,a,'completed','ENHANCED_CHAT_ONE'); await noExecutors();
  await click(page,'新对话'); await until(()=>evaluate(page,'document.querySelector("select[aria-label=当前对话]").options.length===2')); const a2=await space(page); assert.notEqual(a2.chatId,a.chatId);
  await choose(page,'知识笔记 · v1'); await send(page,'ENHANCED_MARKDOWN_TWO'); await final(page,a2,'completed','ENHANCED_MARKDOWN_TWO'); await noExecutors();
  for(const input of ['ENHANCED_CHAT_ONE','ENHANCED_MARKDOWN_TWO']) { const body=JSON.stringify(requests.find(r=>r.input===input).body); assert(body.includes('ENHANCED 0')); assert(!body.includes('首条完整字幕')); }
  assert.equal((await op(page,{type:'artifact.query',workspaceId:ws})).artifacts.artifacts.length,1);
  await send(page,'HOLD_OLD_ENHANCED'); await click(page,'停止生成'); await final(page,a2,'stopped','HOLD_OLD_ENHANCED'); await noExecutors();
  const oldBody=requests.find(r=>r.input==='HOLD_OLD_ENHANCED').body;
  await click(page,'字幕'); await until(()=>evaluate(page,`document.querySelector('select[aria-label="Chat 分析源"]')?.value===${JSON.stringify(enhanced.id)}`)); await field(page,'select[aria-label="Chat 分析源"]','native'); await until(async ()=>(await sub(page,ws)).analysisSource.kind==='native');
  await click(page,'问答'); await click(page,'重试原请求'); await final(page,a2,'completed','HOLD_OLD_ENHANCED'); await noExecutors();
  assert.deepEqual(requests.filter(r=>r.input==='HOLD_OLD_ENHANCED')[1].body,oldBody);
  record('two-chats-enhanced-chat-markdown-native-unavailable-old-retry',{sameHttpBody:true});
  await click(page,'字幕'); await until(()=>evaluate(page,'!!document.querySelector("select[aria-label=查看字幕版本]")')); await until(()=>evaluate(page,`!!document.querySelector('select[aria-label=查看字幕版本] option[value="${translated.id}"]')`)); await field(page,'select[aria-label=查看字幕版本]',translated.id); await until(()=>evaluate(page,'document.querySelector(".subtitle-list")?.innerText.includes("TRANSLATED 0")')); await evaluate(page,'document.querySelector(".subtitle-ai-controls details").open=false'); await screenshot(page,'ai-subtitles-360');
  const bind=(await op(page,{type:'workspace.query'})).video.binding;
  await selectSource(page,'B'); const b=await space(page); assert.equal((await sub(page,b.workspaceId)).versions.length,0);
  await assert.rejects(()=>op(page,{type:'subtitles.source.select',workspaceId:b.workspaceId,expectedRevision:0,source:{kind:'enhanced',versionId:enhanced.id}}),/source-changed/);
  record('cross-space-selection-refused');
  const previous=endpoint, exited=new Promise(resolve=>child.once('exit',resolve)); await cdp('Browser.close'); socket.close(); await exited; child=startBrowser(); await connect(previous); page=await panel();
  assert.equal((await sub(page,ws)).versions.length,2);
  const {targetId:reader}=await cdp('Target.createTarget',{url:`chrome-extension://${extension}/reader.html?workspaceId=${encodeURIComponent(ws)}&subtitleVersionId=${translated.id}`});
  await until(()=>evaluate(reader,'document.body?.innerText.includes("TRANSLATED 0")'));
  assert.equal(await evaluate(reader,'document.querySelectorAll("textarea,select,button.subtitle-time").length'),0);
  const read=await op(reader,{type:'workspace.query'}); assert.equal(read.video,undefined); assert.equal(read.chatId,null);
  for(const operation of [{type:'subtitles.source.select',workspaceId:ws,expectedRevision:1,source:{kind:'native'}},{type:'generation.subtitle.send',target,binding:bind,modelId:'synthetic-a',requirements:'FORGED',targetLanguage:'en'},{type:'video.seek',binding:bind,time:0,policy:'preserve'},{type:'subtitles.query',workspaceId:b.workspaceId,versionId:translated.id}]) {
    const result=await evaluate(reader,`chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:${JSON.stringify(operation)}})`); assert.equal(result.code,'forbidden');
  }
  record('same-profile-reopen-saved-reader-no-video-no-writes-no-seek'); evidence.pass=true;
} catch(error) { evidence.failure=error.stack; evidence.panelStates=await Promise.all((await targets()).filter(t=>t.url.includes('/sidepanel.html')).map(t=>ui(t.targetId))).catch(()=>[]); console.error(error); process.exitCode=1; }
finally {
  evidence.requests=requests.map(({input,operation,ended,closed})=>({input,operation,ended,closed})); await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2));
  if(socket?.readyState===WebSocket.OPEN) { await cdp('Browser.close',{},undefined,3000).catch(()=>{}); socket.close(); }
  child.kill(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); console.log('Evidence:',join(output,'result.json'));
}
