import {test,expect,chromium,type BrowserContext,type Page} from '@playwright/test';
import {readFile,writeFile,mkdir,mkdtemp,cp,readdir,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

const root=resolve('..'),output=resolve('.tmp/package-install');
const key='SYNTHETIC_PACKAGE_INSTALL_KEY';
const command=(page:Page,operation:unknown)=>page.evaluate(async operation=>{
  const result=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation});
  if(!result.ok)throw Error(`Operation failed: ${result.code}`);return result.view;
},operation);
async function unpack(){
  const metadata=JSON.parse(await readFile(resolve(root,'out/build-manifest.json'),'utf8'));
  const zip=await readFile(resolve(root,'out',metadata.zip));
  expect(createHash('sha256').update(zip).digest('hex')).toBe(metadata.zipSha256);
  const entries=unzipSync(zip);await mkdir(output,{recursive:true});const bundle=await mkdtemp(resolve(output,'bundle-'));
  for(const [name,bytes]of Object.entries(entries)){
    const file=resolve(bundle,name);if(!file.startsWith(bundle+'\\'))throw Error('Archive path escaped bundle');
    await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);
  }
  expect(Object.keys(entries).some(name=>/seed|probe|\.env|\.map$|tests\//i.test(name))).toBe(false);
  const manifest=JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
  expect(manifest.host_permissions.every((value:string)=>value.startsWith('https://'))).toBe(true);
  for(const item of metadata.inventory)expect(createHash('sha256').update(entries[item.path]).digest('hex')).toBe(item.sha256);
  return {bundle,metadata,manifest};
}
async function launch(bundle:string,profile:string){
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
  await context.route(/^https?:/,route=>{
    const url=route.request().url();
    if(url.startsWith('https://www.bilibili.com/video/'))return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><title>合成安装验收</title><script>window.__INITIAL_STATE__={videoData:{bvid:'BVreleaseInstall',title:'合成安装验收',pages:[{page:1,cid:88,part:'合成教材'}]}};window.player={getVideoMessage:()=>({bvid:'BVreleaseInstall',cid:88})};fetch('https://api.bilibili.com/x/player/wbi/v2?cid=88');</script>`});
    if(url.startsWith('https://api.bilibili.com/'))return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{aid:1,desc:'合成教材',subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/release.json'}]}}})});
    if(url==='https://aisubtitle.hdslb.com/release.json')return route.fulfill({contentType:'application/json',body:JSON.stringify({body:[{from:0,to:4,content:'合成安装验收字幕'}]})});
    return route.abort();
  });
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  // The actual production ZIP remains byte-for-byte intact. Only transport is
  // controlled in this isolated profile; no credentials or paid API are used.
  await worker.evaluate(()=>{globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url==='https://api.deepseek.com/models')return Response.json({data:[{id:'release-text',input_modalities:['text'],output_modalities:['text']}]});
    if(url.startsWith('https://api.bilibili.com/'))return Response.json({code:0,data:{aid:1,desc:'合成教材',subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/release.json'}]}}});
    if(url==='https://aisubtitle.hdslb.com/release.json')return Response.json({body:[{from:0,to:4,content:'合成安装验收字幕'}]});
    throw Error('External transport forbidden in package acceptance');
  };});
  const id=new URL(worker.url()).host,page=await context.newPage();await page.goto(`chrome-extension://${id}/sidepanel.html`);
  const site=await context.newPage();await site.goto('https://www.bilibili.com/video/BVreleaseInstall/');await site.bringToFront();
  await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
  return {context,page,worker,id};
}
async function populate(page:Page){
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'API 设置',exact:true}).click();
  await page.getByLabel('API Key',{exact:true}).fill(key);await page.getByRole('button',{name:'保存 Key',exact:true}).click();
  await page.getByRole('button',{name:'拉取模型 / 重试',exact:true}).click();
  await page.getByLabel('模型录入',{exact:true}).getByRole('checkbox').check();
  await page.getByRole('button',{name:'录入所选模型',exact:true}).click();await page.getByRole('button',{name:/^返回/}).click();
  await page.getByLabel('输入草稿',{exact:true}).fill('候选包重启后仍保留的合成草稿');
  await expect(page.getByRole('status')).toHaveText('草稿已保存');
  const view=await command(page,{type:'workspace.query'});
  await command(page,{type:'scribble.create',workspaceId:view.workspaceId,text:'安装与升级验收的合成随笔',time:2});
  return {workspaceId:view.workspaceId,chatId:view.chatId};
}
async function verify(page:Page,target:{workspaceId:string;chatId:string}){
  const view=await command(page,{type:'workspace.query',target});expect(view.draft.text).toBe('候选包重启后仍保留的合成草稿');
  expect((await command(page,{type:'provider.query'})).provider).toMatchObject({hasKey:true,defaultModelId:'release-text'});
  const notes=await command(page,{type:'scribble.query',workspaceId:target.workspaceId});expect(notes.scribbles.scribbles).toContainEqual(expect.objectContaining({text:'安装与升级验收的合成随笔'}));
}

test('production ZIP installs in a new profile and preserves configuration, draft and notes after restart',async()=>{
  const {bundle,metadata}=await unpack(),profile=await mkdtemp(resolve(output,'fresh-'));
  let f=await launch(bundle,profile);
  try{const target=await populate(f.page),id=f.id;await f.context.close();f=await launch(bundle,profile);expect(f.id).toBe(id);await verify(f.page,target);
    await f.page.bringToFront();await expect(f.page.getByTestId('startup')).toHaveCount(0);await f.page.screenshot({path:test.info().outputPath('installed-package.png')});
    await writeFile(test.info().outputPath('acceptance.json'),JSON.stringify({package:metadata.zip,sha256:metadata.zipSha256,browser:f.context.browser()?.version(),freshInstall:true,sameProfileRestart:true,persistentKey:true,persistentDraft:true,persistentNote:true,paidRequests:0},null,2));
  }finally{await f.context.close();}
});

test('same-path upgrade from the prior production package keeps identity and existing data',async()=>{
  test.skip(!process.env.VCAMP_UPGRADE_FROM,'Set VCAMP_UPGRADE_FROM to a verified old production directory');
  const {bundle:current,metadata}=await unpack();
  const upgrade=await mkdtemp(resolve(output,'upgrade-bundle-'));await cp(resolve(process.env.VCAMP_UPGRADE_FROM!),upgrade,{recursive:true});
  const before=JSON.parse(await readFile(resolve(upgrade,'manifest.json'),'utf8'));expect(before.version).toBe('0.1.82');
  const profile=await mkdtemp(resolve(output,'upgrade-profile-'));let f=await launch(upgrade,profile);
  try{const target=await populate(f.page),id=f.id;await f.context.close();
    // Only this generated isolated bundle is replaced. Verify every deletion
    // resolves beneath it before removing obsolete versioned asset names.
    for(const entry of await readdir(upgrade)){const path=resolve(upgrade,entry);if(dirname(path)!==upgrade)throw Error('Unsafe upgrade path');await rm(path,{recursive:true});}
    await cp(current,upgrade,{recursive:true});f=await launch(upgrade,profile);expect(f.id).toBe(id);await verify(f.page,target);
    expect(await f.worker.evaluate(()=>chrome.runtime.getManifest().version_name)).toBe(metadata.versionName);
    await writeFile(test.info().outputPath('upgrade.json'),JSON.stringify({from:before.version,to:metadata.versionName,sameIdentity:true,persistentData:true,paidRequests:0},null,2));
  }finally{await f.context.close();}
});
