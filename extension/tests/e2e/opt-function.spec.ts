import {test,expect,chromium} from '@playwright/test';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';

test('local anchor stays in generated document rather than navigating srcdoc',async()=>{
  await mkdir(resolve('../.tmp/opt-function'),{recursive:true});
  const bundle=resolve(process.env.EXPERIENCE_BUNDLE??'dist'),profile=await mkdtemp(resolve('../.tmp/opt-function/profile-'));
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
  try{
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),page=await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    await page.evaluate(()=>{const f=document.createElement('iframe');f.id='probe';f.style.cssText='position:fixed;inset:0;width:400px;height:600px;z-index:99999';f.src='sandbox.html';f.sandbox.add('allow-scripts');f.onload=()=>f.contentWindow!.postMessage({type:'vcamp.html.render',source:'<!doctype html><html><head><title>anchor</title></head><body><a href="#section">页内跳转</a><div style="height:1500px"></div><h2 id="section">目标内容</h2></body></html>',session:'local-session'},'*');document.body.append(f);});
    const content=page.frameLocator('#probe').frameLocator('iframe');
    const navigations:string[]=[];page.on('framenavigated',f=>navigations.push(f.url()));
    await expect(content.getByRole('heading',{name:'目标内容'})).toBeVisible();
    await expect.poll(()=>content.locator('body').evaluate(()=>document.readyState)).toBe('complete');
    await expect(content.getByRole('link',{name:'页内跳转'})).toBeVisible();
    navigations.length=0;
    await content.getByRole('link',{name:'页内跳转'}).click();
    await writeFile(resolve('../.tmp/opt-function/anchor-navigation.json'),JSON.stringify({navigations,frames:page.frames().map(f=>f.url())}));
    await expect(content.getByRole('heading',{name:'目标内容'})).toBeVisible();
    expect(navigations).toEqual([]);await writeFile(resolve('../.tmp/opt-function/anchor-rectangle.json'),JSON.stringify(await content.locator('h2').evaluate(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,height:innerHeight,scroll:scrollY,html:document.documentElement.outerHTML,overflow:getComputedStyle(document.documentElement).overflow,body:getComputedStyle(document.body).overflow,url:location.href}))));
    await expect.poll(()=>content.locator('h2').evaluate(el=>el.getBoundingClientRect().top<innerHeight&&el.getBoundingClientRect().bottom>0&&scrollY>0)).toBe(true);
    await writeFile(resolve('../.tmp/opt-function/anchor.json'),JSON.stringify({passed:true,url:await content.locator('h2').evaluate(()=>location.href)}));
  }finally{await context.close();}
});

