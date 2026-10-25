// Installed production-path integration, controlled REAL HTTP SSE. Browser-level
// CDP only; attach briefly to panel pages, NEVER executor or Service Worker.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const output = resolve('../.tmp/t06-t07-http-' + Date.now());
await mkdir(output, { recursive: true });
const profile = join(output, 'profile'), extensionPath = resolve('dist-test');
const evidence = { browser: null, stages: [], attachments: [], requests: [], actualModelApiCalls: 0 };
const requests = [];
const frame = (text, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason }] })}\n\n`;
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/chat/completions') { res.writeHead(404).end(); return; }
  let data = ''; for await (const part of req) data += part;
  const body = JSON.parse(data), input = body.messages.at(-1).content.split('\n\n用户主动引用')[0];
  const record = { input, body, chunks: 0, ended: false, closed: false };
  requests.push(record);
  const ordinal = requests.filter(request => request.input === input).length;
  res.on('close', () => { record.closed = true; });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  res.flushHeaders();
  const part = input.includes('停止') ? '停止保留的部分文本' : input.includes('断流') ? '断流保留的部分文本' : input.includes('丢失') ? '标签关闭前的文本' : input.startsWith('笔记') ? '# 可控笔记\n\n' + '长段落用于窄栏查看。'.repeat(45) + '\n\n```js\nconst value = 1;\n```\n\n<script>window.modelScriptRan=true</script>\n\n[危险链接](javascript:alert(1))\n\n[安全链接](https://example.com)\n\n![远程图片](https://example.com/a.png)' : '普通 Chat 回答';
  res.write(frame(part)); record.chunks++;
  const finish = () => { if (res.destroyed) return; res.write(frame('，完整结束', 'stop')); res.end('data: [DONE]\n\n'); record.chunks++; record.ended = true; };
  if (input.includes('停止') && ordinal === 1 || input.includes('丢失')) { /* hold the actual HTTP connection until cancellation */ }
  else if (input.includes('断流') && ordinal === 1) setTimeout(() => { res.end(); record.ended = true; }, 100);
  else setTimeout(finish, 200);
});
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(43105, '127.0.0.1', resolve); });
const child = spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-port=0', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 10000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(100); } throw Error('Condition timed out'); }
let socket, serial = 0, extension;
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
async function panel() { const { targetId } = await cdp('Target.createTarget', { url: `chrome-extension://${extension}/sidepanel.html` }); await until(() => evaluate(targetId, '!!document.querySelector("textarea")')); return targetId; }
const op = (page, operation) => evaluate(page, `chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:${JSON.stringify(operation)}}).then(r=>{if(!r.ok)throw Error(r.code);return r.view})`);
const ui = page => evaluate(page, '({text:document.body.innerText,draft:document.querySelector("textarea")?.value,enabled:!document.querySelector("button[aria-label=发送]")?.disabled})');
const click = (page, label) => evaluate(page, `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Missing enabled button');button.click();return true})()`);
const fill = (page, text) => evaluate(page, `(()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
async function send(page, text) { await fill(page, text); await until(async () => (await ui(page)).enabled); await click(page, '发送'); await until(() => requests.some(request => request.input === text)); }
async function space(page) { const view = await op(page, { type: 'workspace.query' }); return { kind: 'chat', workspaceId: view.workspaceId, chatId: view.chatId }; }
async function generation(page, target) { return (await op(page, { type: 'generation.query', target })).generation; }
async function final(page, target, state, input) { return until(async () => { const view = await generation(page, target); const jobId = view.messages.find(message => message.role === 'user' && message.text === input)?.jobId; return view.jobs.find(job => job.jobId === jobId && job.state === state) && view; }); }
async function noExecutors() { return until(async () => !(await targets()).some(target => target.url.includes('/executor.html#'))); }
async function stopWorker() { const worker = await until(async () => (await targets()).find(target => target.type === 'service_worker' && target.url.includes(extension))); assert.equal(worker.attached, false); await cdp('Target.closeTarget', { targetId: worker.targetId }); await until(async () => !(await targets()).some(target => target.targetId === worker.targetId)); return worker.targetId; }
const source = partId => ({ platform: 'bilibili', videoId: 'BVt05' + partId, partId, title: partId + ' 本地 HTTP 视频' });
async function selectSource(page, partId) { await evaluate(page, `chrome.storage.local.set({'vcamp.test.video':${JSON.stringify(source(partId))}})`); await evaluate(page, 'location.reload()'); await until(async () => (await ui(page)).text.includes(partId + ' 本地 HTTP 视频')); await until(() => evaluate(page, 'document.querySelector("select[aria-label=当前模型]")?.value==="synthetic-a"')); }
function record(name, value = {}) { evidence.stages.push({ name, ...value }); console.log(name, JSON.stringify(value)); }
try {
  const endpoint = await until(async () => { try { const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); return `ws://127.0.0.1:${port}${path}`; } catch { return null; } });
  socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => { const value = JSON.parse(event.data), item = pending.get(value.id); if (!item) return; pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(Error(JSON.stringify(value.error))) : item.resolve(value.result); };
  evidence.browser = await cdp('Browser.getVersion');
  extension = new URL((await until(async () => (await targets()).find(target => target.url.endsWith('/assets/background.js')))).url).host;
  let page = await panel();
  // Synthetic config fixture only. No model-list GET or actual service call.
  await evaluate(page, `chrome.storage.local.set({'vcamp.provider.v1':{providerId:'deepseek',revision:1,key:'SYNTHETIC_T05_KEY',models:[{id:'synthetic-a',name:'Synthetic A',text:'declared',vision:'unknown',web:'unknown'}],defaultModelId:'synthetic-a',status:'ready'},'vcamp.test.video':${JSON.stringify(source('A'))}})`);
  await stopWorker(); await evaluate(page, 'location.reload()');
  await until(() => evaluate(page, 'document.querySelector("select[aria-label=当前模型]")?.value==="synthetic-a"'));
  const a = await space(page);
  await send(page, '普通冒烟'); await final(page, a, 'completed', '普通冒烟'); await noExecutors();
  await click(page, 'Chat'); await click(page, 'Markdown 笔记');
  await send(page, '笔记一'); await final(page, a, 'completed', '笔记一'); await noExecutors();
  assert.equal(await evaluate(page, 'document.querySelector("main").dataset.module'), 'chat');
  const note = (await op(page, {type:'artifact.query',workspaceId:a.workspaceId})).artifacts.artifacts[0];
  assert.equal(note.revision, 1); assert.equal(note.sourceChatId, a.chatId);
  await click(page, '打开笔记');
  await until(() => evaluate(page, 'document.querySelector("main").dataset.module === "markdown"'));
  assert.equal(await evaluate(page, '!!window.modelScriptRan'), false);
  assert.equal(await evaluate(page, 'document.querySelectorAll(".markdown-body script, .markdown-body img, .markdown-body a[href^=javascript]").length'), 0);
  await click(page, '编辑笔记');
  await fill(page, '# 保存版一\n\n用户编辑'); await click(page, '保存笔记');
  await until(async () => (await op(page, {type:'artifact.query',workspaceId:a.workspaceId})).artifacts.artifacts[0].revision === 2);
  await click(page, '编辑笔记'); await fill(page, '# 取消内容'); await click(page, '取消编辑');
  assert.equal((await op(page, {type:'artifact.query',workspaceId:a.workspaceId})).artifacts.artifacts[0].content, '# 保存版一\n\n用户编辑');
  await click(page, '编辑笔记'); await fill(page, '# 脏编辑'); await click(page, '问答');
  await until(() => evaluate(page, '!!document.querySelector("dialog[open]")'));
  await click(page, '取消离开'); assert.equal(await evaluate(page, `document.querySelector('textarea[aria-label="编辑 Markdown"]').value`), '# 脏编辑');
  await click(page, '问答'); await click(page, '放弃修改');
  await until(() => evaluate(page, 'document.querySelector("main").dataset.module === "chat"'));
  await click(page, '打开笔记'); await until(() => evaluate(page, 'document.querySelector("main").dataset.module === "markdown"'));
  const {targetId:reader} = await cdp('Target.createTarget', {url:`chrome-extension://${extension}/reader.html?workspaceId=${encodeURIComponent(a.workspaceId)}&artifactId=${note.id}`});
  await until(() => evaluate(reader, 'document.body?.innerText.includes("只读 · 已保存版本 2")'));
  assert.equal(await evaluate(reader, 'document.querySelectorAll("textarea, [contenteditable=true]").length'), 0);
  const refused = await evaluate(reader, `chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'artifact.save',workspaceId:${JSON.stringify(a.workspaceId)},artifactId:'${note.id}',expectedRevision:2,content:'FORGED'}})`);
  assert.equal(refused.code, 'forbidden');
  record('T06-generate-open-save-cancel-dirty-readonly-safe-render', {revision:2, staysInChat:true, readerWrite:'forbidden'});
  await cdp('Target.closeTarget', {targetId:reader});
  await click(page, '问答'); await until(() => evaluate(page, 'document.querySelector("main").dataset.module === "chat"'));
  await send(page, '笔记二'); await final(page, a, 'completed', '笔记二'); await noExecutors();
  await click(page, '@ 引用笔记');
  await until(() => evaluate(page, 'document.querySelectorAll(".reference-menu input").length === 2'));
  await evaluate(page, '[...document.querySelectorAll(".reference-menu input")].forEach(el=>el.click())');
  await until(() => evaluate(page, 'document.querySelectorAll(".reference-tags button").length === 2'));
  await evaluate(page, 'document.querySelector(".reference-tags button").click()');
  await until(() => evaluate(page, 'document.querySelectorAll(".reference-tags button").length === 1'));
  await evaluate(page, '[...document.querySelectorAll(".reference-menu input")].find(el=>!el.checked).click()');
  await until(() => evaluate(page, 'document.querySelectorAll(".reference-tags button").length === 2'));
  await until(async () => (await ui(page)).text.includes('草稿已保存'));
  await evaluate(page, 'location.reload()');
  await until(() => evaluate(page, 'document.querySelectorAll(".reference-tags button").length === 2'));
  await click(page, '笔记'); await click(page, 'Chat 问答');
  await send(page, '引用停止');
  await until(async () => (await ui(page)).text.includes('停止保留的部分文本'));
  await click(page, '停止生成'); await final(page, a, 'stopped', '引用停止'); await noExecutors();
  const firstRequest = requests.find(request=>request.input==='引用停止').body;
  assert(firstRequest.messages.at(-1).content.includes('# 保存版一'));
  assert(firstRequest.messages.at(-1).content.includes('# 可控笔记'));
  const firstNoteOpen = await evaluate(page, `(()=>{const buttons=[...document.querySelectorAll('.chat-turn button')];buttons[0].click();return true})()`);
  await until(() => evaluate(page, 'document.querySelector("main").dataset.module === "markdown"'));
  await click(page, '编辑笔记'); await fill(page, '# 保存版二\n\n后续修改'); await click(page, '保存笔记');
  await until(async () => (await op(page, {type:'artifact.query',workspaceId:a.workspaceId,artifactId:note.id})).artifacts.artifacts[0].revision === 3);
  await click(page, '问答'); await until(() => evaluate(page, 'document.querySelector("main").dataset.module === "chat"'));
  await click(page, '重试原请求'); await final(page, a, 'completed', '引用停止'); await noExecutors();
  const retried = requests.filter(request=>request.input==='引用停止'); assert.equal(retried.length,2); assert.deepEqual(retried[0].body,retried[1].body);
  assert(!retried[1].body.messages.at(-1).content.includes('# 保存版二'));
  record('T07-multiple-reference-draft-restore-edited-note-old-retry', {references:2, frozenBodyEqual:true, latestNewRevision:3});
  await click(page, '@ 引用笔记');
  await evaluate(page, `(()=>{const labels=[...document.querySelectorAll('.reference-menu label')];labels.find(label=>label.textContent.includes('版本 3')).querySelector('input').click();return true})()`);
  await send(page, '新引用问题'); await final(page, a, 'completed', '新引用问题'); await noExecutors();
  assert(requests.find(request=>request.input==='新引用问题').body.messages.at(-1).content.includes('# 保存版二'));
  record('T07-new-send-latest-saved-revision');
  await click(page, '新对话');
  await until(() => evaluate(page, `document.querySelector('#chat-select').value !== '${a.chatId}'`));
  const b = await space(page);
  await click(page, 'Chat'); await click(page, 'Markdown 笔记');
  await send(page, '笔记B'); await final(page, b, 'completed', '笔记B'); await noExecutors();
  const bNote = (await op(page,{type:'artifact.query',workspaceId:a.workspaceId,sourceChatId:b.chatId})).artifacts.artifacts[0];
  await evaluate(page, `(()=>{const el=document.querySelector('#chat-select');el.value='${a.chatId}';el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await until(() => evaluate(page, `document.querySelector('#chat-select').value === '${a.chatId}'`));
  await click(page, '@ 引用笔记');
  assert.equal(await evaluate(page, 'document.querySelectorAll(".reference-menu input").length'), 2);
  await click(page, '笔记'); await until(() => evaluate(page, 'document.querySelector("main").dataset.module === "markdown"'));
  await evaluate(page, `(()=>{const el=document.querySelector('select[aria-label="已保存笔记"]');el.value='${bNote.id}';el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await until(() => evaluate(page, 'document.querySelector(".note-meta").textContent.includes("对话 02")'));
  await click(page, '问答'); await until(() => evaluate(page, 'document.querySelector("main").dataset.module === "chat"'));
  assert.equal((await space(page)).chatId, a.chatId);
  record('T06-browse-B-stays-A-T07-current-Chat-menu-only', {current:a.chatId, viewed:b.chatId});
  await click(page, '笔记'); await until(() => evaluate(page, 'document.querySelector("main").dataset.module === "markdown"'));
  const {sessionId} = await cdp('Target.attachToTarget',{targetId:page,flatten:true});
  try { await cdp('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:false},sessionId); const screenshot=await cdp('Page.captureScreenshot',{format:'png'},sessionId); await writeFile(join(output,'markdown-360.png'),Buffer.from(screenshot.data,'base64')); }
  finally { await cdp('Target.detachFromTarget',{sessionId}); }
  assert.equal(await evaluate(page, 'document.documentElement.scrollWidth <= 360'), true);
  record('Markdown-long-content-360px');
  await click(page, '编辑笔记'); await fill(page, '# 原空间未保存编辑');
  const originalDraft = (await op(page,{type:'workspace.query'})).draft;
  await evaluate(page, `chrome.storage.local.set({'vcamp.test.video':${JSON.stringify(source('C'))}})`);
  // The binding adapter is pull-only; an ordinary original-target save emits
  // the same invalidation that production video observation would deliver.
  await op(page,{type:'draft.save',target:{workspaceId:a.workspaceId,chatId:a.chatId},expectedRevision:originalDraft.revision,draft:originalDraft});
  await until(() => evaluate(page, '!!document.querySelector("dialog[open]")'));
  await click(page, '取消离开');
  assert.equal(await evaluate(page, `document.querySelector('textarea[aria-label="编辑 Markdown"]').value`), '# 原空间未保存编辑');
  assert.equal(await evaluate(page, 'document.querySelector("main").dataset.module'), 'markdown');
  await click(page, '转到当前视频笔记'); await click(page, '保存并离开');
  await until(async () => (await op(page,{type:'artifact.query',workspaceId:a.workspaceId,artifactId:bNote.id})).artifacts.artifacts[0].content === '# 原空间未保存编辑');
  await until(() => evaluate(page, 'document.body.innerText.includes("暂无笔记")'));
  record('external-video-switch-dirty-cancel-then-save-original-space');
  evidence.pass = true;
} catch (error) { evidence.failure = error.stack; console.error(error); process.exitCode = 1; }
finally {
  evidence.requests = requests.map(request => ({ input: request.input, chunks: request.chunks, ended: request.ended, closed: request.closed, bytes: Buffer.byteLength(JSON.stringify(request.body)), fullSyntheticSubtitleCoverage: request.body.messages.some(message => message.content.includes('首条完整字幕') && message.content.includes('尾条完整字幕')) }));
  await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  if (socket?.readyState === WebSocket.OPEN) { await cdp('Browser.close', {}, undefined, 3000).catch(() => {}); socket.close(); }
  child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  console.log('Evidence:', join(output, 'result.json'));
}
