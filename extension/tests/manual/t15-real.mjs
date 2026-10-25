// Run from extension after fixing TARGET; isolated profile, native permission grant.
// Records only playback numbers / cue counts. No cookie, Key or subtitle body export.
import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const output = resolve('../.tmp/t15-real'), packagePath = resolve('dist');
await mkdir(output, { recursive: true }); await mkdir('.profiles', { recursive: true });
const profile = await mkdtemp(resolve('.profiles/T15-Login-'));
const context = await chromium.launchPersistentContext(profile, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, viewport: null, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--window-size=1280,900'] });
const result = { date: new Date().toISOString(), target: process.env.T15_TARGET, browser: context.browser().version(), profile, pass: false, checks: [] };
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: packagePath });
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const worker = targetInfos.find(target => target.type === 'service_worker' && target.url === `chrome-extension://${id}/assets/background.js`); assert.ok(worker);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: worker.targetId, flatten: false });
  const scripts = new Map(), pending = new Map(); let seq = 0;
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method === 'Debugger.scriptParsed') scripts.set(message.params.url, message.params.scriptId);
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  const send = async (method, params = {}) => {
    const id = ++seq, response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); return response;
  };
  await send('Debugger.enable'); result.runtimeHashes = [];
  for (const [url, scriptId] of scripts) {
    if (!url.startsWith(`chrome-extension://${id}/assets/`)) continue;
    const file = new URL(url).pathname.slice(1), { scriptSource } = await send('Debugger.getScriptSource', { scriptId });
    const actual = createHash('sha256').update(scriptSource).digest('hex'), expected = createHash('sha256').update(await readFile(resolve(packagePath, file))).digest('hex');
    result.runtimeHashes.push({ file, actual, expected }); assert.equal(actual, expected);
  }
  assert.ok(result.runtimeHashes.some(item => item.file === 'assets/background.js')); await send('Debugger.disable');
  const site = await context.newPage();
  result.url = 'https://www.bilibili.com/video/BV1pT4y1i72p/';
  await site.goto(result.url, { waitUntil: 'domcontentloaded' });
  await panel.evaluate(() => {
    const button = document.createElement('button'); button.id = 't15-open'; button.textContent = '打开本轮原生侧栏';
    button.onclick = async () => chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id }); document.body.append(button);
  });
  await panel.locator('#t15-open').click(); await site.bringToFront();
  await writeFile(resolve(output, 'launch.json'), JSON.stringify({ profile, extensionId: id, target: result.target, browser: result.browser }, null, 2));
  console.log(`PERMISSION_READY ${profile}`);
  await expect.poll(()=>panel.evaluate(()=>chrome.permissions.contains({origins:['https://www.bilibili.com/*','https://api.bilibili.com/*','https://aisubtitle.hdslb.com/*']})),{timeout:600000}).toBe(true);
  const query=()=>panel.evaluate(async()=>{const r=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation:{type:'workspace.query'}});if(!r.ok)throw Error(r.code);return r.view;});
  await expect.poll(async()=>(await query()).video?.binding,{timeout:30000}).toBeTruthy();
  await expect.poll(()=>site.evaluate(()=>document.querySelector('video')?.readyState??0),{timeout:30000}).toBeGreaterThanOrEqual(2);
  for(const paused of [true,false]){
    await site.evaluate(async paused=>{const v=document.querySelector('video');if(paused)v.pause();else await v.play();},paused);
    const original=await query();
    await panel.getByRole('button',{name:'添加当前帧截图'}).click();
    await site.evaluate(()=>{const v=document.querySelector('video');window.t15Events=[];for(const type of ['seeking','pause','play'])v.addEventListener(type,()=>window.t15Events.push(type));});
    const before=await site.evaluate(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,src:v.currentSrc};});
    await panel.getByRole('button',{name:'同意本次截图及发送范围'}).click();await expect(panel.locator('.capture-dialog')).toHaveCount(0,{timeout:15000});
    const after=await site.evaluate(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,src:v.currentSrc,events:window.t15Events};});
    const saved=await query(),ids=saved.draft.attachmentIds;
    const image=await panel.evaluate(async({target,ids})=>{const r=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'attachment.read',target,ids}});if(!r.ok)throw Error(r.code);return r.view.attachment.images.at(-1);},{target:{workspaceId:saved.workspaceId,chatId:saved.chatId},ids});
    assert.equal(after.paused,paused);assert.equal(after.src,before.src);assert.deepEqual(after.events,[]);
    if(paused)assert.ok(Math.abs(after.time-before.time)<0.02);else assert.ok(after.time>=before.time);
    assert.equal(image.source.videoId,original.video.binding.videoId);assert.equal(image.source.partId,original.video.binding.partId);assert.ok(image.time>=before.time-.05&&image.time<=after.time+.05);
    const decoded=await panel.evaluate(async data=>{const img=new Image();img.src=data;await img.decode();return {width:img.naturalWidth,height:img.naturalHeight};},image.dataUrl);
    assert.deepEqual(decoded,{width:image.width,height:image.height});
    await writeFile(resolve(output,paused?'paused.png':'playing.png'),Buffer.from(image.dataUrl.slice(22),'base64'));
    result.checks.push({type:'current-frame',paused,before:{time:before.time,paused:before.paused},after:{time:after.time,paused:after.paused,events:after.events},source:image.source,time:image.time,width:image.width,height:image.height,bytes:image.bytes,sha256:image.sha256});
  }
  await panel.setViewportSize({width:360,height:800});await panel.screenshot({path:resolve(output,'draft-360.png')});
  result.realModelCalls=0;result.pass=true;
} catch(error){result.error=String(error);throw error;}
finally{await writeFile(resolve(output,'results.json'),JSON.stringify(result,null,2));await context.close();}
