// Installed production-path integration, controlled REAL HTTP SSE. Browser-level
// CDP only; attach briefly to panel pages, NEVER executor or Service Worker.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const output = resolve('../.tmp/t19-t21-http-' + Date.now());
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
  assert(target?.url.includes('/sidepanel.html') || target?.url.includes('/reader.html') || target?.url.includes('/tests/installed/management-seed.html'), 'Only panel/reader may be attached');
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  evidence.attachments.push({ url: target.url, type: target.type });
  try { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
  finally { await cdp('Target.detachFromTarget', { sessionId }); }
}
async function panel() { const { targetId } = await cdp('Target.createTarget', { url: `chrome-extension://${extension}/sidepanel.html` }); await until(() => evaluate(targetId, '!!document.querySelector("main")')); return targetId; }
const op = (page, operation) => evaluate(page, `chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:${JSON.stringify(operation)}}).then(r=>{if(!r.ok)throw Error(r.code);return r.view})`);
const ui = page => evaluate(page, '({text:document.body.innerText,draft:document.querySelector("textarea")?.value,enabled:!document.querySelector("button[aria-label=发送]")?.disabled})');
const click = async (page, label) => { await cdp('Target.activateTarget', {targetId:page}); await until(() => evaluate(page, `!![...document.querySelectorAll('button')].find(b=>!b.disabled&&(b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent===${JSON.stringify(label)}))`)); return evaluate(page, `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Missing enabled button');button.click();return true})()`); };
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

