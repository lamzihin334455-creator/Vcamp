import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

test('style manager, global input menu, immediate send and isolated preference restore work together',async()=>{
 test.setTimeout(120_000);
 const first=await setup();let second:Awaited<ReturnType<typeof setup>>|undefined;
 const {context,page,worker,site}=first;page.setDefaultTimeout(15_000);
 try{
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  await worker.evaluate(()=>{
   const original=fetch;(globalThis as any).refinementCalls=[];
   globalThis.fetch=(async(input:any,init:any)=>{
    if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
    if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'local-text',input_modalities:['text','image']},{id:'local-alternate',input_modalities:['text','image']}]});
    const body=JSON.parse(init.body),planning=String(body.messages[0].content).includes('[P1:requirements-plan]');
    (globalThis as any).refinementCalls.push(body);
    if(planning)await new Promise<void>(resolve=>(globalThis as any).releaseRefinement=resolve);
    const content=planning?JSON.stringify({version:1,interpretedIntent:'生成页面',additionalSources:[],outputRequirements:[]}):'<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>风格样本</title></head><body><main><h1>风格样本</h1><p>已生成页面。</p></main></body></html>';
    return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   }) as typeof fetch;
  });
  await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_REFINEMENT_KEY'});
  let fetched=await command({type:'provider.fetch',expectedRevision:1});fetched=await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:fetched.view.provider.catalog.map((model:any)=>model.id)});await command({type:'provider.default',expectedRevision:fetched.view.provider.revision,modelId:'local-text'});
  await page.reload();await site.bringToFront();
  const configured=await command({type:'provider.query'});await command({type:'provider.default',expectedRevision:configured.view.provider.revision,modelId:'local-alternate'});await expect.poll(async()=>(await command({type:'workspace.query'})).view.draft.modelId).toBe('local-alternate');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:/角色设置/}).click();
  const scope=page.getByRole('switch',{name:'将当前角色应用到所有产物',exact:true});await expect(scope).toHaveAttribute('aria-checked','false');await scope.click();await expect(scope).toHaveAttribute('aria-checked','true');
  await page.getByRole('button',{name:/^返回/}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'模板工作流',exact:true}).click();
  await page.getByRole('button',{name:'风格管理',exact:true}).click();await page.getByRole('button',{name:'新建风格',exact:true}).click();
  const manager=page.getByRole('region',{name:'风格管理'});
  await expect(manager.locator('input')).toHaveCount(1);await expect(manager.locator('textarea')).toHaveCount(1);
  await page.getByLabel('风格名称',{exact:true}).fill('自定义纸张');await page.getByLabel('风格描述',{exact:true}).fill('STYLE_BROWSER_SENTINEL 米色纸张，清晰的黑色标题。');await page.getByRole('button',{name:'创建风格',exact:true}).click();
  await expect(manager.getByRole('status')).toContainText('风格已保存');
  await page.getByRole('button',{name:'返回风格列表',exact:true}).click();await page.getByRole('button',{name:/^返回问答/}).click();
  const input=page.getByLabel('输入草稿');
  await input.fill('!');const tools=page.locator('#mention-menu');await expect(tools).toContainText('截取当前画面');await expect(tools).not.toContainText('独立阅读文档');
  await tools.getByRole('button',{name:/^写随笔/}).click();await expect(page.getByRole('button',{name:'取消随笔'})).toBeVisible();await page.getByRole('button',{name:'取消随笔'}).click();
  await page.getByRole('button',{name:'更多输入操作'}).click();await expect(tools).toContainText('截取当前画面');await expect(tools).toContainText('独立阅读文档');await input.click();await input.fill('生成一页学习材料');
  await expect(page.locator('.model-pill')).toHaveCount(0);
  await page.getByRole('button',{name:'产物类型：Chat'}).click();await page.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();
  const styleMenu=page.getByRole('menu',{name:'HTML 页面风格'});await expect(styleMenu).toHaveCount(0);await page.getByRole('button',{name:/^HTML 风格：/}).click();await expect(styleMenu).toBeVisible();await styleMenu.getByRole('menuitemradio',{name:'自定义纸张',exact:true}).click();
  for(const width of [280,400]){await page.setViewportSize({width,height:850});await page.getByRole('button',{name:'HTML 风格：自定义纸张',exact:true}).click();await styleMenu.getByRole('menuitemradio',{name:'自定义纸张',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect.poll(()=>page.getByLabel('输入区').evaluate(element=>({left:element.getBoundingClientRect().left,scroll:element.parentElement!.scrollLeft}))).toMatchObject({scroll:0});expect((await page.getByLabel('输入区').boundingBox())!.x).toBeGreaterThanOrEqual(0);}
  await page.screenshot({path:test.info().outputPath('style-composer.png'),animations:'disabled'});
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.chat-turn.user').filter({hasText:'生成一页学习材料'})).toBeVisible({timeout:750});await expect(input).toHaveValue('');await expect(page.locator('.switch-notice')).toHaveCount(0);await expect(page.locator('.pending-generation')).toContainText('正在生成');
  await expect.poll(()=>worker.evaluate(()=>(globalThis as any).refinementCalls.length)).toBe(1);await worker.evaluate(()=>(globalThis as any).releaseRefinement());
  await expect.poll(()=>worker.evaluate(()=>(globalThis as any).refinementCalls.length)).toBe(2);
  await expect(page.getByRole('button',{name:'打开页面',exact:true}).last()).toBeVisible();await expect(page.locator('.chat-turn.user').filter({hasText:'生成一页学习材料'})).toHaveCount(1);await expect(page.locator('.pending-generation')).toHaveCount(0);
  const sent=await worker.evaluate(()=>(globalThis as any).refinementCalls[1]);expect(sent.model).toBe('local-alternate');expect(sent.messages.at(-1).content).toContain('P2 本次风格要求');expect(sent.messages.at(-1).content).toContain('STYLE_BROWSER_SENTINEL');
  await page.evaluate(()=>chrome.storage.local.set({'vcamp.accent':'#687fc1','vcamp.subtitleFontSize':20,'vcamp.libraryState':{scope:{kind:'folders'},selectedParts:{BVexperience:'2'}}}));
  const exported=await command({type:'library.backup.export'}),file=exported.view.library.backup.file;expect(file).not.toContain('SYNTHETIC_REFINEMENT_KEY');
  second=await setup();const target=second.page;
  await second.context.route('https://i0.hdslb.com/bfs/archive/fixture.png',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#687fc1"/></svg>'}));
  await target.getByRole('navigation').getByRole('button',{name:'资料库',exact:true}).click();await target.getByRole('button',{name:'存储管理',exact:true}).click();
  await target.getByLabel('选择备份文件',{exact:true}).setInputFiles({name:'isolated-backup.json',mimeType:'application/json',buffer:Buffer.from(file)});
  await expect(target.getByLabel('导入概览')).toContainText('风格版本');await target.getByRole('button',{name:'确认恢复备份',exact:true}).click();await expect(target.getByRole('status').filter({hasText:'备份恢复完成'})).toContainText('偏好已恢复');
  expect(await target.evaluate(()=>chrome.storage.local.get(['vcamp.accent','vcamp.roleAllOutputs','vcamp.libraryState']))).toMatchObject({'vcamp.accent':'#687fc1','vcamp.roleAllOutputs':true,'vcamp.libraryState':{scope:{kind:'folders'},selectedParts:{BVexperience:'2'}}});
  const restored=await target.evaluate(()=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'style.query'}}));expect(restored.view.styles.styles.some((style:any)=>style.name==='自定义纸张')).toBe(true);
  await expect.poll(()=>target.evaluate(()=>document.documentElement.style.getPropertyValue('--accent'))).toBe('#687fc1');await expect(target.locator('body')).not.toContainText('回收站');await target.screenshot({path:test.info().outputPath('restored-preferences.png'),animations:'disabled'});
  expect(first.forbidden).toEqual([]);expect(second.forbidden).toEqual([]);
 }finally{await second?.context.close();await context.close();}
});