for(const browserLanguage of ['zh-CN','en-US']){
test(`production permission lifecycle and cover rendering with controlled site fixtures (${browserLanguage})`,async()=>{
  test.setTimeout(60000);const output=resolve('../.tmp/opt-function',browserLanguage);await mkdir(output,{recursive:true});const metadata=JSON.parse(await readFile(resolve('tests/fixtures/cover-metadata.json'),'utf8')),bundle=resolve(process.env.EXPERIENCE_BUNDLE??'dist'),profile=await mkdtemp(resolve(output,'permissions-'));
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,locale:browserLanguage,viewport:{width:420,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`,`--lang=${browserLanguage}`]});
  try{
    await context.route('https://api.bilibili.com/x/web-interface/view**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data:{aid:1,bvid:metadata.videoId,title:metadata.title,pic:metadata.coverUrl,desc:'受控权限与封面夹具',pages:metadata.pages}})}));
    await context.route(metadata.coverUrl,r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xkAAAAASUVORK5CYII=','base64')}));
    await context.route('https://www.bilibili.com/video/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><video></video><button onclick="history.pushState({},'', '?p=2');fetch('https://api.bilibili.com/x/player/wbi/v2?cid=${metadata.pages[1].cid}')">换 P</button><script>window.__INITIAL_STATE__={videoData:${JSON.stringify({bvid:metadata.videoId,title:metadata.title,pic:metadata.coverUrl,pages:metadata.pages})}};window.player={getVideoMessage:()=>({bvid:${JSON.stringify(metadata.videoId)},cid:Number(new URL(location.href).searchParams.get('p')||1)===1?${metadata.pages[0].cid}:${metadata.pages[1].cid}})};fetch('https://api.bilibili.com/x/player/wbi/v2?cid='+(Number(new URL(location.href).searchParams.get('p')||1)===1?${metadata.pages[0].cid}:${metadata.pages[1].cid}));</script>`}));
    await context.route('https://api.bilibili.com/x/player/**',r=>r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/local.json'}]}}})}));
    await context.route('https://aisubtitle.hdslb.com/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({body:[{from:0,to:5,content:'权限路径本地字幕夹具'}]})}));
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host,panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const site=await context.newPage();await site.goto(`https://www.bilibili.com/video/${metadata.videoId}/?p=1`);await site.bringToFront();
    await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');await expect(panel.getByRole('button',{name:/授权读取/})).toHaveCount(0);
    await panel.reload();await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');await site.getByRole('button',{name:'换 P'}).click();await expect(panel.locator('.context-current-button strong')).toContainText('P2');await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    // Recent videos contain saved material; merely visiting a video is not a save.
    const saved=await panel.evaluate(async()=>{const query=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'workspace.query'}});return chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'scribble.create',workspaceId:query.view.workspaceId,text:'封面与权限验证资料',time:null}});});expect(saved.ok).toBe(true);
    await panel.getByRole('button',{name:'资料库',exact:true}).click();const img=panel.locator('.library-cover img');await expect(img).toHaveCount(1);await expect.poll(()=>img.evaluate((el:HTMLImageElement)=>el.naturalWidth),{timeout:20000}).toBeGreaterThan(0);await expect(img).toHaveAttribute('src',metadata.coverUrl);const naturalWidth=await img.evaluate((el:HTMLImageElement)=>el.naturalWidth);await panel.screenshot({path:resolve(output,'controlled-cover.png')});
    const management=await context.newPage();await management.goto(`chrome://extensions/?id=${id}`);await writeFile(resolve(output,'site-access-ui.txt'),await management.locator('body').ariaSnapshot());
    const automatic=management.getByRole('button',{name:/^(?:自动允许访问以下网站|Automatically allow access on the following sites) /});await expect(automatic).toHaveAccessibleName(browserLanguage==='zh-CN'?/^自动允许访问以下网站 /:/^Automatically allow access on the following sites /);await expect(automatic).toHaveAttribute('aria-pressed','true');await automatic.click();await expect(automatic).toHaveAttribute('aria-pressed','false');const access=management.getByRole('button',{name:'https://www.bilibili.com/*',exact:true});await expect(access).toBeEnabled();
    await site.reload();await site.bringToFront();await panel.getByRole('button',{name:'问答',exact:true}).click();await expect(panel.locator('.context-current-button .sr-only')).toHaveText('浏览器未允许读取 B 站');await expect(panel.getByRole('button',{name:'恢复浏览器站点访问'})).toBeVisible();
    await access.click();await site.reload();await site.bringToFront();await expect(panel.locator('.context-current-button .sr-only')).toHaveText('浏览器未允许访问字幕站点');
    await automatic.click();await site.reload();await site.bringToFront();await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    await writeFile(resolve(output,'permission-cover.json'),JSON.stringify({productionManifest:true,firstOpen:true,reopen:true,sameHostPartSwitch:true,browserUIRevocation:true,subtitleHostRevocation:true,browserUIRestoration:true,cover:{controlledFixture:true,host:new URL(metadata.coverUrl).host,naturalWidth},siteAndSubtitles:'controlled fixtures; cover metadata and image controlled fixtures',modelCalls:0,keyRead:false},null,2));
  }finally{await context.close();}
});
}

