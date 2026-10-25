import {test,expect,chromium} from '@playwright/test';
import {cp,mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {unzipSync,strFromU8} from 'fflate';

const output=resolve('../.tmp/subtitle-html-fix');
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
    if(u.startsWith('https://api.bilibili.com/x/player/'))return r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{subtitle:{subtitles:['zh-CN','ai-en','ai-ja','failed'].map(lan=>({lan,lan_doc:({'zh-CN':'中文','ai-en':'English','ai-ja':'日本語',failed:'失败轨'} as Record<string,string>)[lan],subtitle_url:`https://aisubtitle.hdslb.com/${lan}.json`}))}}})});
    if(u.startsWith('https://aisubtitle.hdslb.com/'))return r.fulfill({status:u.includes('failed')?403:200,contentType:'application/json',body:JSON.stringify({body:[{from:1.234,to:3.456,content:'native '+new URL(u).pathname.slice(1,-5)}]})});
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

test('subtitle workbench uses one main subtitle and exposes independent AI actions',async()=>{
  test.setTimeout(30000);
  const {context,page,fixture}=await setup();
  try{
    await page.getByRole('button',{name:'字幕',exact:true}).click();
    await expect(page.getByLabel('Chat 分析源')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'AI 翻译',exact:true})).not.toBeVisible();
    await expect(page.getByRole('button',{name:'AI 字幕修正',exact:true})).not.toBeVisible();
    await expect(page.getByLabel('字幕处理要求')).toHaveCount(0);
    await page.getByRole('button',{name:'字幕设置',exact:true}).click();
    const settings=page.locator('.subtitle-settings');
    await expect(settings.getByRole('button',{name:'AI 翻译',exact:true})).toBeVisible();
    await expect(settings.getByRole('button',{name:'AI 字幕修正',exact:true})).toBeVisible();
    const controls=page.locator('.subtitle-options').filter({has:page.getByLabel('主字幕',{exact:true})});
    await controls.getByLabel('主字幕',{exact:true}).selectOption('ai-en');
    await expect.poll(async()=>page.evaluate(async workspaceId=>(await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'subtitles.query',workspaceId}})).view.subtitles.analysisSource,fixture.workspaceId)).toEqual({kind:'native',language:'ai-en'});
    await controls.getByLabel('主字幕',{exact:true}).selectOption('saved:'+fixture.translated);
    await expect.poll(async()=>page.evaluate(async workspaceId=>(await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'subtitles.query',workspaceId}})).view.subtitles.analysisSource,fixture.workspaceId)).toEqual({kind:'version',versionId:fixture.translated});
    await page.getByRole('button',{name:'查看修正效果',exact:true}).click();
    await expect(page.getByLabel('字幕修正效果')).toContainText('“native zh-CN”替换为“增强内容”');
    await page.setViewportSize({width:360,height:850});
    await page.screenshot({path:resolve(output,'unified-ai-actions-360.png')});
  }finally{await context.close();}
});

