// Installed production-path integration, controlled REAL HTTP SSE. Browser-level
// CDP only; attach briefly to panel pages, NEVER executor or Service Worker.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const output = resolve('../.tmp/t05-http-' + Date.now());
await mkdir(output, { recursive: true });
const profile = join(output, 'profile'), extensionPath = resolve('dist-test');
const evidence = { browser: null, stages: [], attachments: [], requests: [], actualModelApiCalls: 0 };
const requests = []; let releaseA;
const frame = (text, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason }] })}\n\n`;
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/chat/completions') { res.writeHead(404).end(); return; }
  let data = ''; for await (const part of req) data += part;
  const body = JSON.parse(data), input = body.messages.at(-1).content;
  const record = { input, body, chunks: 0, ended: false, closed: false };
  requests.push(record);
  const ordinal = requests.filter(request => request.input === input).length;
  res.on('close', () => { record.closed = true; });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  res.flushHeaders();
  const part = input.includes('停止') ? '停止保留的部分文本' : input.includes('断流') ? '断流保留的部分文本' : input.includes('丢失') ? '标签关闭前的文本' : input.startsWith('A') ? 'A部分回答' : 'B部分回答';
  res.write(frame(part)); record.chunks++;
  const finish = () => { if (res.destroyed) return; res.write(frame('，完整结束', 'stop')); res.end('data: [DONE]\n\n'); record.chunks++; record.ended = true; };
  if (input === 'A问题') releaseA = finish;
  else if (input.includes('停止') && ordinal === 1 || input.includes('丢失')) { /* hold the actual HTTP connection until cancellation */ }
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
  assert(target?.url.includes('/sidepanel.html'), 'Only panel may be attached');
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
  await send(page, 'A问题');
  await until(async () => (await ui(page)).text.includes('A部分回答'));
  await fill(page, 'A下一份草稿'); await until(async () => (await ui(page)).text.includes('草稿已保存'));
  const before = new Set((await targets()).map(target => target.targetId));
  await evaluate(page, 'chrome.windows.getCurrent().then(w=>chrome.sidePanel.open({windowId:w.id}))');
  const native = await until(async () => (await targets()).find(target => !before.has(target.targetId) && target.url.endsWith('/sidepanel.html')));
  await cdp('Target.closeTarget', { targetId: native.targetId }); await cdp('Target.closeTarget', { targetId: page });
  record('A-running-native-panel-closed', { target: a, nativePanel: true });
  page = await panel(); await selectSource(page, 'B'); const b = await space(page);
  await send(page, 'B问题');
  const execution = (await targets()).filter(target => target.type === 'service_worker' || target.url.includes('/executor.html#'));
  assert(execution.every(target => !target.attached));
  assert.equal(requests.length, 2); assert.equal(execution.filter(target => target.url.includes('/executor.html#')).length, 2);
  record('B-independent-concurrent', { target: b, executionsUnattached: true });
  await final(page, b, 'completed', 'B问题');
  await until(async () => (await ui(page)).text.includes('完整结束'));
  await cdp('Target.closeTarget', { targetId: page });
  const stoppedWorker = await stopWorker(); record('worker-stopped-with-A-running', { stoppedWorker });
  releaseA(); await until(() => requests[0].ended); await noExecutors();
  page = await panel(); await selectSource(page, 'A');
  const recovered = await final(page, a, 'completed', 'A问题');
  assert.equal(recovered.messages.length, 2); assert.equal((await ui(page)).draft, 'A下一份草稿'); assert.equal(requests.length, 2);
  record('A-terminal-restored-on-original-Chat', { state: recovered.jobs[0].state, messages: recovered.messages.length, originalDraftPreserved: true, postCount: requests.length });
  assert(requests[0].body.messages[0].content.includes('A 首条完整字幕') && requests[0].body.messages[0].content.includes('A 尾条完整字幕'));
  await send(page, '停止样例'); await until(async () => (await ui(page)).text.includes('停止保留的部分文本'));
  await click(page, '停止生成');
  const stopped = await final(page, a, 'stopped', '停止样例'); await noExecutors();
  assert(stopped.messages.some(message => message.role === 'assistant' && message.text === '停止保留的部分文本' && message.state === 'stopped'));
  await click(page, '重试原请求'); await final(page, a, 'completed', '停止样例'); await noExecutors();
  const stopRequests = requests.filter(request => request.input === '停止样例'); assert.equal(stopRequests.length, 2); assert.deepEqual(stopRequests[0].body, stopRequests[1].body);
  const stopDone = await generation(page, a); assert.equal(stopDone.messages.filter(message => message.role === 'user' && message.text === '停止样例').length, 1);
  record('stop-partial-original-retry-no-duplicate-input', { attempts: 2, frozenBodyEqual: true, retainedPartial: true });
  await send(page, '断流样例'); await final(page, a, 'failed', '断流样例'); await noExecutors();
  record('HTTP-disconnect-explicit-failure');
  await send(page, '丢失样例');
  const lostView = await generation(page, a), lostJob = lostView.jobs.find(job => !['completed', 'stopped', 'failed', 'interrupted'].includes(job.state));
  const lost = await until(async () => (await targets()).find(target => target.url.includes(`/executor.html#${lostJob.jobId}/`)));
  assert.equal(lost.attached, false); await cdp('Target.closeTarget', { targetId: lost.targetId });
  await final(page, a, 'interrupted', '丢失样例'); await noExecutors();
  assert.equal(requests.filter(request => request.input === '丢失样例').length, 1);
  record('manual-executor-close-interrupted-no-auto-retry');
  const dataProof = await evaluate(page, `new Promise((resolve,reject)=>{const open=indexedDB.open('vcamp');open.onsuccess=()=>{const tx=open.result.transaction(['workspaces','jobs'],'readonly'),w=tx.objectStore('workspaces').getAll(),j=tx.objectStore('jobs').getAll();tx.oncomplete=()=>{const raw=JSON.stringify([w.result,j.result]);const answer={version:open.result.version,rawSubtitlesPersisted:raw.includes('首条完整字幕')||raw.includes('尾条完整字幕'),keyPersistedInData:raw.includes('SYNTHETIC_T05_KEY'),workspaces:w.result.length};open.result.close();resolve(answer)}};open.onerror=()=>reject(Error('db'))})`);
  // The harness opens the existing T01 fixture before seeding A/B; that
  // legitimate initial workspace must be preserved as well.
  assert.equal(dataProof.version, 3); assert.equal(dataProof.rawSubtitlesPersisted, false); assert.equal(dataProof.keyPersistedInData, false); assert(dataProof.workspaces >= 2); record('data-privacy-and-v3', dataProof);
  // Screenshot through panel-only CDP, no execution context attachment.
  const { sessionId } = await cdp('Target.attachToTarget', { targetId: page, flatten: true });
  try { await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId); const screenshot = await cdp('Page.captureScreenshot', { format: 'png' }, sessionId); await writeFile(join(output, 'chat-360.png'), Buffer.from(screenshot.data, 'base64')); }
  finally { await cdp('Target.detachFromTarget', { sessionId }); }
  evidence.pass = true;
} catch (error) { evidence.failure = error.stack; console.error(error); process.exitCode = 1; }
finally {
  evidence.requests = requests.map(request => ({ input: request.input, chunks: request.chunks, ended: request.ended, closed: request.closed, bytes: Buffer.byteLength(JSON.stringify(request.body)), fullSyntheticSubtitleCoverage: request.body.messages.some(message => message.content.includes('首条完整字幕') && message.content.includes('尾条完整字幕')) }));
  await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  if (socket?.readyState === WebSocket.OPEN) { await cdp('Browser.close', {}, undefined, 3000).catch(() => {}); socket.close(); }
  child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  console.log('Evidence:', join(output, 'result.json'));
}
