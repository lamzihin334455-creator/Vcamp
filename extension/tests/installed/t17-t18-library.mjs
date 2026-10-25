import { chromium, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const output = resolve('../.tmp/t17-t18-install'); await mkdir(output, { recursive: true });
const bundle = await mkdtemp(join(output, 'package-')), profile = await mkdtemp(join(output, 'profile-'));
await cp(resolve('dist'), bundle, { recursive: true });
// Production app/video/worker bytes are unchanged. Add only the test build's
// semantic fixture page and its hashed dependencies to this isolated package.
await mkdir(join(bundle, 'tests/installed'), { recursive: true });
await cp('dist-test/tests/installed/library-seed.html', join(bundle, 'tests/installed/library-seed.html'));
for (const file of await readdir('dist-test/assets')) if (file === 'librarySeed.js' || /-[\w-]+\.(js|css)$/.test(file)) await cp(join('dist-test/assets', file), join(bundle, 'assets', file));
const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
manifest.host_permissions.push(...manifest.optional_host_permissions); delete manifest.optional_host_permissions;
await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest));
const result = { date: new Date().toISOString(), fixture: 'production bundle + semantic seeder; synthetic video first, real site attempt separately', actualModelApiCalls: 0, checks: [], pass: false, productionHashes: {} };
for (const file of await readdir('dist/assets')) { const original = await readFile(join('dist/assets', file)), installed = await readFile(join(bundle, 'assets', file)); assert.deepEqual(installed, original); result.productionHashes[file] = createHash('sha256').update(original).digest('hex'); }
let context, panel, id;
const launch = async () => {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 360, height: 800 }, args: [`--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); id = new URL(worker.url()).host;
  panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
};
const op = (page, operation) => page.evaluate(async operation => {
  const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation });
  if (!response.ok) throw Error(response.code); return response.view;
}, operation);
const raw = (page, operation) => page.evaluate(operation => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation }), operation);
const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log(name, JSON.stringify(detail)); };
const shot = async (page, name) => { await page.screenshot({ path: join(output, name + '.png'), fullPage: true }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' must fit'); };
const fixtureVideo = async () => {
  const media = (await readFile('tests/fixtures/t02-synthetic.mp4')).toString('base64');
  await context.route('https://www.bilibili.com/video/**', route => { const url = new URL(route.request().url()), bvid = /video\/(BV\w+)/.exec(url.pathname)[1], p = Number(url.searchParams.get('p') ?? 1); return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><video src="data:video/mp4;base64,${media}" autoplay controls></video><script>
  window.__INITIAL_STATE__={videoData:{bvid:${JSON.stringify(bvid)},title:'重复视频标题',pages:${JSON.stringify(bvid === 'BVlibraryB' ? [{page:1,cid:21,part:'单 P'}] : [{page:1,cid:11,part:'私密章节'},{page:2,cid:12,part:'第二章'}])}}};
  window.player={getVideoMessage:()=>({bvid:${JSON.stringify(bvid)},cid:${bvid === 'BVlibraryB' ? 21 : p === 2 ? 12 : 11}})};
  fetch('https://api.bilibili.com/x/player/wbi/v2?cid=${bvid === 'BVlibraryB' ? 21 : p === 2 ? 12 : 11}',{credentials:'include'});
  </script>` }); });
  await context.route('https://api.bilibili.com/**', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }) }));
};
try {
  await launch(); result.browser = context.browser().version();
  const seed = await context.newPage(); await seed.goto(`chrome-extension://${id}/tests/installed/library-seed.html`); await expect(seed.locator('body')).toHaveText('Semantic fixture ready', { timeout: 15000 });
  const data = await seed.evaluate(() => window.fixture); await seed.close();
  await fixtureVideo();
  const site = await context.newPage(); await site.goto('https://www.bilibili.com/video/BVlibraryA/?p=1'); await site.bringToFront();
  await expect.poll(async () => (await op(panel, { type: 'workspace.query' })).workspaceId).toBe(data.a.id);
  const current = await op(panel, { type: 'workspace.query' }); assert.equal(current.chatId, data.second.chatId); assert.equal(current.draft.text, '当前工作台草稿必须保留');
  await panel.getByRole('button', { name: '资料库', exact: true }).click(); await expect(panel.locator('.library-card')).toHaveCount(2);
  await panel.getByRole('textbox', { name: '搜索视频标题' }).fill('私密章节'); await expect(panel.locator('.library-card')).toHaveCount(0);
  await panel.getByRole('textbox', { name: '搜索视频标题' }).fill('BVlibrary'); await expect(panel.locator('.library-card')).toHaveCount(0);
  await panel.getByRole('textbox', { name: '搜索视频标题' }).fill('重复视频标题'); await expect(panel.locator('.library-card')).toHaveCount(2);
  await panel.getByRole('button', { name: '网格', exact: true }).click(); await expect(panel.locator('.library-items.grid')).toBeVisible(); await shot(panel, 'library-grid-360');
  await panel.getByRole('button', { name: '列表', exact: true }).click(); await shot(panel, 'library-list-360');
  const aCard = panel.locator('.library-card').filter({ has: panel.getByRole('button', { name: '选择分 P' }) });
  await aCard.getByRole('button', { name: '选择分 P' }).click(); await expect(aCard.locator('.library-part')).toHaveCount(2);
  check('titles-only-duplicate-video-identity-grid-list-part-menu');
  const spaceTarget = { workspaceId: data.a.id, entityType: 'workspace', id: data.a.id };
  const newReader = async target => { const opened = context.waitForEvent('page'); await op(panel, { type: 'library.open', action: 'reader', target }); const page = await opened; await page.waitForLoadState(); return page; };
  const reader = await newReader(spaceTarget); await expect(reader.getByRole('combobox', { name: '查看资料' })).toHaveValue(data.second.chatId);
  await reader.getByRole('combobox', { name: '查看资料' }).selectOption(data.a.chatId); await expect(reader.locator('.chat-thread')).toContainText('资料库持久问答');
  await reader.getByRole('button', { name: '笔记', exact: true }).click(); await expect(reader.locator('.markdown-body')).toContainText('固定空间的正文');
  await reader.getByRole('button', { name: '打开来源对话' }).click(); await expect(reader.getByRole('combobox', { name: '查看资料' })).toHaveValue(data.a.chatId);
  await reader.getByRole('button', { name: '随笔', exact: true }).click(); await expect(reader.locator('.scribble-body')).toHaveText('资料库持久随笔');
  await reader.getByRole('button', { name: '已保存 AI 字幕', exact: true }).click(); await expect(reader.locator('.subtitle-list')).toContainText('Library saved AI subtitle');
  assert.equal(await reader.locator('textarea,button.subtitle-time').count(), 0); await shot(reader, 'reader-saved-subtitle-360');
  for (const operation of [{type:'library.read',workspaceId:data.p2.id},{type:'artifact.query',workspaceId:data.p2.id,artifactId:data.artifact.id},{type:'artifact.query',workspaceId:data.a.id,artifactId:'foreign'},{type:'chat.select',workspaceId:data.a.id,chatId:data.a.chatId},{type:'library.open',action:'video',target:spaceTarget}]) assert.equal((await raw(reader,operation)).code,'forbidden');
  await site.bringToFront();
  const after = await op(panel, { type:'workspace.query' }); assert.equal(after.chatId, data.second.chatId); assert.deepEqual(after.draft,current.draft);
  check('fixed-reader-chat-md-scribble-saved-subtitle-source-chat-denials-current-draft-intact');
  const specific = await newReader({workspaceId:data.a.id,entityType:'markdown',id:data.artifact.id}); await expect(specific.locator('.markdown-body')).toContainText('固定空间的正文'); await specific.close();
  const emptyReader = await newReader({workspaceId:data.b.id,entityType:'workspace',id:data.b.id}); await expect(emptyReader.getByRole('button',{name:'已保存 AI 字幕',exact:true})).toHaveCount(0); await emptyReader.close();
  check('specific-object-reader-and-no-native-subtitle-entry');
  for (const name of ['课程','复习']) { await panel.getByRole('button',{name:'新建文件夹'}).click(); await panel.getByRole('textbox',{name:'文件夹名称'}).fill(name); await panel.getByRole('button',{name:'保存文件夹'}).click(); await expect(panel.locator('.library-folder-form')).toHaveCount(0); }
  let lib = (await op(panel,{type:'library.query'})).library; const [f1,f2]=lib.folders;
  const noteTarget={workspaceId:data.a.id,entityType:'markdown',id:data.artifact.id};
  await op(panel,{type:'library.favorite.add',folderId:f1.id,target:noteTarget}); await op(panel,{type:'library.favorite.add',folderId:f1.id,target:noteTarget}); await op(panel,{type:'library.favorite.add',folderId:f2.id,target:noteTarget});
  await panel.getByRole('button',{name:'文件夹',exact:true}).click(); await expect(panel.locator('.library-card')).toHaveCount(2); await shot(panel,'folders-360');
  await panel.getByRole('button',{name:f1.name,exact:true}).click(); await panel.getByRole('button',{name:'重命名文件夹'}).click(); await panel.getByRole('textbox',{name:'文件夹名称'}).fill('课程新版'); await panel.getByRole('button',{name:'保存文件夹'}).click(); await expect(panel.getByRole('button',{name:'课程新版',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'移除收藏',exact:true}).click(); await expect(panel.locator('.library-card')).toHaveCount(0);
  await op(panel,{type:'library.favorite.add',folderId:f1.id,target:noteTarget});
  await panel.getByRole('button',{name:'最近',exact:true}).click(); await panel.getByRole('button',{name:'文件夹',exact:true}).click(); await panel.getByRole('button',{name:'课程新版',exact:true}).click(); await panel.getByRole('button',{name:'删除文件夹',exact:true}).click();
  await expect(panel.getByRole('button',{name:'课程新版',exact:true})).toHaveCount(0);
  lib=(await op(panel,{type:'library.query',folderId:'all'})).library; assert.equal(lib.favorites.length,1); assert.equal(lib.favorites[0].folderId,f2.id);
  assert.equal((await op(panel,{type:'artifact.query',workspaceId:data.a.id,artifactId:data.artifact.id})).artifacts.artifacts[0].content,data.artifact.content);
  check('folder-create-rename-multi-relation-dedup-remove-delete-keeps-artifact');
  await panel.getByRole('button',{name:'最近',exact:true}).click();
  // Use the exact stored position observed through VideoPort, not fixture timing.
  await site.locator('video').evaluate(v=>{v.pause();v.currentTime=3});
  await expect.poll(async()=> (await op(panel,{type:'library.query'})).library.videos.find(v=>v.videoId==='BVlibraryA').parts.find(p=>p.partId==='11').position).toBe(3);
  const position=(await op(panel,{type:'library.query'})).library.videos.find(v=>v.videoId==='BVlibraryA').parts.find(p=>p.partId==='11').position;
  const opened=context.waitForEvent('page'); await op(panel,{type:'library.open',action:'video',target:spaceTarget}); const resumed=await opened; await expect(resumed).toHaveURL(/bilibili.com/); await resumed.waitForLoadState();
  const actual=await resumed.locator('video').evaluate(v=>({time:v.currentTime,paused:v.paused})); assert.equal(actual.paused,true); assert(Math.abs(actual.time-position)<.8); assert.equal(new URL(resumed.url()).searchParams.get('p'),'1');
  const openedRef=context.waitForEvent('page'); await op(panel,{type:'library.open',action:'video',target:spaceTarget,time:2}); const referenced=await openedRef; await expect(referenced).toHaveURL(/bilibili.com/); await referenced.waitForLoadState(); const ref=await referenced.locator('video').evaluate(v=>({time:v.currentTime,paused:v.paused})); assert.equal(ref.paused,true); assert(Math.abs(ref.time-2)<.8);
  check('production-videoport-native-media-restore-and-reference-open-paused',{position,actual,reference:ref,syntheticSite:true});
  // Verify the user-facing action restores the intended P, recent Chat and Chat module.
  const partCard=panel.locator('.library-card').filter({has:panel.getByRole('button',{name:'选择分 P'})});
  await partCard.getByRole('button',{name:'选择分 P'}).click();
  const p2Open=context.waitForEvent('page');
  await partCard.locator('.library-part').filter({hasText:'第二章'}).getByRole('button',{name:'打开视频',exact:true}).click();
  const p2Page=await p2Open; await expect(p2Page).toHaveURL(/p=2/);
  await expect(panel.locator('main[data-module=chat]')).toBeVisible({timeout:25000});
  const p2View=await op(panel,{type:'workspace.query'}); assert.equal(p2View.workspaceId,data.p2.id); assert.equal(p2View.chatId,data.p2.chatId); assert.equal(p2View.video.playback.paused,true);
  check('ui-open-part-two-restores-recent-chat-and-chat-module');
  await panel.getByRole('button',{name:'资料库',exact:true}).click(); await panel.getByRole('button',{name:'网格',exact:true}).click();
  await context.close(); await launch();
  await panel.getByRole('button',{name:'资料库',exact:true}).click(); await expect(panel.locator('.library-items.grid')).toBeVisible();
  const restarted=(await op(panel,{type:'library.query',folderId:'all'})).library; assert.equal(restarted.favorites.length,1); assert.equal(restarted.favorites[0].target.id,data.artifact.id);
  const rereader=await newReader(noteTarget); await expect(rereader.locator('.markdown-body')).toContainText('固定空间的正文'); await rereader.close();
  check('same-profile-browser-restart-relations-content-layout-retained');
  // One real page attempt with the unchanged production VideoPort. Do not treat
  // a login/anti-bot/decoder limitation as an installed fixture success.
  await context.unrouteAll({behavior:'wait'});
  const real=await context.newPage(); const url='https://www.bilibili.com/video/BV1pT4y1i72p/';
  try {
    await real.goto(url,{waitUntil:'domcontentloaded',timeout:20000}); await real.bringToFront();
    let observed; const end=Date.now()+20000;
    while(Date.now()<end) { observed=await op(panel,{type:'workspace.query'}); if(observed.video?.binding&&observed.video.playback?.duration)break; await new Promise(resolve=>setTimeout(resolve,500)); }
    if(!observed?.video?.binding||!observed.video.playback?.duration) { result.realSite={url,status:'not-run',reason:'No validated playable binding',observedStatus:observed?.video?.status,pageTitle:await real.title()}; }
    else {
      const target={workspaceId:observed.workspaceId,entityType:'workspace',id:observed.workspaceId};
      await op(panel,{type:'library.open',action:'video',target,time:1});
      result.realSite={url,status:'pass',result:(await op(panel,{type:'workspace.query'})).video?.playback};
      assert.equal(result.realSite.result.paused,true);
    }
  } catch(error) { result.realSite={url,status:'not-run',reason:String(error)}; }
  check('real-site-attempt',result.realSite);
  result.pass=true;
} catch(error) { result.failure=error.stack; result.directSeek=await context.pages().filter(page=>page.url().includes('autoplay=0')).at(-1)?.locator('video').evaluate(async v=>{v.currentTime=2;await new Promise(resolve=>setTimeout(resolve,1000));return {time:v.currentTime,ready:v.readyState,seeking:v.seeking}}).catch(reason=>String(reason)); result.media=await Promise.all(context.pages().filter(page=>page.url().includes('bilibili.com/video')).map(async page=>({url:page.url(),media:await page.locator('video').evaluate(v=>({time:v.currentTime,duration:v.duration,readyState:v.readyState,paused:v.paused,src:v.currentSrc.startsWith('data:')?'synthetic-data-uri':v.currentSrc,error:v.error?.message,seekable:Array.from({length:v.seekable.length},(_,i)=>[v.seekable.start(i),v.seekable.end(i)])})).catch(()=>null)}))); if(panel&&!panel.isClosed()) { result.panelText=await panel.locator('body').innerText().catch(()=>null); await panel.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{}); } console.error(error);process.exitCode=1; }
finally { await context?.close().catch(()=>{}); await writeFile(join(output,'result.json'),JSON.stringify(result,null,2)); console.log('Evidence:',join(output,'result.json')); }