test('installed multilingual export, unified display choices and HTML native seek',async()=>{
  test.setTimeout(60000);
  const {context,page,site,forbidden,fixture}=await setup();
  try{
    await page.getByRole('button',{name:'字幕',exact:true}).click();
    await expect(page.getByLabel('Chat 分析源')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'AI 翻译',exact:true})).not.toBeVisible();
    await expect(page.getByRole('button',{name:'AI 字幕修正',exact:true})).not.toBeVisible();
    await expect(page.getByLabel('字幕处理要求')).toHaveCount(0);
    await page.getByRole('button',{name:'字幕设置',exact:true}).click();
    await expect(page.locator('.subtitle-settings').getByRole('button',{name:'AI 翻译',exact:true})).toBeVisible();
    await expect(page.locator('.subtitle-settings').getByRole('button',{name:'AI 字幕修正',exact:true})).toBeVisible();
    await expect(page.getByLabel('查看字幕版本')).toHaveCount(0);
    const controls=page.locator('.subtitle-options').filter({has:page.getByLabel('主字幕',{exact:true})});
    await expect(controls.getByRole('option',{name:'原始字幕 · English（ai-en）',exact:true})).toHaveCount(1);
    await controls.getByLabel('主字幕',{exact:true}).selectOption('ai-en');
    await expect.poll(async()=>page.evaluate(async workspaceId=>(await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'subtitles.query',workspaceId}})).view.subtitles.analysisSource,fixture.workspaceId)).toEqual({kind:'native',language:'ai-en'});
    await controls.getByLabel('双语显示').check();
    await controls.getByLabel('辅助语言').selectOption('ai-ja');
    await expect(page.getByLabel('字幕时间轴').getByText('native ai-en',{exact:true})).toHaveText('native ai-en');
    await expect(page.locator('.subtitle-secondary').first()).toHaveText('native ai-ja');
    // Saved AI versions use the same display selector without resetting bilingual.
    await controls.getByLabel('主字幕',{exact:true}).selectOption('saved:'+fixture.translated);
    await expect.poll(async()=>page.evaluate(async workspaceId=>(await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'subtitles.query',workspaceId}})).view.subtitles.analysisSource,fixture.workspaceId)).toEqual({kind:'version',versionId:fixture.translated});
    await expect(page.getByLabel('字幕时间轴').getByText('翻译内容',{exact:true})).toBeVisible();
    await expect(controls.getByLabel('双语显示')).toBeChecked();
    await page.getByRole('button',{name:'查看修正效果',exact:true}).click();
    await expect(page.getByLabel('字幕修正效果')).toContainText('“native zh-CN”替换为“增强内容”');
    await controls.getByLabel('主字幕',{exact:true}).selectOption('ai-en');
    await page.setViewportSize({width:320,height:850});
    expect(await controls.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.screenshot({path:resolve(output,'unified-subtitles-320.png')});
    await page.keyboard.press('Escape');
    await page.getByRole('navigation').getByRole('button',{name:'问答',exact:true}).click();
    await page.getByRole('button',{name:'导出',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:/^字幕/}).click();
    for(const language of ['中文','English','日本語'])await dialog.getByRole('checkbox',{name:new RegExp('原始字幕 · '+language)}).check();
    await expect(dialog.getByRole('checkbox',{name:/失败轨/})).toHaveCount(0);
    await dialog.getByRole('button',{name:'开始导出',exact:true}).click();
    await expect(dialog.getByRole('status')).toContainText('Vcamp-所选资料.zip：下载完成');
    const downloads=await page.evaluate(()=>chrome.downloads.search({orderBy:['-startTime']}));
    const zipPath=downloads.find(d=>d.filename.endsWith('.zip')&&d.state==='complete')!.filename;
    const zip=unzipSync(await readFile(zipPath));const srts=Object.entries(zip).filter(([name])=>name.endsWith('.srt'));
    expect(srts).toHaveLength(3);expect(Object.keys(zip)).toHaveLength(6);
    for(const language of ['zh-CN','ai-en','ai-ja'])expect(srts.filter(([,bytes])=>strFromU8(bytes).includes('native '+language))).toHaveLength(1);
    await writeFile(resolve(output,'native-export.json'),JSON.stringify({files:Object.keys(zip),downloadCompleted:true,bodyPerLanguage:true}));
    await dialog.getByRole('button',{name:'关闭导出'}).click();
    await page.getByRole('button',{name:'HTML',exact:true}).click();
    const content=page.frameLocator('.html-page-frame').frameLocator('iframe');
    for(const [label,seconds,role] of [['00:02',2,'link'],['00:03',3.25,'button'],['00:04',4,'link']] as const){
      await page.waitForTimeout(1100);
      await content.getByRole(role,{name:label,exact:true}).click();
      // In-video timestamps seek directly after a trusted click; external URLs still require confirmation.
      await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(seconds,2);
      await expect(page.getByRole('group',{name:'页面导航确认'})).toHaveCount(0);
      expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
    }
    await page.screenshot({path:resolve(output,'html-time-320.png')});
    await writeFile(resolve(output,'html-seek.json'),JSON.stringify({time:await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime),realMedia:true,trustedClickDirectSeek:true,forbiddenRequests:forbidden,modelCalls:0}));
  }finally{await context.close();}
});

