import {test,expect,chromium} from '@playwright/test';
import {cp,mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {unzipSync,strFromU8} from 'fflate';

const output=resolve('../.tmp/opt-experience');
async function setup(){
  await mkdir(output,{recursive:true});
  const bundle=await mkdtemp(resolve(output,'bundle-'));await cp(process.env.EXPERIENCE_BUNDLE??resolve('dist'),bundle,{recursive:true});
  // Only add a fixture entry. All product bundles and the manifest are the production build.
  await build({entryPoints:['tests/installed/experience-seed.ts'],bundle:true,format:'iife',outfile:resolve(bundle,'seed.js')});
  await build({entryPoints:['tests/installed/html-compat-seed.ts'],bundle:true,format:'iife',outfile:resolve(bundle,'html-seed.js')});
  await writeFile(resolve(bundle,'html-seed.html'),'<div id="status"></div><script src="html-seed.js"></script>');
  await writeFile(resolve(bundle,'seed.html'),'<div id="status"></div><script src="seed.js"></script>');
  const profile=await mkdtemp(resolve(output,'profile-')),downloads=await mkdtemp(resolve(output,'downloads-'));
  await mkdir(resolve(profile,'Default'),{recursive:true});await writeFile(resolve(profile,'Default/Preferences'),JSON.stringify({download:{default_directory:downloads,prompt_for_download:false}}));
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,acceptDownloads:true,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`,'--autoplay-policy=no-user-gesture-required']});
  const mediaUrl='data:video/mp4;base64,'+(await readFile('tests/fixtures/t02-synthetic.mp4')).toString('base64');
  const forbidden:string[]=[];
  await context.route('**/*',async r=>{
    const u=r.request().url();
    if(u.startsWith('https://api.bilibili.com/x/web-interface/view'))return r.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data:{aid:1,bvid:'BVexperience',title:'体验修复本地夹具',desc:'本地验收资料',pages:[{page:1,cid:11,part:'第一部分'},{page:2,cid:12,part:'第二部分'}]}})});
    if(u.startsWith('https://www.bilibili.com/video/'))return r.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><video src="${mediaUrl}" controls></video><script>window.__INITIAL_STATE__={videoData:{bvid:'BVexperience',title:'体验修复本地夹具',pages:[{page:1,cid:11,part:'第一部分'},{page:2,cid:12,part:'第二部分'}]}};window.player={getVideoMessage:()=>({bvid:'BVexperience',cid:Number(new URL(location.href).searchParams.get('p')||1)===1?11:12})};fetch('https://api.bilibili.com/x/player/wbi/v2?cid='+(Number(new URL(location.href).searchParams.get('p')||1)===1?11:12));</script>`});
    if(u.startsWith('https://api.bilibili.com/x/player/'))return r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/local.json'}]}}})});
    if(u.startsWith('https://aisubtitle.hdslb.com/'))return r.fulfill({contentType:'application/json',body:JSON.stringify({body:[{from:1.234,to:3.456,content:'站点字幕本体'}]})});
    if(/^https?:/.test(u)){forbidden.push(u);return r.abort();}return r.continue();
  });
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host,page=await context.newPage();
  const downloadSession=await context.newCDPSession(page);await downloadSession.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:true});
  await page.goto(`chrome-extension://${id}/seed.html`);await expect(page.locator('#status')).toContainText('workspaceId');const fixture=JSON.parse((await page.locator('#status').textContent())!);
  await page.goto(`chrome-extension://${id}/sidepanel.html`);const site=await context.newPage();await site.goto('https://www.bilibili.com/video/BVexperience/?p=1');await site.bringToFront();
  await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
  await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>({ready:v.readyState,duration:v.duration,seekable:v.seekable.length}))).toMatchObject({seekable:1});
  await page.evaluate(()=>{const original=chrome.runtime.sendMessage.bind(chrome.runtime);(window as any).locateLog=[];chrome.runtime.sendMessage=(async(message:any)=>{const response=await original(message);if(['library.locate','library.export'].includes(message.operation?.type))(window as any).locateLog.push({operation:message.operation,ok:response.ok,code:response.code,files:response.view?.library?.documents?.files.map((f:any)=>f.name)});return response;}) as any;});
  await writeFile(resolve(output,'native-control.json'),JSON.stringify(await site.locator('video').evaluate(async(v:HTMLVideoElement)=>{
    await new Promise<void>((done,reject)=>{
      if(!v.seeking&&Math.abs(v.currentTime-0.5)<0.001){done();return;}
      const timer=setTimeout(()=>reject(new Error('fixture video seek timeout')),5000);
      v.addEventListener('seeked',()=>{clearTimeout(timer);done();},{once:true});
      v.currentTime=0.5;
    });
    return {time:v.currentTime,duration:v.duration};
  })));
  return {context,page,site,fixture,forbidden,id,worker};
}

