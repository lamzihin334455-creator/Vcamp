import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const output = resolve(process.env.T02_OUTPUT ?? '../.tmp/t02-real');
const packagePath = resolve(process.env.T02_PACKAGE ?? 'dist');
await mkdir(output, { recursive: true });
await mkdir('.profiles', { recursive: true });
const profile = process.env.T02_PROFILE ?? await mkdtemp(resolve('.profiles/T02-Login-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.VCAMP_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, viewport: null,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--window-size=1280,900']
});
const result = { date: new Date().toISOString(), profile, browser: context.browser().version(), target: process.env.T02_TARGET ?? 'unfixed', build: packagePath, samples: [] };
const smoke = process.argv.includes('--smoke');
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: packagePath });
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  // Assert the source actually running in the installed Worker, not just files in dist.
  const targets = await cdp.send('Target.getTargets');
  const workerTarget = targets.targetInfos.find(target => target.type === 'service_worker' && target.url === `chrome-extension://${id}/assets/background.js`);
  assert.ok(workerTarget, 'Expected installed production Worker');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: workerTarget.targetId, flatten: false });
  const scripts = new Map(), pending = new Map(); let sequence = 0;
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method === 'Debugger.scriptParsed') scripts.set(message.params.url, message.params.scriptId);
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  const send = async (method, params = {}) => {
    const id = ++sequence, response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) });
    return response;
  };
  await send('Debugger.enable');
  result.runtimeHashes = [];
  for (const [url, scriptId] of scripts) {
    if (!url.startsWith(`chrome-extension://${id}/assets/`)) continue;
    const file = new URL(url).pathname.slice(1);
    const { scriptSource } = await send('Debugger.getScriptSource', { scriptId });
    const actual = createHash('sha256').update(scriptSource).digest('hex');
    const expected = createHash('sha256').update(await readFile(resolve(packagePath, file))).digest('hex');
    result.runtimeHashes.push({ file, actual, expected }); assert.equal(actual, expected, `Running script mismatch: ${file}`);
  }
  assert.ok(result.runtimeHashes.some(item => item.file === 'assets/background.js'));
  assert.ok(result.runtimeHashes.some(item => item.file.includes('chrome-video-')));
  await send('Debugger.disable');
  const video = await context.newPage();
  await video.goto(smoke ? 'https://www.bilibili.com/video/BV1pT4y1i72p/' : 'https://www.bilibili.com/video/BV1xx411c7mD/', { waitUntil: 'domcontentloaded' });
  await panel.bringToFront();
  await panel.evaluate(() => {
    const button = document.createElement('button'); button.id = 't02-open-native'; button.textContent = '打开本轮原生侧栏';
    button.onclick = async () => chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
    document.body.append(button);
  });
  await panel.locator('#t02-open-native').click();
  await video.bringToFront();
  result.preflightLogin = await video.evaluate(async () => { try { const json = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })).json(); return { isLogin: json.data?.isLogin === true }; } catch { return { isLogin: null }; } });
  await writeFile(resolve(output, 'launch.json'), JSON.stringify({ profile, id, date: result.date, browser: result.browser }, null, 2));
  console.log(`LOGIN_READY ${profile} ${JSON.stringify({ login: result.preflightLogin, runtimeHashes: result.runtimeHashes.length })}`);
  const alreadyGranted = await panel.evaluate(() => chrome.permissions.contains({ origins: ['https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://aisubtitle.hdslb.com/*'] }));
  if (!process.argv.includes('--no-wait') && !alreadyGranted) {
    // Agent writes this ignored marker only after the user's manual login/permission response.
    while (true) { try { await access(resolve(output, 'continue')); break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); } }
  }
  result.permissions = await panel.evaluate(() => chrome.permissions.getAll());
  result.login = await video.evaluate(async () => { const response = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' }); const json = await response.json(); return { http: response.status, code: json.code, isLogin: json.data?.isLogin === true }; });
  const query = () => panel.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } });
    if (!response.ok) return { error: response.code };
    const view = response.view, cues = view.video?.cues ?? [];
    const bytes = new TextEncoder().encode(JSON.stringify(cues));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return { workspaceId: view.workspaceId, chatId: view.chatId, title: view.title, draftLength: view.draft?.text.length, status: view.video?.status, binding: view.video?.binding, language: view.video?.language, count: cues.length, firstStart: cues[0]?.from, lastEnd: cues.at(-1)?.to, characters: cues.reduce((total, cue) => total + cue.content.length, 0), fingerprint: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('') };
  });
  async function waitResult() {
    let value;
    for (let attempt = 0; attempt < 40; attempt++) {
      value = await query();
      if (value.binding && !['loading', undefined].includes(value.status)) return value;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return value;
  }
  async function reference(binding) {
    const sourceBody = await video.evaluate(async cid => {
      const request = performance.getEntriesByType('resource').map(entry => entry.name).reverse().find(name => { try { const url = new URL(name); return url.origin === 'https://api.bilibili.com' && url.pathname === '/x/player/wbi/v2' && url.searchParams.get('cid') === cid; } catch { return false; } });
      const metadata = await (await fetch(request, { credentials: 'include', cache: 'no-store' })).json();
      const tracks = metadata.data?.subtitle?.subtitles ?? [];
      const track = tracks.find(track => track.lan === 'zh-CN') ?? tracks[0];
      if (!track) return { code: metadata.code, tracks: tracks.length, loginNeeded: metadata.data?.need_login_subtitle };
      return { code: metadata.code, url: track.subtitle_url.startsWith('//') ? `https:${track.subtitle_url}` : track.subtitle_url, language: track.lan };
    }, binding.partId);
    assert.equal(sourceBody.code, 0);
    if (!sourceBody.url) { assert.equal(sourceBody.tracks, 0); assert.ok(!sourceBody.loginNeeded); return { status: 'no-subtitles', count: 0 }; }
    return panel.evaluate(async ({ url, language }) => {
      const json = await (await fetch(url, { cache: 'no-store', credentials: 'omit' })).json();
      const cues = json.body.map(({ from, to, content }) => ({ from, to, content }));
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(cues)));
      return { status: 'ready', language, count: cues.length, firstStart: cues[0]?.from, lastEnd: cues.at(-1)?.to, fingerprint: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('') };
    }, sourceBody);
  }
  async function verifyReference(value) {
    const independent = await reference(value.binding);
    result.samples.push({ name: 'independent-complete-track', partId: value.binding.partId, ...independent });
    assert.equal(independent.status, value.status); assert.equal(independent.count, value.count);
    if (independent.status === 'ready') assert.equal(independent.fingerprint, value.fingerprint);
  }
  async function seekButtons(value, name) {
    const times = await panel.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } });
      return response.view.video.cues.slice(0, 2).map(cue => cue.from);
    });
    assert.equal(times.length, 2);
    await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    for (const [index, paused] of [[0, true], [1, false]]) {
      await video.evaluate(async paused => { const media = document.querySelector('video'); media.currentTime = 60; if (paused) media.pause(); else await media.play(); }, paused);
      const before = await video.evaluate(() => ({ paused: document.querySelector('video').paused, time: document.querySelector('video').currentTime }));
      await panel.locator('.subtitle-time').nth(index).click();
      let after;
      for (let attempt = 0; attempt < 40; attempt++) {
        after = await video.evaluate(() => ({ paused: document.querySelector('video').paused, time: document.querySelector('video').currentTime }));
        if (Math.abs(after.time - times[index]) < 0.75) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      result.samples.push({ name: `${name}-product-seek-${paused ? 'paused' : 'playing'}`, binding: value.binding, targetTime: times[index], before, after, productButton: true });
      assert.equal(after.paused, paused); assert.ok(Math.abs(after.time - times[index]) < 0.75);
      assert.equal(await panel.locator('.native-subtitles [role=alert]').count(), 0);
    }
    await video.evaluate(() => document.querySelector('video').pause());
    await panel.getByRole('navigation').getByRole('button', { name: '问答', exact: true }).click();
  }
  async function seekWithoutSubtitles(value, name) {
    await video.evaluate(() => performance.clearResourceTimings());
    const retained = await query(); assert.deepEqual(retained.binding, value.binding);
    result.samples.push({ name: `${name}-timing-cleared`, status: retained.status, binding: retained.binding });
    for (const paused of [true, false]) {
      await video.evaluate(async paused => { const media = document.querySelector('video'); media.currentTime = 2; if (paused) media.pause(); else await media.play(); }, paused);
      const duration = await video.evaluate(() => document.querySelector('video').duration);
      const time = Math.min(paused ? 30 : 45, duration * (paused ? 0.25 : 0.5));
      const response = await panel.evaluate(async ({ binding, time }) => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'video.seek', binding, time, policy: 'preserve' } }), { binding: retained.binding, time });
      const after = await video.evaluate(() => ({ paused: document.querySelector('video').paused, time: document.querySelector('video').currentTime }));
      result.samples.push({ name: `${name}-public-seek-${paused ? 'paused' : 'playing'}`, time, after, ok: response.ok, code: response.code });
      assert.equal(response.ok, true); assert.equal(after.paused, paused); assert.ok(Math.abs(after.time - time) < 0.75);
    }
    await video.evaluate(() => document.querySelector('video').pause());
  }
  const samples = [['no-subtitles', 'https://www.bilibili.com/video/BV1xx411c7mD/'], ['ordinary', 'https://www.bilibili.com/video/BV1pT4y1i72p/'], ['part2', 'https://www.bilibili.com/video/BV1UR4y1K7Fw/?p=2']];
  for (const [name, url] of samples.filter(([name]) => !smoke || name === 'ordinary')) {
    await video.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await video.bringToFront();
    const value = await waitResult();
    result.samples.push({ name, url, ...value });
    assert.ok(value.binding?.epoch > 1000000000000, 'Installed Worker must use current timestamp-based T02 epochs');
    await verifyReference(value);
    if (name === 'no-subtitles') { assert.equal(value.status, 'no-subtitles'); await seekWithoutSubtitles(value, 'cid62131'); }
    if (name === 'ordinary') {
      assert.equal(value.status, 'ready'); assert.equal(value.count, 88);
      result.decoderIdentity = await video.evaluate(() => {
        const media = window.player?.getVideoMessage?.() ?? window.player?.getManifest?.();
        let decodedCid; try { decodedCid = /^(\d+)-/.exec(new URL(window.player?.getMediaInfo?.().playUrl).pathname.split('/').at(-1))?.[1]; } catch {}
        return { cid: media?.cid, bvid: media?.bvid, decodedCid, elementMatches: window.player?.mediaElement?.() === document.querySelector('video') };
      });
      assert.equal(String(result.decoderIdentity.cid), value.binding.partId);
      await seekButtons(value, 'ordinary');
      await panel.screenshot({ path: resolve(output, 'ordinary-chat.png') });
    }
    if (name === 'part2') {
      assert.equal(value.binding.partId, '585440881');
      const old = value.binding;
      await video.reload({ waitUntil: 'domcontentloaded' });
      const refreshed = await waitResult();
      await verifyReference(refreshed);
      result.samples.push({ name: 'refresh', ...refreshed });
      assert.equal(refreshed.workspaceId, value.workspaceId); assert.notEqual(refreshed.binding.documentId, old.documentId);
      const rejected = await panel.evaluate(async binding => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'video.seek', binding, time: 1, policy: 'preserve' } }), old);
      assert.equal(rejected.code, 'stale-binding');
      result.samples.push({ name: 'old-document-rejected', code: rejected.code });
      const link = video.locator('.video-pod__item').filter({ hasText: '002.安装Python' }).first();
      if (await link.count()) {
        await link.click();
        await video.waitForURL('**/*p=3*');
        result.partSwitch = 'site video-pod SPA control';
      } else throw new Error('Required actual site P3 control unavailable');
      const switched = await waitResult();
      result.samples.push({ name: 'part3', ...switched });
      assert.equal(switched.binding?.partId, '585441682');
      await verifyReference(switched);
      assert.notEqual(switched.binding.partId, refreshed.binding.partId);
      if (result.partSwitch === 'site video-pod SPA control') assert.equal(switched.binding.documentId, refreshed.binding.documentId);
      if (switched.status === 'ready') await seekButtons(switched, 'SPA-P3');
      else await seekWithoutSubtitles(switched, 'SPA-P3');
      await video.goto('https://www.bilibili.com/video/BV1UR4y1K7Fw/?p=3', { waitUntil: 'domcontentloaded' });
      await video.bringToFront();
      const direct = await waitResult(); result.samples.push({ name: 'direct-part3', ...direct });
      assert.equal(direct.binding?.partId, '585441682'); assert.equal(direct.workspaceId, switched.workspaceId);
      assert.notEqual(direct.binding.documentId, switched.binding.documentId);
      await verifyReference(direct);
      if (direct.status === 'ready') await seekButtons(direct, 'direct-P3');
      else await seekWithoutSubtitles(direct, 'direct-P3');
    }
  }
  result.storage = await panel.evaluate(async () => {
    const databases = await indexedDB.databases();
    const request = indexedDB.open('vcamp', 1);
    const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction('workspaces'); const read = tx.objectStore('workspaces').getAll();
    const records = await new Promise(resolve => { read.onsuccess = () => resolve(read.result); }); db.close();
    return { databases: databases.map(db => ({ name: db.name, version: db.version })), records: records.map(record => ({ id: record.id, chatId: record.chatId, fields: Object.keys(record), draftFields: Object.keys(record.draft) })), containsOriginalCues: records.some(record => JSON.stringify(record).includes('"cues"')) };
  });
  assert.equal(result.storage.containsOriginalCues, false);
  result.pass = true;
} catch (error) { result.pass = false; result.error = String(error).split('\n').slice(0, 3).join('\n'); process.exitCode = 1; }
finally { await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2)); await context.close(); }
console.log(JSON.stringify({ pass: result.pass, samples: result.samples.length, error: result.error }));