test('installed combination: bound time, dynamic anchors, guarded navigation, selection ZIP and portable HTML',async()=>{
  test.setTimeout(60000);
  const output=resolve('../.tmp/opt-function'),bundle=resolve(process.env.EXPERIENCE_TEST_BUNDLE??'dist-test'),profile=await mkdtemp(resolve(output,'combo-')),downloads=resolve(output,'downloads');await mkdir(downloads,{recursive:true});
  await mkdir(resolve(profile,'Default'),{recursive:true});await writeFile(resolve(profile,'Default/Preferences'),JSON.stringify({download:{default_directory:downloads,prompt_for_download:false}}));
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,acceptDownloads:true,downloadsPath:downloads,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
  try{
    await context.route('https://i0.hdslb.com/bfs/archive/fixture.png',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xkAAAAASUVORK5CYII=','base64')}));
    await context.route('https://example.com/reference',r=>r.fulfill({contentType:'text/html',body:'<h1>外部夹具</h1>'}));
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host,page=await context.newPage();
    const downloadSession=await context.newCDPSession(page);await downloadSession.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:true});
    const records=()=>page.evaluate(()=>chrome.downloads.search({orderBy:['-startTime']}));
    await page.goto(`chrome-extension://${id}/tests/installed/opt-function-seed.html`);await expect(page.locator('#status')).toContainText('workspaceId');const fixture=JSON.parse((await page.locator('#status').textContent())!);
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    const op=async(operation:any)=>page.evaluate(async operation=>{const r=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation});if(!r.ok)throw new Error(r.code);return r.view;},operation);
    await page.getByRole('button',{name:'01:00:00',exact:true}).click();await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('vcamp.test.lastSeek'))['vcamp.test.lastSeek']?.time)).toBe(3600);
    await page.getByRole('button',{name:'打开页面',exact:true}).click();
    const content=()=>page.frameLocator('.html-page-frame').frameLocator('iframe');
    await expect(content().getByRole('heading',{name:'导航与来源'})).toBeVisible();await expect(page.getByRole('group',{name:'页面导航确认'})).toHaveCount(0);
    await expect(content().getByRole('link',{name:'01:06:32'})).toBeVisible();await expect(content().getByText(/无效时间 \[00:60\]/)).toBeVisible();
    await content().getByRole('link',{name:'中文锚点'}).click();await expect.poll(()=>content().locator('h2').evaluate(el=>el.getBoundingClientRect().top<innerHeight&&el.getBoundingClientRect().bottom>0&&scrollY>0)).toBe(true);
    await content().getByRole('link',{name:'编码锚点'}).click();await expect(content().locator('h2')).toBeVisible();
    await content().getByRole('button',{name:'添加动态链接'}).click();await content().getByRole('link',{name:'动态锚点'}).click();await expect(content().locator('h2')).toBeVisible();
    await content().getByRole('link',{name:'缺失锚点'}).click();await expect(content().getByRole('status')).toContainText('未找到');
    await content().getByRole('link',{name:'不支持链接'}).click();await expect(content().getByRole('status')).toContainText('暂不支持');
    await worker.evaluate(()=>chrome.storage.local.remove('vcamp.test.lastSeek'));
    await page.evaluate(()=>{(window as any).lastAction=null;window.addEventListener('message',e=>{if(e.data?.type==='vcamp.html.action')(window as any).lastAction=e.data;});});
    await content().getByRole('link',{name:'视频时间'}).click();await expect(page.getByRole('group',{name:'页面导航确认'})).toHaveCount(0);
    await expect.poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('vcamp.test.lastSeek'))['vcamp.test.lastSeek']?.time)).toBe(3600);
    const stale=await page.evaluate(()=>(window as any).lastAction);
    await page.getByRole('button',{name:'初始化',exact:true}).click();await expect(content().getByRole('heading',{name:'导航与来源'})).toBeVisible();await expect(content().getByRole('link',{name:'动态锚点'})).toHaveCount(0);
    await page.evaluate(stale=>{window.dispatchEvent(new MessageEvent('message',{source:document.querySelector<HTMLIFrameElement>('.html-page-frame')!.contentWindow,data:stale}));},stale);
    await expect(page.getByRole('group',{name:'页面导航确认'})).toHaveCount(0);
    const before=context.pages().length;await content().getByRole('link',{name:'外部资料'}).click();await expect(page.getByRole('group',{name:'页面导航确认'})).toBeVisible();expect(context.pages()).toHaveLength(before);
    await page.getByRole('button',{name:'确认打开',exact:true}).click();await expect.poll(()=>context.pages().length).toBe(before+1);await expect(content().getByRole('heading',{name:'导航与来源'})).toBeVisible();
    await page.screenshot({path:resolve(output,'html-navigation.png')});
    // Service export checks real saved latest versions, exact selection and chain.
    const selection=[{target:{workspaceId:fixture.workspaceId,entityType:'markdown',id:fixture.noteId},format:'md'},{target:{workspaceId:fixture.workspaceId,entityType:'html',id:fixture.htmlId},format:'html'},{target:{workspaceId:fixture.workspaceId,entityType:'subtitle',id:fixture.retranslated},format:'srt'},{target:{workspaceId:fixture.workspaceId,entityType:'scribble',id:'*'},format:'txt'}];
    const docs=(await op({type:'library.export',selection})).library.documents;expect(docs.errors).toEqual([]);expect(docs.files).toHaveLength(5);
    expect(docs.files.find((f:any)=>f.name.endsWith('.md')).content).toContain('最新保存版本');const sidecar=docs.files.find((f:any)=>f.name.endsWith('.source.txt'));expect(sidecar.content).toContain('zh-CN');expect(sidecar.content).toContain('en');expect(sidecar.content).toContain('ja');expect(sidecar.content).toContain('字幕修正');
    expect(docs.files.find((f:any)=>f.name.endsWith('.srt')).content).toContain('00:00:01,234 --> 00:00:03,456');expect(JSON.stringify(docs)).not.toContain('不应混入');
    const chatDocs=(await op({type:'library.export',selection:[{target:{workspaceId:fixture.workspaceId,entityType:'chat',id:fixture.chatId},format:'md'}]})).library.documents;expect(chatDocs.errors).toEqual([]);expect(chatDocs.files).toHaveLength(2);const photo=chatDocs.files.find((f:any)=>f.type==='binary');expect(photo.name).toMatch(/\.png$/);const transcript=chatDocs.files.find((f:any)=>f.type==='text');expect(transcript.content).toContain('./'+encodeURIComponent(photo.name));expect(transcript.content).toContain('## 用户');expect(transcript.content).toContain('## 助手');
    // Use the established global export entry and open the real downloaded file.
    await page.getByRole('navigation',{name:'模块导航'}).getByRole('button',{name:'问答',exact:true}).click();await expect(page.getByRole('main',{name:'问答',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'导出',exact:true}).click();const htmlDialog=page.getByRole('dialog');await htmlDialog.getByRole('tab',{name:/^HTML/}).click();await htmlDialog.getByRole('checkbox').check();await htmlDialog.getByRole('radio',{name:'分别下载'}).check();
    await htmlDialog.getByRole('button',{name:'开始导出',exact:true}).click();await expect(htmlDialog.getByRole('status')).toContainText('下载完成');const portablePath=resolve(output,'portable.html');const htmlDownload=(await records()).find(row=>row.filename.endsWith('.html')&&row.state==='complete')!;expect(htmlDownload).toBeTruthy();await writeFile(portablePath,await readFile(htmlDownload.filename));await htmlDialog.getByRole('button',{name:'关闭导出'}).click();
    const portable=await context.newPage();await portable.goto(pathToFileURL(portablePath).href);const portableContent=portable.frameLocator('iframe');await portableContent.getByRole('link',{name:'中文锚点'}).click();await expect(portableContent.locator('#目标')).toBeVisible();await portableContent.getByRole('button',{name:'添加动态链接'}).click();await portableContent.getByRole('link',{name:'动态锚点'}).click();await expect(portableContent.locator('#目标')).toBeVisible();
    await expect(portableContent.getByRole('link',{name:'视频时间'})).toHaveAttribute('href','https://www.bilibili.com/video/BVoptFunction/?p=1&t=3600&autoplay=0');await expect(portableContent.getByRole('link',{name:'01:06:32'})).toHaveAttribute('href','vcamp-time:3992');await portable.close();
    await page.getByRole('button',{name:'资料库',exact:true}).click();await expect(page.locator('.library-cover img')).toHaveCount(1);await expect.poll(()=>page.locator('.library-cover img').evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(0);
    await page.getByRole('navigation',{name:'模块导航'}).getByRole('button',{name:'问答',exact:true}).click();await expect(page.getByRole('main',{name:'问答',exact:true})).toBeVisible();await page.getByRole('button',{name:'导出',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByLabel(/笔记夹具/,{exact:false}).first().check();await dialog.getByRole('tab',{name:/^随笔/}).click();await dialog.getByRole('checkbox',{name:/随笔汇总/}).check();
    await dialog.getByRole('button',{name:'开始导出',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('下载完成');const zipDownload=(await records()).find(row=>row.filename.endsWith('.zip')&&row.state==='complete')!;expect(zipDownload).toBeTruthy();
    const zip=unzipSync(await readFile(zipDownload.filename));expect(Object.keys(zip)).toHaveLength(2);const archiveText=Object.values(zip).map(bytes=>strFromU8(bytes)).join('\n');expect(archiveText).toContain('最新保存版本');expect(archiveText).toContain('较早随笔');expect(archiveText).not.toContain('不应混入');
    await expect(dialog.getByRole('status')).toContainText('下载完成');await page.screenshot({path:resolve(output,'export-selected.png')});
    await writeFile(resolve(output,'combination.json'),JSON.stringify({browser:context.browser()?.version(),chatSeek:3600,anchors:['Chinese','encoded','dynamic','missing'],guard:{loadForgeryRejected:true,staleRejected:true,trustedClickDirectSeek:true,confirmationBeforeExternal:true},files:docs.files.map((f:any)=>f.name),zipEntries:Object.keys(zip),latestNote:true,subtitleChain:true,milliseconds:true,cover:true,portableFileInteractions:true,portableTimeSource:true,modelCalls:0},null,2));
  }finally{await context.close();}
});
