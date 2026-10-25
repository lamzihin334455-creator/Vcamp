// Run from extension after fixing TARGET; isolated profile, native permission grant.
// Records only playback numbers / cue counts. No cookie, Key or subtitle body export.
import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const output = resolve('../.tmp/t11-real'), packagePath = resolve('dist');
await mkdir(output, { recursive: true }); await mkdir('.profiles', { recursive: true });
const profile = await mkdtemp(resolve('.profiles/T11-Login-'));
const context = await chromium.launchPersistentContext(profile, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, viewport: null, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--window-size=1280,900'] });
const result = { date: new Date().toISOString(), target: process.env.T11_TARGET, browser: context.browser().version(), profile, pass: false, checks: [] };
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
    const button = document.createElement('button'); button.id = 't11-open'; button.textContent = '打开本轮原生侧栏';
    button.onclick = async () => chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id }); document.body.append(button);
  });
  await panel.locator('#t11-open').click(); await site.bringToFront();
  await writeFile(resolve(output, 'launch.json'), JSON.stringify({ profile, extensionId: id, target: result.target, browser: result.browser }, null, 2));
  console.log(`LOGIN_READY ${profile}`);
  while (true) { try { await access(resolve(output, 'continue')); break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); } }
  result.permission = await panel.evaluate(() => chrome.permissions.contains({ origins: ['https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://aisubtitle.hdslb.com/*'] })); assert.equal(result.permission, true);
  result.login = await site.evaluate(async () => { const json = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })).json(); return json.data?.isLogin === true; });
  const summary = () => panel.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } });
    const video = response.view?.video;
    return { status: video?.status, binding: video?.binding, count: video?.cues.length, times: video?.cues.map(cue => cue.from), tracks: video?.tracks?.map(track => ({ language: track.language, count: track.cues.length, status: track.status })) };
  });
  await expect.poll(async () => (await summary()).status, { timeout: 30000 }).toBe('ready');
  const video = await summary(); result.subtitle = { ...video, times: undefined }; assert.ok(video.count > 5);
  await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
  const timeline = panel.getByLabel('字幕时间轴');
  const setTime = (time, paused) => site.evaluate(async ({ time, paused }) => { const media = document.querySelector('video'); media.currentTime = time; if (paused) media.pause(); else await media.play(); }, { time, paused });
  const rowIndex = Math.min(15, video.count - 2);
  await setTime(video.times[rowIndex] + .1, true);
  await expect(panel.locator('.subtitle-position')).toContainText('暂停');
  await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await timeline.hover(); await panel.mouse.wheel(0, -200); await expect(panel.locator('.subtitle-position')).toContainText('已暂停跟随');
  await panel.waitForTimeout(300); const frozen = await timeline.evaluate(el => el.scrollTop);
  await setTime(video.times[rowIndex + 1] + .1, true); await panel.waitForTimeout(500);
  assert.equal(await timeline.evaluate(el => el.scrollTop), frozen);
  await panel.getByRole('button', { name: '回到当前播放位置' }).click();
  await expect(panel.locator('.subtitle-position')).not.toContainText('已暂停跟随');
  result.checks.push({ type: 'manual-scroll-and-return', pass: true });
  for (const paused of [true, false]) {
    await setTime(video.times[rowIndex] + .1, paused);
    const index = paused ? 5 : 8, target = video.times[index];
    await timeline.locator('.subtitle-time').nth(index).click();
    await expect.poll(() => site.evaluate(target => Math.abs(document.querySelector('video').currentTime - target), target), { timeout: 15000 }).toBeLessThan(1);
    const state = await site.evaluate(() => ({ time: document.querySelector('video').currentTime, paused: document.querySelector('video').paused }));
    assert.equal(state.paused, paused); await expect(panel.locator('.subtitle-position')).toContainText(paused ? '暂停' : '播放中');
    await expect(panel.getByRole('region', { name: '原始字幕' })).toBeVisible();
    result.checks.push({ type: 'product-timestamp-preserve', target, paused, observed: state });
  }
  await panel.getByRole('button', { name: '回到当前播放位置' }).click();
  const before = await timeline.locator('.current').textContent();
  await expect.poll(() => timeline.locator('.current').textContent(), { timeout: 20000 }).not.toBe(before);
  result.checks.push({ type: 'native-playback-events-advance-current-row', pass: true });
  await site.evaluate(() => document.querySelector('video').pause());
  result.nativeMultilingual = video.tracks?.filter(track => track.status === 'ready').length > 1 ? 'available; display covered in installed fixture' : 'not-run: sample has only one readable native language';
  result.pass = true;
} catch (error) { result.error = String(error); throw error; }
finally { await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2)); await context.close(); }
