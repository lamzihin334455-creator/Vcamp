import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

for(const output of ['markdown','html'] as const)test(`autonomous ${output} preserves long output, increased stage budgets and frozen-image retry`,async()=>{
 test.setTimeout(90_000);
 const {context,page,site,worker,fixture,forbidden}=await setup();
 try{
  await worker.evaluate(output=>{
   const original=fetch;(globalThis as any).budgetCalls=[];(globalThis as any).budgetFinalMode='length';
   (globalThis as any).expectedOutput=output==='markdown'?'# 扩容后的知识笔记\n\n'+('完整画面与字幕依据。\n'.repeat(4000)):'<!doctype html><html><head><title>扩容后的学习页</title></head><body><h1>扩容后的学习页</h1><button onclick="this.textContent=\'已展开\'">展开</button>'+('<p>完整画面与字幕依据。</p>'.repeat(5000))+'</body></html>';
   globalThis.fetch=(async(input:any,init:any)=>{
    if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
    if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'local-vision',input_modalities:['text','image']}]});
    const body=JSON.parse(init.body),system=String(body.messages[0].content),kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'vision':system.includes('[P1:vision-review]')?'review':'final';
    const needed=kind==='vision'?6000:kind==='review'?12000:kind==='final'?(output==='markdown'?20000:48000):200;
    const finish=body.max_tokens<needed||kind==='final'&&(globalThis as any).budgetFinalMode==='length'?'length':'stop';
    (globalThis as any).budgetCalls.push({kind,maxTokens:body.max_tokens,images:body.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((p:any)=>p.type==='image_url').length,finish});
    let content=kind==='requirements'?JSON.stringify({version:1,interpretedIntent:'整理完整学习产物',additionalSources:[],outputRequirements:[]}):kind==='vision'?JSON.stringify({version:3,scope:'focused',evidence:[{need:'核对实际画面主体',priority:'required',mode:'single',windows:[{cueIds:[0]}],detailNeed:'overview',checkTargets:['画面主体'],reason:'字幕定位实际画面'}],unresolved:[]}):kind==='review'?JSON.stringify({version:3,results:JSON.parse(body.messages[1].content[0].text).targets.map((t:any)=>({evidenceId:t.evidenceId,checks:t.checks.map((c:any)=>({checkId:c.checkId,status:'confirmed',imageRefs:t.imageRefs,observation:'受控图像核验已完成'})),refinements:[]}))}):(globalThis as any).expectedOutput;
    if(finish==='length')content=content.slice(0,500);
    const events=content.match(/[\s\S]{1,4000}/g)!.map((content:string)=>'data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:null}]})+'\n\n').join('');
    return new Response(events+'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:finish}],usage:{completion_tokens:finish==='stop'?needed:body.max_tokens}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   }) as typeof fetch;
  },output);
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_AUTOVISION_BUDGET'})).ok).toBe(true);
  let fetched=await command({type:'provider.fetch',expectedRevision:1});fetched=await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:fetched.view.provider.catalog.map((model:any)=>model.id)});
  await command({type:'provider.default',expectedRevision:fetched.view.provider.revision,modelId:'local-vision'});
  await page.reload();await site.bringToFront();
  await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
  await expect(page.getByTestId('startup')).toHaveCount(0);
  const previousChat=(await command({type:'workspace.query'})).view.chatId;
  await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
  await expect.poll(async()=>(await command({type:'workspace.query'})).view.chatId).not.toBe(previousChat);
  await page.getByLabel('输入草稿').fill(output==='markdown'?'@知识笔记':'@交互学习页');
  await page.locator('#mention-menu').getByRole('button',{name:output==='markdown'?'知识笔记':'交互学习页',exact:true}).click();
  await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();
  const space=(await command({type:'workspace.query'})).view;fixture.workspaceId=space.workspaceId;fixture.chatId=space.chatId;
  const target={kind:'chat',workspaceId:space.workspaceId,chatId:space.chatId};
  const query=async()=>(await command({type:'generation.query',target})).view.generation.jobs.at(-1);
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=>(await query())?.state,{timeout:30_000}).toBe('failed');
  const failed=await query();expect(failed.error).toBe('output-limit');
  expect(failed.visual).toMatchObject({phase:'answering',frozen:true,review:{status:'complete'}});
  expect(failed.diagnostics.at(-1)).toMatchObject({cause:'service-length'});
  const listing=async()=>output==='markdown'?(await command({type:'artifact.query',workspaceId:space.workspaceId,sourceChatId:space.chatId})).view.artifacts.artifacts:(await command({type:'knowledge.query',workspaceId:space.workspaceId})).view.knowledge.artifacts.filter((a:any)=>a.sourceChatId===space.chatId);
  expect(await listing()).toHaveLength(0);
  await worker.evaluate(()=>(globalThis as any).budgetFinalMode='complete');
  expect((await command({type:'generation.retry',jobId:failed.jobId})).ok).toBe(true);
  await expect.poll(async()=>(await query())?.state,{timeout:30_000}).toBe('completed');
  const completed=await query(),saved=await listing();expect(saved).toHaveLength(1);
  expect(saved[0][output==='markdown'?'content':'source']).toBe(await worker.evaluate(()=>(globalThis as any).expectedOutput));
  expect(completed.visual.attachmentIds).toEqual(failed.visual.attachmentIds);
  const calls=await worker.evaluate(()=>(globalThis as any).budgetCalls);
  expect(calls.map((c:any)=>c.kind)).toEqual(['requirements','vision','review','final','final']);
  expect(calls.map((c:any)=>c.maxTokens)).toEqual([768,8192,16384,393216,393216]);
  expect(calls.slice(2).every((c:any)=>c.images===1)).toBe(true);
  expect(completed.visual.audit.budget).toMatchObject({tokenCeiling:8388608,finalOutputReserved:393216});
  await page.getByRole('button',{name:output==='markdown'?'打开笔记':'打开页面',exact:true}).click();
  if(output==='html'){
   const content=page.frameLocator('.html-page-frame').frameLocator('iframe');
   await content.getByRole('button',{name:'展开',exact:true}).click();await expect(content.getByRole('button',{name:'已展开',exact:true})).toBeVisible();
  }else await expect(page.getByRole('heading',{name:'扩容后的知识笔记',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('expanded-budget.png')});
  await page.reload();await expect(page.getByRole('button',{name:'切换当前内容'})).toBeVisible();
  expect((await listing())[0][output==='markdown'?'content':'source']).toBe(await worker.evaluate(()=>(globalThis as any).expectedOutput));
  expect(forbidden).toEqual([]);
  await writeFile(test.info().outputPath('budget-audit.json'),JSON.stringify({output,calls,chars:saved[0][output==='markdown'?'content':'source'].length,budget:completed.visual.audit.budget,exactSource:true,retryReusedImages:true,reloaded:true,realPaidModelCalls:0},null,2));
 }finally{await context.close();}
});
