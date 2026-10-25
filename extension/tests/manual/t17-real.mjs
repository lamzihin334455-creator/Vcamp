import { chromium } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve('../.tmp/t17-real'); await mkdir(output, { recursive: true });
const bundle = await mkdtemp(join(output, 'package-')), profile = await mkdtemp(join(output, 'profile-'));
await cp('dist', bundle, { recursive: true });
const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
manifest.host_permissions.push(...manifest.optional_host_permissions); delete manifest.optional_host_permissions;
await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`] });
const result = { date: new Date().toISOString(), url: 'https://www.bilibili.com/video/BV1pT4y1i72p/', interceptedRequests: 0, actualModelApiCalls: 0, attempts: [], pass: false, browser: context.browser().version() };
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const site = await context.newPage(); await site.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); await site.bringToFront();
  const op = operation => panel.evaluate(async operation => {
    const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation });
    if (!response.ok) throw Error(response.code); return response.view;
  }, operation);
  let view; const end = Date.now() + 25000;
  while (Date.now() < end) {
    try { view = await op({ type: 'workspace.query' }); if (view.video?.binding && view.video.playback?.duration) break; }
    catch (error) { if (!String(error).includes('stale-binding')) throw error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!view?.video?.binding || !view.video.playback?.duration) throw Error('No validated playable real-site binding: ' + view?.video?.status);
  result.original = { workspaceId: view.workspaceId, binding: view.video.binding, playback: view.video.playback };
  const target = { workspaceId: view.workspaceId, entityType: 'workspace', id: view.workspaceId };
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await op({ type: 'library.open', action: 'video', target, time: 1 }); result.attempts.push({ attempt: attempt + 1, status: 'success' }); break; }
    catch (error) { result.attempts.push({ attempt: attempt + 1, status: 'failed', error: String(error) }); if (attempt || !String(error).includes('stale-binding')) throw error; }
  }
  const restored = await op({ type: 'workspace.query' });
  result.restored = { workspaceId: restored.workspaceId, binding: restored.video?.binding, playback: restored.video?.playback };
  assert.equal(restored.workspaceId, view.workspaceId); assert.equal(restored.video.playback.paused, true); assert(Math.abs(restored.video.playback.time - 1) < .75);
  result.pass = true;
} catch (error) { result.notRun = String(error); }
finally { await context.close(); await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); }