test('notes and scribbles click through production binding to native currentTime',async()=>{
  test.setTimeout(60000);const {context,page,site,fixture,id,worker}=await setup();
  try{
    await page.getByRole('button',{name:'打开笔记',exact:true}).first().click();
    const note=page.locator('.markdown-workbench').filter({visible:true});
    await expect(note.getByRole('heading',{name:/阅读与定位/})).toBeVisible();
    for(const [label,seconds] of [['00:01',1],['00:02',2],['现有链接',3.25]] as const){
      await note.getByRole('button',{name:label,exact:true}).click();
      await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(seconds,1);
      expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
    }
    await page.getByRole('button',{name:'随笔',exact:true}).click();await page.getByRole('button',{name:'00:05',exact:true}).click();
    await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(5.25,1);
    await page.getByRole('button',{name:'问答',exact:true}).click();await page.getByRole('button',{name:'00:01',exact:true}).click();
    await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(1,1);
    await page.getByRole('button',{name:'笔记',exact:true}).click();
    await note.getByRole('button',{name:'00:04',exact:true}).click({timeout:5000});await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(4,1);
    await site.locator('video').evaluate((v:HTMLVideoElement)=>v.play());await note.getByRole('button',{name:'00:02',exact:true}).click();await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>!v.paused&&v.currentTime>=2&&v.currentTime<3)).toBe(true);await site.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
    await expect(note.locator('table')).toHaveCount(1);await expect(note.getByRole('region',{name:'笔记来源截图'}).getByRole('img')).toBeVisible();expect(await note.locator('h1').count()).toBe(1);expect(await note.locator('strong').filter({hasText:'关键解释'}).count()).toBe(1);await expect(note.locator('pre')).toContainText('[00:05]');
    await page.screenshot({path:resolve(output,'note-reading.png')});
    await page.setViewportSize({width:320,height:850});await page.screenshot({path:resolve(output,'note-reading-320.png')});expect(await note.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    // A wrapped historical note is rendered without changing its stored text.
    await page.getByRole('button',{name:'问答',exact:true}).click();await page.getByRole('button',{name:'打开笔记',exact:true}).nth(1).click();await expect(note.getByRole('heading',{name:'包装笔记',exact:true})).toBeVisible();await note.getByRole('button',{name:'00:02',exact:true}).click();await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(2,1);
    await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByLabel('编辑 Markdown')).toHaveValue(/^```markdown/);await page.getByLabel('编辑 Markdown').fill('保留的未保存编辑');
    // Retained old-P scribble remains clickable and opens its own source. The
    // currently playing P2 must never receive the old source's timestamp.
    await page.getByRole('button',{name:'随笔',exact:true}).click();const leave=page.getByRole('dialog');await leave.getByRole('button',{name:'取消离开'}).click();await expect(page.getByLabel('编辑 Markdown')).toHaveValue('保留的未保存编辑');
    await page.getByRole('button',{name:'取消编辑',exact:true}).click();await page.getByRole('button',{name:'随笔',exact:true}).click();await page.getByRole('button',{name:'编辑随笔',exact:true}).first().click();await page.getByLabel('编辑随笔').fill('保留随笔编辑');
    await site.goto('https://www.bilibili.com/video/BVexperience/?p=2');await site.bringToFront();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'取消离开'}).click();
    await expect(page.getByLabel('编辑随笔')).toHaveValue('保留随笔编辑');await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBe(true);
    const opened=context.waitForEvent('page');await page.getByRole('button',{name:'00:05',exact:true}).click();const original=await opened;await original.waitForURL('https://www.bilibili.com/video/BVexperience/?p=1&autoplay=0');await expect.poll(()=>original.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(5.25,1);expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(0);
    await expect(page.getByLabel('编辑随笔')).toHaveValue('保留随笔编辑');
    await writeFile(resolve(output,'seek-result.json'),JSON.stringify({productionVideo:true,fixtureMedia:true,note:true,wrappedNote:true,scribble:true,chatSmoke:true,playingAndPausedPreserved:true,wrongPartOpenedSource:true,wrongPartUnchanged:true,unsavedEditsPreserved:true,modelCalls:0}));
  }finally{await writeFile(resolve(output,'media.json'),JSON.stringify(await site.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,duration:v.duration,ready:v.readyState,error:v.error?.message}))));await writeFile(resolve(output,'last-ui.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));await writeFile(resolve(output,'last-locate.json'),JSON.stringify(await page.evaluate(()=>(window as any).locateLog).catch(()=>[])));await context.close();}
});

test('global export retains category choices and downloads actual SRT and mixed ZIP',async()=>{
  test.setTimeout(60000);const {context,page,fixture}=await setup();
  try{
    await page.getByRole('button',{name:'导出',exact:true}).click();const dialog=page.getByRole('dialog');
    for(const name of ['笔记','随笔','问答','字幕','HTML'])await expect(dialog.getByRole('tab',{name:new RegExp('^'+name)})).toBeVisible();
    await dialog.getByRole('tab',{name:/^字幕/}).click();await dialog.getByRole('checkbox',{name:/原始字幕/}).check();
    await expect(dialog.getByRole('checkbox',{name:'SRT'})).toBeChecked();await dialog.getByRole('radio',{name:'分别下载'}).check();
    const records=()=>page.evaluate(()=>chrome.downloads.search({orderBy:['-startTime']}));
    await page.evaluate(()=>chrome.downloads.download({url:'data:application/octet-stream,CONTROL',filename:'native-control.srt',saveAs:false}));
    await expect.poll(async()=> (await records()).find(d=>d.state==='complete')?.filename).toContain('native-control.srt');
    await dialog.getByRole('button',{name:'开始导出',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('source.txt：下载完成');const srtDownloads=await records();await writeFile(resolve(output,'browser-downloads.json'),JSON.stringify(srtDownloads.map(d=>({filename:d.filename,state:d.state,error:d.error})),null,2));
    const firstCalls=await page.evaluate(()=>(window as any).locateLog);expect(firstCalls[0].operation.selection[0].format).toBe('srt');const srtName=firstCalls[0].files.find((n:string)=>n.endsWith('.srt'));expect(await readFile(srtDownloads.find(d=>d.filename.endsWith(srtName))!.filename,'utf8')).toMatch(/^1\n00:00:01,234 --> 00:00:03,456\n站点字幕本体/);expect(await readFile(srtDownloads.find(d=>d.filename.endsWith('.source.txt'))!.filename,'utf8')).toContain('AI/人工属性未知');
    await dialog.getByRole('tab',{name:/^笔记/}).click();await dialog.getByRole('checkbox',{name:/阅读与定位/}).check();await dialog.getByLabel('笔记格式').selectOption('txt');
    await dialog.getByRole('tab',{name:/^问答/}).click();await dialog.getByRole('checkbox').first().check();
    await dialog.getByRole('tab',{name:/^HTML/}).click();await dialog.getByRole('checkbox').first().check();
    await dialog.getByRole('tab',{name:/^随笔/}).click();await dialog.getByRole('checkbox',{name:/随笔汇总/}).check();
    await expect(dialog.getByLabel('搜索导出资料')).toHaveCount(0);await dialog.getByLabel('导出分 P').selectOption(fixture.otherWorkspace);await expect(dialog.getByRole('checkbox',{name:/随笔汇总/})).toBeVisible();await expect(dialog.getByRole('checkbox',{name:/随笔汇总/})).not.toBeChecked();await dialog.getByLabel('导出分 P').selectOption(fixture.workspaceId);
    await dialog.getByRole('tab',{name:/^字幕/}).click();await expect(dialog.getByRole('checkbox',{name:'SRT'})).toBeChecked();await expect(dialog.getByLabel('笔记格式')).toHaveValue('txt');
    await dialog.getByRole('radio',{name:'合并打包'}).check();await dialog.getByRole('button',{name:'开始导出',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Vcamp-所选资料.zip：下载完成');const allDownloads=await records();const zipPath=allDownloads.find(d=>d.filename.endsWith('.zip'))!.filename;await cp(zipPath,resolve(output,'selected.zip'));const zip=unzipSync(await readFile(zipPath));const text=Object.entries(zip).filter(([n])=>!n.endsWith('.png')).map(([n,b])=>n+'\n'+strFromU8(b)).join('\n');
    expect(text).toContain('00:00:01,234 --> 00:00:03,456');expect(text).not.toContain('不应混入');expect(Object.keys(zip).some(n=>n.endsWith('.png'))).toBe(true);expect(text).toContain('./');expect(text).toContain('AI/人工属性未知');
    expect(text).not.toContain('包装笔记');expect(text).not.toContain('其他视频私有资料');expect(text).toContain('未选同 P 随笔');expect(text).not.toContain('diagnostic');
    await expect(dialog.getByRole('button',{name:'开始导出',exact:true})).toBeEnabled();await page.screenshot({path:resolve(output,'export-panel.png')});await page.setViewportSize({width:320,height:850});await page.screenshot({path:resolve(output,'export-panel-320.png')});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await writeFile(resolve(output,'export-result.json'),JSON.stringify({files:Object.keys(zip),realBrowserDownloads:true,categoryFormatsPreserved:true,partFilterPreserved:true,selection:(await page.evaluate(()=>(window as any).locateLog)).map((c:any)=>c.operation),modelCalls:0},null,2));
    // Hold only the public export response to exercise cancellation before any
    // download, without replacing the production serializer or download API.
    await dialog.getByRole('button',{name:'清空',exact:true}).click();await dialog.getByRole('tab',{name:/^HTML/}).click();await dialog.getByRole('checkbox').first().check();
    const beforeCancel=(await records()).length;
    await page.evaluate(()=>{const original=chrome.runtime.sendMessage.bind(chrome.runtime);(window as any).heldExports=0;chrome.runtime.sendMessage=(async(message:any)=>{const response=await original(message);if(message.operation?.type==='library.export'){(window as any).heldExports++;await new Promise<void>(r=>{(window as any).releaseExport=r;});}return response;}) as any;(window as any).restoreExport=()=>{chrome.runtime.sendMessage=original;};});
    await dialog.getByRole('button',{name:'开始导出',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).heldExports)).toBe(1);await expect(dialog.getByRole('button',{name:'正在导出…',exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'正在导出…',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());expect(await page.evaluate(()=>(window as any).heldExports)).toBe(1);
    await dialog.getByRole('button',{name:'取消后续下载'}).click();await page.evaluate(()=>{(window as any).releaseExport();(window as any).restoreExport();});
    await expect(dialog.getByRole('status')).toContainText('完成 0/1 个下载，0 个未完成，1 个未开始');expect((await records()).length).toBe(beforeCancel);
    // A single actual file stays a direct HTML download even in ZIP mode.
    await dialog.getByRole('button',{name:'开始导出',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('.html：下载完成');const direct=(await records()).find(d=>d.filename.endsWith('.html'))!;expect(await readFile(direct.filename,'utf8')).toContain('添加动态链接');
    await writeFile(resolve(output,'export-control-result.json'),JSON.stringify({duplicateSubmissions:1,cancelledBeforeDownload:true,completed:0,unfinished:0,notStarted:1,singleFileDirectInZipMode:direct.state==='complete',modelCalls:0},null,2));
    await dialog.getByRole('button',{name:'关闭导出'}).click();
    for(const module of ['笔记','随笔','字幕','HTML']){
      await page.getByRole('navigation',{name:'模块导航'}).getByRole('button',{name:module,exact:true}).click();
      // Navigation has an exit animation. These modules use the established
      // global export flow, rather than duplicate per-module toolbar entries.
      await expect(page.getByRole('main',{name:module,exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'导出',exact:true})).toHaveCount(0);
    }
    await page.getByRole('navigation',{name:'模块导航'}).getByRole('button',{name:'问答',exact:true}).click();
    await expect(page.getByRole('main',{name:'问答',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'导出',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('tab')).toHaveCount(5);
    await page.getByRole('dialog').getByRole('button',{name:'关闭导出'}).click();
    await page.getByRole('button',{name:'资料库',exact:true}).click();await expect(page.getByRole('region',{name:'资料库内容'})).toBeVisible();await expect(page.locator('.library-video-card')).not.toHaveCount(0);
    // Open the actual downloaded portable HTML only after the video-bound UI
    // checks: focusing a local-file tab legitimately releases its video binding.
    const htmlName=Object.keys(zip).find(n=>n.endsWith('.html'))!,htmlPath=resolve(output,'portable.html');await writeFile(htmlPath,zip[htmlName]);const portable=await context.newPage();await portable.goto(pathToFileURL(htmlPath).href);const portableContent=portable.frameLocator('iframe');await portableContent.getByRole('button',{name:'添加动态链接'}).click();await expect(portableContent.getByRole('link',{name:'动态锚点'})).toBeVisible();await portable.close();
  }finally{await context.close();}
});

test('complete synthetic HTML response opens and remains interactive in the production sandbox',async()=>{
  const {context,page,id}=await setup();
  try{
    await page.goto(`chrome-extension://${id}/html-seed.html`);await expect(page.locator('#status')).toContainText('sourceExact');const saved=JSON.parse((await page.locator('#status').textContent())!);expect(saved).toMatchObject({state:'completed',sourceExact:true,calls:1,externalModelCalls:0});
    await page.goto(`chrome-extension://${id}/reader.html?workspaceId=${encodeURIComponent(saved.workspaceId)}&knowledgeId=${saved.pageId}`);const content=page.frameLocator('.html-page-frame').frameLocator('iframe');await expect(content.getByRole('heading',{name:'记忆与依据'})).toBeVisible();await expect(content.locator('#explanation')).toBeHidden();await content.getByRole('button',{name:'展开解释'}).press('Enter');await expect(content.locator('#explanation')).toBeVisible();await page.screenshot({path:resolve(output,'html-interaction.png')});await writeFile(resolve(output,'html-result.json'),JSON.stringify({...saved,productionSandbox:true,syntheticReplay:true,keyboardInteraction:true},null,2));
  }finally{await context.close();}
});
