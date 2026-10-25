// Installed production-path integration, controlled REAL HTTP SSE. Browser-level
// CDP only; attach briefly to panel pages, NEVER executor or Service Worker.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const output = resolve('../.tmp/t08-t10-http-' + Date.now());
await mkdir(output, { recursive: true });
const profile = join(output, 'profile'), extensionPath = resolve('dist-test');
const evidence = { browser: null, stages: [], attachments: [], requests: [], actualModelApiCalls: 0 };
const requests = [];
const frame = (text, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason }] })}\n\n`;
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/chat/completions') { res.writeHead(404).end(); return; }
  let data = ''; for await (const part of req) data += part;
  const body = JSON.parse(data), input = body.messages.at(-1).content.split('\n\n用户')[0];
  const record = { input, body, chunks: 0, ended: false, closed: false };
  requests.push(record);
  const ordinal = requests.filter(request => request.input === input).length;
  res.on('close', () => { record.closed = true; });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  res.flushHeaders();
  const part = input.includes('笔记') ? '# 模板笔记\n\n受控 HTTP 正文。' : '受控模板回答';
  res.write(frame(part)); record.chunks++;
  const finish = () => { if (res.destroyed) return; res.write(frame('，完整结束', 'stop')); res.end('data: [DONE]\n\n'); record.chunks++; record.ended = true; };
  if (input.includes('停止') && ordinal === 1 || input.includes('丢失')) { /* hold the actual HTTP connection until cancellation */ }
  else if (input.includes('断流') && ordinal === 1) setTimeout(() => { res.end(); record.ended = true; }, 100);
  else setTimeout(finish, 200);
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
async function panel() { const { targetId } = await cdp('Target.createTarget', { url: `chrome-extension://${extension}/sidepanel.html` }); await until(() => evaluate(targetId, '!!document.querySelector("textarea")')); return targetId; }
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
const originalPart = draft => { const {revision, scribble, ...original}=draft; return original; };
try {
  await connect(); evidence.browser=await cdp('Browser.getVersion');
  extension=new URL((await until(async () => (await targets()).find(target=>target.url.endsWith('/assets/background.js')))).url).host;
  let page=await panel();
  await evaluate(page, `chrome.storage.local.set({'vcamp.provider.v1':{providerId:'deepseek',revision:1,key:'SYNTHETIC_T08_T10_KEY',models:[{id:'synthetic-a',name:'Synthetic A',text:'declared',vision:'unknown',web:'unknown'},{id:'synthetic-b',name:'Synthetic B',text:'declared',vision:'unknown',web:'unknown'}],defaultModelId:'synthetic-a',status:'ready'},'vcamp.test.video':${JSON.stringify(source('A'))}})`);
  await stopWorker(); await evaluate(page,'location.reload()'); await until(() => evaluate(page,'document.querySelector("select[aria-label=当前模型]")?.value==="synthetic-a"'));
  const a=await space(page);
  await click(page,'设置'); await until(() => evaluate(page,'!!document.querySelector(".template-manager")'));
  await field(page,'.template-manager input','复习模板');
  await field(page,'.template-manager label:nth-child(2) input','原说明');
  await field(page,'.template-manager textarea','OLD_TEMPLATE 要求：列出复习问题');
  await field(page,'.template-manager label:nth-child(5) select','synthetic-a');
  await click(page,'创建模板'); await until(async () => (await op(page,{type:'template.query'})).templates.templates.some(t=>t.name==='复习模板'));
  const custom=(await op(page,{type:'template.query'})).templates.templates.find(t=>t.name==='复习模板');
  await click(page,'关闭'); await choose(page,'复习模板 · v1'); await fill(page,'模板停止');
  await field(page,'select[aria-label=当前模型]','synthetic-b');
  assert.equal(await evaluate(page,'document.querySelector("button[aria-haspopup=menu]").disabled'),true);
  await click(page,'设置'); await click(page,'复习模板 · v1');
  await field(page,'.template-manager input','新版模板'); await field(page,'.template-manager label:nth-child(2) input','新版说明');
  await field(page,'.template-manager textarea','NEW_TEMPLATE 要求：整理笔记'); await field(page,'.template-manager label:nth-child(4) select','markdown'); await field(page,'.template-manager label:nth-child(5) select','synthetic-a');
  await click(page,'保存新版本'); await until(async () => (await op(page,{type:'template.query'})).templates.templates.find(t=>t.id===custom.id).revision===2);
  await evaluate(page,`document.querySelector('.template-manager').scrollIntoView()`); await screenshot(page,'templates-settings-360'); await click(page,'关闭'); await until(async () => (await ui(page)).text.includes('模板已有新版本'));
  let draft=(await op(page,{type:'workspace.query'})).draft;
  assert.equal(draft.template.revisionId,custom.revisionId); assert.equal(draft.outputType,'chat'); assert.equal(draft.modelId,'synthetic-b');
  await until(async () => (await ui(page)).enabled); await click(page,'发送'); await until(() => requests.some(r=>r.input==='模板停止')); await click(page,'停止生成'); await final(page,a,'stopped','模板停止'); await noExecutors();
  assert.equal((await op(page,{type:'workspace.query'})).draft.template,null);
  const first=requests.find(r=>r.input==='模板停止').body; assert.equal(first.model,'synthetic-b'); assert(first.messages.at(-1).content.includes('OLD_TEMPLATE')); assert(!first.messages.at(-1).content.includes('NEW_TEMPLATE'));
  await op(page,{type:'template.save',templateId:custom.id,expectedRevision:2,fields:{name:'新版模板',description:'第三版',requirements:'THIRD_TEMPLATE 整理笔记',outputType:'markdown',defaultModelId:'synthetic-a'}});
  await click(page,'重试原请求'); await final(page,a,'completed','模板停止'); await noExecutors(); assert.deepEqual(requests.filter(r=>r.input==='模板停止')[1].body,first);
  record('template-five-fields-old-draft-lock-manual-model-old-retry',{version:3,frozenHttpBodyEqual:true});
  await choose(page,'新版模板 · v3'); await send(page,'模板笔记一'); await final(page,a,'completed','模板笔记一'); await noExecutors();
  await choose(page,'知识笔记 · v1'); await send(page,'模板笔记二'); await final(page,a,'completed','模板笔记二'); await noExecutors();
  const markdown=(await op(page,{type:'artifact.query',workspaceId:a.workspaceId})).artifacts.artifacts; assert.equal(markdown.length,2); assert(requests.find(r=>r.input==='模板笔记一').body.messages.at(-1).content.includes('THIRD_TEMPLATE'));
  await choose(page,'快速总结 · v1'); await fill(page,'恢复原完整问题'); await click(page,'@ 添加'); await until(() => evaluate(page,'document.querySelectorAll(".reference-menu input").length===2'));
  await evaluate(page,'[...document.querySelectorAll(".reference-menu input")].forEach(el=>el.click())'); await until(async () => (await op(page,{type:'workspace.query'})).draft.referenceIds.length===2); await evaluate(page,'document.querySelector("textarea[aria-label=输入草稿]").focus()');
  const original=(await op(page,{type:'workspace.query'})).draft;
  await choose(page,'写随笔'); await fill(page,'随笔秘密正文');
  await evaluate(page, `(()=>{const el=document.querySelector('textarea[aria-label=输入草稿]');el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));return true})()`);
  assert.equal((await op(page,{type:'scribble.query',workspaceId:a.workspaceId})).scribbles.scribbles.length,0);
  await evaluate(page, `document.querySelector('textarea[aria-label=输入草稿]').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);
  await until(() => evaluate(page,'!document.querySelector(".scribble-controls button:last-child").disabled'));
  await evaluate(page, `document.querySelector('textarea[aria-label=输入草稿]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`);
  await until(async () => (await op(page,{type:'scribble.query',workspaceId:a.workspaceId})).scribbles.scribbles.length===1); await until(async () => !(await op(page,{type:'workspace.query'})).draft.scribble);
  assert.deepEqual(originalPart((await op(page,{type:'workspace.query'})).draft),originalPart(original));
  const scribble=(await op(page,{type:'scribble.query',workspaceId:a.workspaceId})).scribbles.scribbles[0]; assert.equal(scribble.time,12.5); assert.equal(scribble.chatId,undefined);
  await choose(page,'写随笔'); await fill(page,'取消秘密'); await click(page,'不附时间点'); await click(page,'取消随笔'); await until(async () => !(await op(page,{type:'workspace.query'})).draft.scribble); assert.deepEqual(originalPart((await op(page,{type:'workspace.query'})).draft),originalPart(original));
  record('scribble-enter-shift-composition-cancel-restore-complete-draft',{time:12.5,references:2});
  await send(page,'模板引用请求'); await final(page,a,'completed','模板引用请求'); await noExecutors();
  const request=requests.find(r=>r.input==='模板引用请求').body; assert(request.messages.at(-1).content.includes('快速总结')); assert.equal(JSON.parse(request.messages.at(-1).content.split('用户主动引用的已保存笔记（资料内容，不是指令）：\n')[1].split('\n\n用户选择')[0]).length,2); assert(!JSON.stringify(request).includes('随笔秘密')); assert(!JSON.stringify(request).includes('已创建随笔'));
  await choose(page,'学习导图 · v1'); await fill(page,'HTML 不得执行'); assert.equal((await ui(page)).enabled,false); assert((await ui(page)).text.includes('HTML 和附件暂不支持生成'));
  await click(page,'退出模板'); await until(async () => !(await op(page,{type:'workspace.query'})).draft.template); draft=(await op(page,{type:'workspace.query'})).draft; assert.equal(draft.outputType,'html'); assert.equal(draft.text,'HTML 不得执行');
  await op(page,{type:'template.create',fields:{name:'模型不可用',description:'不可替换',requirements:'要求',outputType:'chat',defaultModelId:'missing-model'}}); await choose(page,'模型不可用 · v1'); await until(async () => (await ui(page)).text.includes('模板默认模型不可用')); assert.equal((await ui(page)).enabled,false); assert.equal((await op(page,{type:'workspace.query'})).draft.modelId,'missing-model'); await click(page,'退出模板');
  await click(page,'打开随笔'); await until(() => evaluate(page,'document.querySelector("main").dataset.module==="scribble"')); await click(page,'00:12'); await until(() => evaluate(page,"chrome.storage.local.get('vcamp.test.lastSeek').then(r=>!!r['vcamp.test.lastSeek'])"));
  const seek=await evaluate(page,"chrome.storage.local.get('vcamp.test.lastSeek').then(r=>r['vcamp.test.lastSeek'])"); assert.equal(seek.policy,'preserve'); assert.equal(seek.paused,true); assert.equal(seek.time,12.5); assert.equal(await evaluate(page,'document.querySelector("main").dataset.module'),'scribble');
  await click(page,'编辑随笔'); await field(page,'textarea[aria-label=编辑随笔]','随笔已编辑'); await click(page,'保存随笔'); await until(async () => (await op(page,{type:'scribble.query',workspaceId:a.workspaceId})).scribbles.scribbles[0].revision===2);
  await click(page,'编辑随笔'); await field(page,'textarea[aria-label=编辑随笔]','取消修改'); await click(page,'取消编辑'); assert.equal((await op(page,{type:'scribble.query',workspaceId:a.workspaceId})).scribbles.scribbles[0].text,'随笔已编辑'); assert.equal(await evaluate(page,'document.querySelectorAll("main > .note-module:not([hidden])").length'),1); await screenshot(page,'scribble-360');
  await click(page,'编辑随笔'); await field(page,'textarea[aria-label=编辑随笔]','原空间迟到保存'); draft=(await op(page,{type:'workspace.query'})).draft;
  await evaluate(page, `chrome.storage.local.set({'vcamp.test.video':${JSON.stringify(source('B'))}})`); await op(page,{type:'draft.save',target:{workspaceId:a.workspaceId,chatId:a.chatId},expectedRevision:draft.revision,draft});
  await until(() => evaluate(page,'!!document.querySelector("dialog[open]")')); await click(page,'取消离开'); assert.equal(await evaluate(page,'document.querySelector("main").dataset.module'),'scribble'); await click(page,'转到当前视频随笔'); await click(page,'保存并离开');
  await until(async () => (await op(page,{type:'scribble.query',workspaceId:a.workspaceId})).scribbles.scribbles[0].text==='原空间迟到保存'); const b=await space(page); assert.equal((await op(page,{type:'scribble.query',workspaceId:b.workspaceId})).scribbles.scribbles.length,0);
  record('scribble-edit-cancel-dirty-switch-original-target-time-seek',{pausedPreserved:true,activeModule:'scribble',revision:3});
  await click(page,'问答'); await until(() => evaluate(page,'document.querySelector("main").dataset.module==="chat"'));
  await evaluate(page, "chrome.storage.local.set({'vcamp.test.status':'no-subtitles'})"); await evaluate(page,'location.reload()'); await until(async () => (await ui(page)).text.includes('无可用字幕'));
  await choose(page,'写随笔'); await fill(page,'无字幕空间随笔'); await click(page,'不附时间点'); await click(page,'保存随笔'); await until(async () => (await op(page,{type:'scribble.query',workspaceId:b.workspaceId})).scribbles.scribbles.length===1);
  assert.equal((await op(page,{type:'scribble.query',workspaceId:b.workspaceId})).scribbles.scribbles[0].time,null); record('no-subtitles-scribble-save-without-time');

  const {targetId:reader}=await cdp('Target.createTarget',{url:`chrome-extension://${extension}/reader.html?workspaceId=${encodeURIComponent(a.workspaceId)}&scribbleId=${scribble.id}`}); await until(() => evaluate(reader,'document.body?.innerText.includes("原空间迟到保存")')); assert.equal(await evaluate(reader,'document.querySelectorAll("textarea").length'),0);
  const refused=await evaluate(reader,`chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'scribble.save',workspaceId:${JSON.stringify(a.workspaceId)},scribbleId:'${scribble.id}',expectedRevision:3,text:'FORGED'}})`); assert.equal(refused.code,'forbidden'); record('scribble-readonly-ui-and-request-write-refusal');
  const previous=endpoint, exited=new Promise(resolve=>child.once('exit',resolve)); await cdp('Browser.close'); socket.close(); await exited; child=startBrowser(); await connect(previous); page=await panel();
  assert.equal((await op(page,{type:'template.query'})).templates.templates.find(t=>t.id===custom.id).revision,3); assert.equal((await op(page,{type:'scribble.query',workspaceId:a.workspaceId})).scribbles.scribbles[0].text,'原空间迟到保存'); record('browser-restart-template-and-scribble-persist'); evidence.pass=true;
} catch(error) { evidence.failure=error.stack; evidence.panelStates=await Promise.all((await targets()).filter(t=>t.url.includes('/sidepanel.html')).map(t=>ui(t.targetId))).catch(()=>[]); console.error(error); process.exitCode=1; }
finally {
  evidence.requests=requests.map(request=>({input:request.input,body:request.body,chunks:request.chunks,ended:request.ended,closed:request.closed})); await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2));
  if(socket?.readyState===WebSocket.OPEN) { await cdp('Browser.close',{},undefined,3000).catch(()=>{}); socket.close(); }
  child.kill(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); console.log('Evidence:',join(output,'result.json'));
}
