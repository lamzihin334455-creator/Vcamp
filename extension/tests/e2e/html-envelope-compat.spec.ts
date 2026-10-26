import {test,expect,chromium} from '@playwright/test';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

test('wrapped model response diagnoses complete, saves only HTML and opens/interacts/resets',async()=>{
  const output=resolve('../.tmp/html-fix-02');await mkdir(output,{recursive:true});
  const extension=resolve('dist-test'),profile=await mkdtemp(resolve(output,'profile-'));
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:400,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const requests:string[]=[];context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  try{
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host,page=await context.newPage();
    // Complete background recovery before this fixture creates its synthetic
    // executor (tab 99). Recovery must not interrupt a partially seeded job.
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    const bootstrap=await page.evaluate(async()=>{
      const send=(operation:unknown)=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation});
      const workspace=await send({type:'workspace.query'});
      if(!workspace.ok)return workspace;
      return send({type:'generation.query',target:{kind:'chat',workspaceId:workspace.view.workspaceId,chatId:workspace.view.chatId}});
    });
    expect(bootstrap.ok).toBe(true);
    await page.goto(`chrome-extension://${id}/tests/installed/html-compat-seed.html`);
    await expect(page.locator('#status')).toContainText('workspaceId');
    const saved=JSON.parse((await page.locator('#status').textContent())!);
    expect(saved).toMatchObject({state:'completed',sourceExact:true,calls:1,externalModelCalls:0,diagnostic:{purpose:'html-page',cause:'stop',htmlEnvelope:'complete'}});
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.getByRole('button',{name:'打开页面',exact:true}).click();
    const content=()=>page.frameLocator('.html-page-frame').frameLocator('iframe');
    await expect(content().getByRole('heading',{name:'记忆与依据'})).toBeVisible();
    await expect(content().locator('#explanation')).toBeHidden();
    await content().getByRole('button',{name:'展开解释'}).focus();await content().getByRole('button',{name:'展开解释'}).press('Enter');
    await expect(content().locator('#explanation')).toBeVisible();
    await page.screenshot({path:resolve(output,'interaction.png')});
    await page.getByRole('button',{name:'初始化',exact:true}).click();await expect(content().locator('#explanation')).toBeHidden();
    await page.getByRole('button',{name:'退出页面',exact:true}).click();await page.reload();
    await page.getByRole('button',{name:'打开页面',exact:true}).click();await expect(content().getByRole('heading',{name:'记忆与依据'})).toBeVisible();
    expect(requests).toEqual([]);
    await writeFile(resolve(output,'browser-result.json'),JSON.stringify({...saved,browser:context.browser()?.version(),interaction:true,reset:true,reloadReopen:true,httpRequests:requests.length},null,2));
  }finally{await context.close();}
});
