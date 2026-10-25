import {test,expect,chromium} from '@playwright/test';
import {resolve} from 'node:path';
import {mkdtemp,mkdir} from 'node:fs/promises';
test('saved HTML opens from Chat, interactions/reset/library/reopen work and scribbles remain independent',async()=>{
  await mkdir(resolve('.profiles'),{recursive:true});await mkdir(resolve('../.tmp/rectify-b-evidence'),{recursive:true});
  const profile=await mkdtemp(resolve('.profiles/Rectify-B-UI-')),extension=resolve('dist-test');
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:360,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try{
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host,page=await context.newPage();
    const requests:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
    await page.goto(`chrome-extension://${id}/tests/installed/rectify-b-seed.html`);await expect(page.locator('#status')).toContainText('workspaceId');
    const saved=JSON.parse((await page.locator('#status').textContent())!);
    await page.goto(`chrome-extension://${id}/sidepanel.html`);await page.getByRole('button',{name:'打开页面',exact:true}).first().click();
    const content=()=>page.frameLocator('.html-page-frame').frameLocator('iframe');
    await expect(content().getByRole('heading',{name:'同一件事，为何会有不同叙述？'})).toBeVisible();
    await content().getByLabel('内容筛选').selectOption('video');await expect(content().getByRole('heading',{name:'补充解释',exact:true})).toBeHidden();
    await content().getByRole('button',{name:'不一定'}).click();await expect(content().locator('#feedback')).toContainText('正确');
    await page.getByRole('button',{name:'初始化',exact:true}).click();await expect(content().getByLabel('内容筛选')).toHaveValue('all');await expect(content().locator('#feedback')).toBeEmpty();
    await page.screenshot({path:resolve('../.tmp/rectify-b-evidence/local-html-360.png')});
    expect(await content().locator('body').evaluate(el=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.setViewportSize({width:900,height:800});await page.screenshot({path:resolve('../.tmp/rectify-b-evidence/local-html-900.png')});
    await page.getByRole('button',{name:'退出页面',exact:true}).click();await expect(page.locator('.html-page-frame')).toHaveCount(0);
    await page.getByRole('button',{name:'打开页面',exact:true}).first().click();await expect(content().getByLabel('内容筛选')).toHaveValue('all');
    await page.reload();await page.getByRole('button',{name:'打开页面',exact:true}).first().click();await expect(content().getByLabel('内容筛选')).toHaveValue('all');
    await page.getByRole('button',{name:'随笔',exact:true}).click();await expect(page.locator('.scribble-body')).toHaveText(['最早的随笔','中间的随笔','较晚的随笔','没有时间的旧式记录']);
    await page.getByRole('button',{name:'编辑随笔',exact:true}).first().click();await page.getByRole('textbox',{name:'编辑随笔',exact:true}).fill('最早的随笔已编辑');await page.getByRole('button',{name:'保存随笔',exact:true}).click();await expect(page.locator('.scribble-body').first()).toHaveText('最早的随笔已编辑');
    await page.getByRole('button',{name:'00:16',exact:true}).click();expect(await worker.evaluate(async()=> (await chrome.storage.local.get('vcamp.test.lastSeek'))['vcamp.test.lastSeek'].time)).toBe(16);
    await page.screenshot({path:resolve('../.tmp/rectify-b-evidence/local-scribbles.png')});
    await page.goto(`chrome-extension://${id}/reader.html?library=1&workspaceId=${encodeURIComponent(saved.workspaceId)}&knowledgeId=${saved.pageId}`);await expect(content().getByLabel('内容筛选')).toHaveValue('all');
    await page.getByLabel('查看资料').selectOption({label:'旧知识兼容夹具'});await expect(page.getByRole('heading',{name:'旧知识兼容夹具',exact:true})).toBeVisible();
    expect(requests).toEqual([]);
  }finally{await context.close();}
});
test('HTML sandbox executes local interaction, isolates host, resets and exits',async()=>{
  await mkdir(resolve('.profiles'),{recursive:true});const profile=await mkdtemp(resolve('.profiles/Rectify-B-'));
  const extension=resolve(process.env.EXPERIENCE_BUNDLE ?? 'dist');
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:360,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try{
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
    const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    const source=`<!doctype html><html><head><title>隔离测试</title><style>body{font:18px/1.7 sans-serif;margin:16px}button{font:inherit}</style></head><body><h1>阅读与操作</h1><button id="count">点击计数 0</button><pre id="proof"></pre><script>let n=0;document.querySelector('#count').onclick=()=>document.querySelector('#count').textContent='点击计数 '+(++n);let host;try{host=parent.parent.document.body.textContent}catch{host='denied'};let store;try{store=localStorage.length}catch{store='denied'}document.querySelector('#proof').textContent=JSON.stringify({host,store,extension:typeof chrome?.runtime?.sendMessage,rtc:typeof RTCPeerConnection});fetch('https://example.invalid/probe').catch(()=>{});</script></body></html>`;
    async function mount(){await page.evaluate(source=>{
      document.querySelector('#probe')?.remove();const f=document.createElement('iframe');f.id='probe';f.style.cssText='position:fixed;inset:0;width:300px;height:600px;z-index:2147483647';f.src='sandbox.html';f.sandbox.add('allow-scripts');f.onload=()=>f.contentWindow?.postMessage({type:'vcamp.html.render',source},'*');document.body.append(f);
    },source);}
    await mount();const frame=()=>page.frameLocator('#probe').frameLocator('iframe');
    await expect(frame().getByRole('heading',{name:'阅读与操作'})).toBeVisible();
    await expect(frame().locator('#proof')).toContainText('denied');
    await frame().getByRole('button',{name:'点击计数 0'}).focus();await frame().getByRole('button',{name:'点击计数 0'}).press('Enter');await expect(frame().getByRole('button',{name:'点击计数 1'})).toBeVisible();
    expect(JSON.parse((await frame().locator('#proof').textContent())!)).toEqual({host:'denied',store:'denied',extension:'undefined',rtc:'undefined'});
    await mount();await expect(frame().getByRole('button',{name:'点击计数 0'})).toBeVisible();
    await page.evaluate(()=>document.querySelector('#probe')?.remove());await expect(page.locator('#probe')).toHaveCount(0);
    console.log(JSON.stringify({browser:context.browser()?.version(),blockedFetch:errors.some(e=>e.includes("connect-src 'none'")),pageErrors:errors.filter(e=>!e.includes('Content Security Policy')&&!e.includes('Fetch API cannot load'))}));
  }finally{await context.close();}
});