async function fixturePage() {
  const { targetId } = await cdp('Target.createTarget', { url: `chrome-extension://${extension}/tests/installed/management-seed.html` });
  await until(() => evaluate(targetId, '!!window.managementProof')); return targetId;
}
async function sendCommand(page, text, outputType = 'chat') {
  const view = await op(page, { type: 'workspace.query' }), target = { kind: 'chat', workspaceId: view.workspaceId, chatId: view.chatId };
  const saved = await op(page, { type: 'draft.save', target: { workspaceId: view.workspaceId, chatId: view.chatId }, expectedRevision: view.draft.revision, draft: { ...view.draft, text, outputType, modelId: 'synthetic-a' } });
  const value = await op(page, { type: 'generation.send', target, expectedRevision: saved.draft.revision, binding: view.video.binding });
  const id = value.generation.messages.find(message => message.role === 'user' && message.text === text).jobId;
  return value.generation.jobs.find(job => job.jobId === id);
}
async function subtitleCommand(page, ws, text) {
  const view = await op(page, { type: 'workspace.query' });
  const before = new Set((await generation(page, { kind: 'subtitle', workspaceId: ws, operation: 'enhance' })).jobs.map(job => job.jobId));
  const value = await op(page, { type: 'generation.subtitle.send', target: { kind: 'subtitle', workspaceId: ws, operation: 'enhance' }, binding: view.video.binding, modelId: 'synthetic-a', requirements: text, targetLanguage: null });
  return value.generation.jobs.find(job => !before.has(job.jobId));
}
const getJob = (fixture, id) => evaluate(fixture, `window.managementProof.getJob(${JSON.stringify(id)})`);
const late = (fixture, job) => evaluate(fixture, `window.managementProof.late(${JSON.stringify(job.jobId)},${JSON.stringify(job.attemptId)})`);
async function saveDraft(page, text) {
  const view = await op(page, { type: 'workspace.query' });
  return op(page, { type: 'draft.save', target: { workspaceId: view.workspaceId, chatId: view.chatId }, expectedRevision: view.draft.revision, draft: { ...view.draft, text } });
}
try {
  await connect(); evidence.browser = await cdp('Browser.getVersion');
  extension = new URL((await until(async () => (await targets()).find(t => t.url.endsWith('/assets/background.js')))).url).host;
  let page = await panel(), fixture = await fixturePage();
  await evaluate(page, `chrome.storage.local.set({'vcamp.provider.v1':{providerId:'deepseek',revision:1,key:'SYNTHETIC_T19_T21_KEY',models:[{id:'synthetic-a',name:'Synthetic A',text:'declared',vision:'unknown',web:'unknown'}],defaultModelId:'synthetic-a',status:'ready'},'vcamp.test.video':${JSON.stringify(source('A'))}})`);
  await stopWorker(); await evaluate(page, 'location.reload()');
  await until(() => evaluate(page, 'document.querySelector("select[aria-label=当前模型]")?.value==="synthetic-a"'));
  const initial = await op(page, { type: 'workspace.query' }), ws = initial.workspaceId, chatTarget = { kind: 'chat', workspaceId: ws, chatId: initial.chatId };
  const parent = { workspaceId: ws, entityType: 'workspace', id: ws }, chatTrash = { workspaceId: ws, entityType: 'chat', id: initial.chatId };
  assert.deepEqual((await op(page, { type: 'library.storage.query' })).library.storage.inventory, { count: 0, bytes: 0, videoCount: 0 });
  const noteJob = await sendCommand(page, 'MAKE_NOTE', 'markdown');
  await final(page, chatTarget, 'completed', 'MAKE_NOTE'); await noExecutors();
  const note = (await op(page, { type: 'artifact.query', workspaceId: ws })).artifacts.artifacts[0];
  const scribble = (await op(page, { type: 'scribble.create', workspaceId: ws, text: '独立随笔留存', time: 3 })).scribbles.scribbles[0];
  const folder = (await op(page, { type: 'library.folder.create', name: '课程' })).library.folders[0];
  await op(page, { type: 'library.favorite.add', folderId: folder.id, target: { workspaceId: ws, entityType: 'markdown', id: note.id } });
  const frozenBefore = (await getJob(fixture, noteJob.jobId)).snapshot;
  const subJob = await subtitleCommand(page, ws, 'HOLD_SUBTITLE');
  const chatJob = await sendCommand(page, 'HOLD_CHAT_DELETE');
  await until(() => requests.some(r => r.input === 'HOLD_SUBTITLE') && requests.some(r => r.input === 'HOLD_CHAT_DELETE'));
  await saveDraft(page, '保留原对话草稿');
  await click(page, '删除对话'); await until(() => evaluate(page, '!!document.querySelector("dialog[open]")'));
  assert((await ui(page)).text.includes('同空间字幕任务继续')); await screenshot(page, 'delete-chat-confirm-360');
  await click(page, '确认移至回收站');
  await until(async () => (await getJob(fixture, chatJob.jobId)).attempts.at(-1).state === 'stopped');
  await until(() => requests.find(r => r.input === 'HOLD_CHAT_DELETE').closed);
  assert.equal((await getJob(fixture, subJob.jobId)).attempts.at(-1).state, 'running');
  assert.equal(requests.find(r => r.input === 'HOLD_SUBTITLE').closed, false);
  assert.equal((await op(page, { type: 'workspace.query' })).chatId, null);
  const retained = (await op(page, { type: 'artifact.query', workspaceId: ws })).artifacts.artifacts[0];
  assert.equal(retained.sourceChatId, initial.chatId); assert.equal(retained.sourceDeleted, true);
  await op(page, { type: 'library.open', target: { workspaceId: ws, entityType: 'markdown', id: note.id }, action: 'reader' });
  const reader = (await until(async () => (await targets()).find(t => t.url.includes('/reader.html?library=1')))).targetId;
  await until(() => evaluate(reader, 'document.body.innerText.includes("来源对话已删除")'));
  assert.equal(await evaluate(reader, 'document.querySelectorAll("textarea").length'), 0);
  const forbidden = await evaluate(reader, `chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'library.trash.restore',target:${JSON.stringify(chatTrash)},expectedRevision:1}})`);
  assert.equal(forbidden.code, 'forbidden');
  await click(page, '资料库'); await click(page, '回收站');
  await until(() => evaluate(page, 'document.querySelector("section[aria-label=回收站]")?.innerText.includes("对话 01")'));
  await screenshot(page, 'trash-360'); await click(page, '恢复');
  await until(async () => (await op(page, { type: 'workspace.query' })).chatId === initial.chatId);
  assert.equal((await op(page, { type: 'workspace.query' })).draft.text, '保留原对话草稿');
  assert.equal((await op(page, { type: 'artifact.query', workspaceId: ws })).artifacts.artifacts[0].sourceDeleted, false);
  requests.find(r => r.input === 'HOLD_SUBTITLE').finish();
  await until(async () => (await getJob(fixture, subJob.jobId)).attempts.at(-1).state === 'completed'); await noExecutors();
  record('running-chat-delete-preserves-artifact-draft-source-and-subtitle-continues', { originalChatId: initial.chatId, restoredSameId: true });

  const version = (await sub(page, ws)).versions[0], versionTarget = { workspaceId: ws, entityType: 'subtitle', id: version.id };
  await op(page, { type: 'subtitles.source.select', workspaceId: ws, expectedRevision: 0, source: { kind: 'enhanced', versionId: version.id } });
  await op(page, { type: 'library.trash.move', target: versionTarget, expectedRevision: 0 });
  assert.equal((await sub(page, ws)).analysisSource.versionId, version.id); assert.equal((await sub(page, ws)).sourceValid, false);
  await op(page, { type: 'library.trash.restore', target: versionTarget, expectedRevision: 1 });
  assert.equal((await sub(page, ws)).sourceValid, true);
  const childTarget = { workspaceId: ws, entityType: 'scribble', id: scribble.id };
  await op(page, { type: 'library.trash.move', target: childTarget, expectedRevision: 0 });
  const wsChat = await sendCommand(page, 'HOLD_WORKSPACE_CHAT'), wsSub = await subtitleCommand(page, ws, 'HOLD_WORKSPACE_SUBTITLE'), queued = await subtitleCommand(page, ws, 'QUEUED_WORKSPACE_SUBTITLE');
  await until(() => requests.some(r => r.input === 'HOLD_WORKSPACE_CHAT') && requests.some(r => r.input === 'HOLD_WORKSPACE_SUBTITLE'));
  assert.equal(queued.state, 'queued'); await saveDraft(page, '重启后仍保留的草稿');
  await click(page, '返回资料库');
  await until(() => evaluate(page, '!!document.querySelector(".library-part")'));
  await evaluate(page, `(()=>{const part=[...document.querySelectorAll('.library-part')].find(p=>p.innerText.includes('A 本地 HTTP 视频'));[...part.querySelectorAll('button')].find(b=>b.textContent==='移至回收站').click();return true})()`);
  await until(() => evaluate(page, '!!document.querySelector("dialog[open]")'));
  await click(page, '确认移至回收站');
  await until(async () => !!(await op(page, { type: 'workspace.query' })).deletedWorkspace);
  for (const job of [wsChat, wsSub, queued]) {
    assert.equal((await getJob(fixture, job.jobId)).attempts.at(-1).state, 'stopped');
    assert.equal((await late(fixture, job)).attempts.at(-1).state, 'stopped');
  }
  await noExecutors();
  assert(!requests.some(r => r.input === 'QUEUED_WORKSPACE_SUBTITLE'));
  assert.equal((await op(page, { type: 'artifact.query', workspaceId: ws })).artifacts.artifacts.length, 0);
  await assert.rejects(() => op(reader, { type: 'workspace.query' }), /not-found/);
  await evaluate(page, 'location.reload()');
  assert((await op(page, { type: 'workspace.query' })).deletedWorkspace);
  await click(page, '资料库'); await click(page, '回收站');
  await until(() => evaluate(page, 'document.querySelector("section[aria-label=回收站]")?.innerText.includes("请先恢复所属工作空间")'));
  await click(page, '恢复'); // only parent is enabled
  await until(async () => (await op(page, { type: 'workspace.query' })).workspaceId === ws);
  for (const job of [wsChat, wsSub, queued]) assert.equal((await late(fixture, job)).attempts.at(-1).state, 'stopped');
  assert.equal((await op(page, { type: 'scribble.query', workspaceId: ws })).scribbles.scribbles.length, 0);
  await op(page, { type: 'library.trash.restore', target: childTarget, expectedRevision: 1 });
  assert.equal((await op(page, { type: 'artifact.query', workspaceId: ws })).artifacts.artifacts[0].id, note.id);
  assert.deepEqual((await getJob(fixture, noteJob.jobId)).snapshot, frozenBefore);
  assert.equal((await op(page, { type: 'library.query', folderId: 'all' })).library.favorites[0].available, true);
  record('workspace-delete-stops-both-kinds-queued-and-late-finish-before-after-restore', { queuedNeverPosted: true, parentChildIndependent: true, noAutomaticPaidRetry: true });

  const seeded = await evaluate(fixture, 'window.managementProof.seedCache()');
  await click(page, '返回资料库'); await click(page, '存储管理'); await click(page, '计算清理预览');
  await until(() => evaluate(page, 'document.querySelector(".storage-preview")?.innerText.includes("311 字节")'));
  await op(page, { type: 'library.favorite.add', folderId: folder.id, target: seeded.target });
  await click(page, '清理这些缓存'); await click(page, '确认清理');
  await until(() => evaluate(page, 'document.querySelector("section[aria-label=存储管理]")?.innerText.includes("预览已过期或数据已变化")'));
  assert.equal((await op(page, { type: 'library.storage.query' })).library.storage.inventory.count, 3);
  await click(page, '重新计算预览');
  await until(() => evaluate(page, 'document.querySelector(".storage-preview")?.innerText.includes("11 字节")'));
  await screenshot(page, 'storage-preview-360');
  await click(page, '清理这些缓存'); await click(page, '确认清理');
  await until(() => evaluate(page, 'document.querySelector("section[aria-label=存储管理]")?.innerText.includes("实际释放 11 字节")'));
  const after = (await op(page, { type: 'library.storage.query' })).library.storage.inventory;
  assert.deepEqual(after, { count: 2, bytes: 300, videoCount: 1 });
  record('test-only-cache-preview-new-concrete-favorite-expires-plan-protects-whole-video-recompute-and-confirm', { fixtureBytes: 311, actualPayloadBytesRemoved: 11, protectedCacheBytes: 300, productionCacheInitiallyZero: true });

  const requestCount = requests.length, previous = endpoint, exited = new Promise(resolve => child.once('exit', resolve));
  await cdp('Browser.close'); socket.close(); await exited; child = startBrowser(); await connect(previous); page = await panel(); fixture = await fixturePage();
  await until(async () => (await op(page, { type: 'workspace.query' })).chatId === initial.chatId);
  assert.equal((await op(page, { type: 'workspace.query' })).draft.text, '重启后仍保留的草稿');
  assert.equal((await op(page, { type: 'artifact.query', workspaceId: ws })).artifacts.artifacts[0].sourceChatId, initial.chatId);
  assert.equal((await op(page, { type: 'scribble.query', workspaceId: ws })).scribbles.scribbles[0].id, scribble.id);
  assert.equal((await sub(page, ws)).versions[0].id, version.id); assert.equal((await sub(page, ws)).analysisSource.versionId, version.id);
  assert.deepEqual((await getJob(fixture, noteJob.jobId)).snapshot, frozenBefore);
  assert.equal((await op(page, { type: 'library.query', folderId: 'all' })).library.favorites.length, 2);
  assert.deepEqual((await op(page, { type: 'library.storage.query' })).library.storage.inventory, after);
  await noExecutors(); assert.equal(requests.length, requestCount);
  record('same-profile-restart-documents-draft-snapshots-favorites-versions-and-identities-retained-no-post'); evidence.pass = true;
} catch (error) {
  evidence.failure = error.stack; evidence.panelStates = await Promise.all((await targets()).filter(t => t.url.includes('/sidepanel.html')).map(t => ui(t.targetId))).catch(() => []);
  console.error(error); process.exitCode = 1;
} finally {
  evidence.requests = requests.map(({ input, operation, ended, closed }) => ({ input, operation, ended, closed }));
  await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  if (socket?.readyState === WebSocket.OPEN) { await cdp('Browser.close', {}, undefined, 3000).catch(() => {}); socket.close(); }
  child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); console.log('Evidence:', join(output, 'result.json'));
}
