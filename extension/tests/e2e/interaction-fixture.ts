import {expect,chromium} from '@playwright/test';
import {cp,mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';

const output=resolve('../.tmp/interaction-02');
export async function setup(options?:{mediaPath:string;cues:readonly {from:number;to:number;content:string}[];title:string;relayOrigin:string},extraFixture?:{entryPoint:string;name:string}){
  await mkdir(output,{recursive:true});
  const bundle=await mkdtemp(resolve(output,'bundle-'));await cp(process.env.EXPERIENCE_BUNDLE??resolve('dist'),bundle,{recursive:true});
  // Only add a fixture entry. All product bundles and the manifest are the production build.
  await build({entryPoints:['tests/installed/experience-seed.ts'],bundle:true,format:'iife',outfile:resolve(bundle,'seed.js')});
  await build({entryPoints:['tests/installed/html-compat-seed.ts'],bundle:true,format:'iife',outfile:resolve(bundle,'html-seed.js')});
  await writeFile(resolve(bundle,'html-seed.html'),'<div id="status"></div><script src="html-seed.js"></script>');
  await writeFile(resolve(bundle,'seed.html'),'<div id="status"></div><script src="seed.js"></script>');
  if(extraFixture){
    await build({entryPoints:[extraFixture.entryPoint],bundle:true,format:'iife',outfile:resolve(bundle,extraFixture.name+'.js')});
    await writeFile(resolve(bundle,extraFixture.name+'.html'),`<div id="status"></div><script src="${extraFixture.name}.js"></script>`);
  }
  const profile=await mkdtemp(resolve(output,'profile-')),downloads=await mkdtemp(resolve(output,'downloads-'));
  await mkdir(resolve(profile,'Default'),{recursive:true});await writeFile(resolve(profile,'Default/Preferences'),JSON.stringify({download:{default_directory:downloads,prompt_for_download:false}}));
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,acceptDownloads:true,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`,'--autoplay-policy=no-user-gesture-required']});
  const mediaUrl='data:video/mp4;base64,'+(await readFile(options?.mediaPath??'tests/fixtures/t02-synthetic.mp4')).toString('base64');
  const forbidden:string[]=[];
  await context.route('**/*',async r=>{
    const u=r.request().url();
    if(options&&u.startsWith(options.relayOrigin+'/'))return r.continue();
    if(u.startsWith('https://www.bilibili.com/video/')){const bv=new URL(u).pathname.split('/')[2],single=bv==='BVsingle'||bv==='BVnosub',title=options?.title??(bv==='BVnosub'?'无字幕视觉样本':single?'单视频样本':bv==='BVexperience'?'体验修复本地夹具':'B 视频样本');return r.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><video src="${mediaUrl}" controls></video><script>window.__INITIAL_STATE__={videoData:{bvid:'${bv}',title:'${title}',pages:${JSON.stringify(single?[{page:1,cid:11,part:title}]:[{page:1,cid:11,part:'第一部分'},{page:2,cid:12,part:'第二部分'}])}}};window.player={getVideoMessage:()=>({bvid:'${bv}',cid:Number(new URL(location.href).searchParams.get('p')||1)===1?11:12})};fetch('https://api.bilibili.com/x/player/wbi/v2?cid='+(Number(new URL(location.href).searchParams.get('p')||1)===1?11:12)+'${bv==='BVnosub'?'&nosub=1':''}');</script>`});}
    if(u.startsWith('https://api.bilibili.com/x/web-interface/view?')){
      const bvid=new URL(u).searchParams.get('bvid'),single=bvid==='BVsingle'||bvid==='BVnosub';
      const title=options?.title??(single?'单视频样本':bvid==='BVexperience'?'体验修复本地夹具':'B 视频样本');
      return r.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data:{bvid,title,desc:'本地视频简介夹具',pages:single?[{page:1,cid:11,part:title}]:[{page:1,cid:11,part:'第一部分'},{page:2,cid:12,part:'第二部分'}]}})});
    }
    if(u.startsWith('https://api.bilibili.com/x/player/'))return r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{subtitle:{subtitles:new URL(u).searchParams.has('nosub')?[]:['zh-CN','ai-en','ai-ja','failed'].map(lan=>({lan,lan_doc:({'zh-CN':'中文','ai-en':'English','ai-ja':'日本語',failed:'失败轨'} as Record<string,string>)[lan],subtitle_url:`https://aisubtitle.hdslb.com/${lan}.json`}))}}})});
    if(u.startsWith('https://aisubtitle.hdslb.com/'))return r.fulfill({status:u.includes('failed')?403:200,contentType:'application/json',body:JSON.stringify({body:options?.cues??[{from:1.234,to:3.456,content:'native '+new URL(u).pathname.slice(1,-5)}]})});
    if(/^https?:/.test(u)){forbidden.push(u);return r.abort();}return r.continue();
  });
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host,page=await context.newPage();
  const downloadSession=await context.newCDPSession(page);await downloadSession.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:true});
  await page.goto(`chrome-extension://${id}/seed.html`);await expect(page.locator('#status')).toContainText('workspaceId');const fixture=JSON.parse((await page.locator('#status').textContent())!);
  await page.goto(`chrome-extension://${id}/sidepanel.html`);const site=await context.newPage();await site.goto('https://www.bilibili.com/video/BVexperience/?p=1');await site.bringToFront();
  await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
  await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>({ready:v.readyState,duration:v.duration,seekable:v.seekable.length}))).toMatchObject({seekable:1});
  await page.evaluate(()=>{const original=chrome.runtime.sendMessage.bind(chrome.runtime);(window as any).locateLog=[];chrome.runtime.sendMessage=(async(message:any)=>{const response=await original(message);if(['library.locate','library.export'].includes(message.operation?.type))(window as any).locateLog.push({operation:message.operation,ok:response.ok,code:response.code,files:response.view?.library?.documents?.files.map((f:any)=>f.name)});return response;}) as any;});
  await writeFile(resolve(output,'native-control.json'),JSON.stringify(await site.locator('video').evaluate(async(v:HTMLVideoElement)=>{v.currentTime=0.5;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));return {time:v.currentTime,duration:v.duration};})));
  return {context,page,site,fixture,forbidden,id,worker};
}
