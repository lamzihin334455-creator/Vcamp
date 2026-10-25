import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

for(const variant of ['shared','distinct'] as const)test(`valid ${variant} eight-item plan allocates whole groups and completes without subtitle fallback`,async()=>{
 test.setTimeout(60_000);
 const cues=Array.from({length:8},(_,i)=>({from:.6+i*.75,to:1+i*.75,content:`画面依据 ${i}`}));
 const {context,page,site,worker,fixture,forbidden}=await setup({mediaPath:'tests/fixtures/t02-synthetic.mp4',cues,title:'槽位分配回归',relayOrigin:'https://unused-fixture.test'});
 try{
  await worker.evaluate(variant=>{
   const original=fetch;(globalThis as any).slotCalls=[];
   globalThis.fetch=(async(input:any,init:any)=>{
    if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
    if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'local-vision',input_modalities:['text','image']}]});
    const body=JSON.parse(init.body),system=String(body.messages[0].content),kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'vision':system.includes('[P1:vision-review]')?'review':'final';
    (globalThis as any).slotCalls.push({kind,images:body.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((p:any)=>p.type==='image_url').length,maxTokens:body.max_tokens});
    const content=kind==='requirements'?JSON.stringify({version:1,interpretedIntent:'结合实际画面整理笔记',additionalSources:[],outputRequirements:[]})
     :kind==='vision'?JSON.stringify({version:3,scope:'whole-video',evidence:Array.from({length:8},(_,i)=>({need:`检查画面主体 ${i}`,priority:i===7?'optional':'required',mode:'single',windows:[variant==='shared'?{cueIds:[0]}:{from:.6+i*.75,to:1+i*.75,anchor:.8+i*.75,basis:'explore'}],detailNeed:'overview',checkTargets:[`主体 ${i}`],reason:variant==='shared'?'同一字幕定位多个核验需求':'全片不同位置的代表性探查'})),unresolved:[]})
     :kind==='review'?JSON.stringify({version:3,results:JSON.parse(body.messages[1].content[0].text).targets.map((t:any)=>({evidenceId:t.evidenceId,checks:t.checks.map((c:any)=>({checkId:c.checkId,status:'confirmed',imageRefs:t.imageRefs,observation:'合成画面主体可见'})),refinements:[]}))})
     :'# 正常完成的笔记\n\n按实际提供的画面与字幕整理；未覆盖需求保留缺口。';
    return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   }) as typeof fetch;
  },variant);
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_SLOT_ALLOCATION'})).ok).toBe(true);
  let fetched=await command({type:'provider.fetch',expectedRevision:1});fetched=await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:fetched.view.provider.catalog.map((model:any)=>model.id)});
  await command({type:'provider.default',expectedRevision:fetched.view.provider.revision,modelId:'local-vision'});
  await page.reload();await site.bringToFront();
  await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
  await expect(page.getByTestId('startup')).toHaveCount(0);
  await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
  await page.getByLabel('输入草稿').fill('@知识笔记');
  await page.locator('#mention-menu').getByRole('button',{name:'知识笔记',exact:true}).click();
  await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();
  const space=(await command({type:'workspace.query'})).view;fixture.workspaceId=space.workspaceId;fixture.chatId=space.chatId;
  const target={kind:'chat',workspaceId:space.workspaceId,chatId:space.chatId};
  const query=async()=>(await command({type:'generation.query',target})).view.generation.jobs.at(-1);
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=>{const job=await query();return job&&['failed','awaiting-permission','completed'].includes(job.state)?job.state:'running';},{timeout:30_000}).not.toBe('running');
  const completed=await query(),calls=await worker.evaluate(()=>(globalThis as any).slotCalls);
  await writeFile(test.info().outputPath('slot-audit.json'),JSON.stringify({variant,state:completed.state,visual:completed.visual,calls,paidModelCalls:0},null,2));
  if(completed.state!=='completed')await page.screenshot({path:test.info().outputPath('slot-failure.png')});
  expect(completed.state).toBe('completed');
  expect(calls.map((call:any)=>call.kind)).toEqual(['requirements','vision','review','final']);
  expect(completed.visual).toMatchObject({phase:'answering',resolution:'images',frozen:true,review:{status:'complete'}});
  expect(completed.visual.planningFailure).toBeUndefined();expect(completed.visual.planningCorrection).toBeUndefined();
  expect(completed.visual.audit.slots).toHaveLength(variant==='shared'?1:6);
  expect(completed.visual.attachmentIds.length).toBeGreaterThan(0);
  if(variant==='shared'){expect(completed.visual.audit.slots[0].evidenceIds).toHaveLength(8);expect(completed.visual.audit.unresolved.some((text:string)=>text.includes('整组证据超出'))).toBe(false);}
  else expect(completed.visual.audit.unresolved.filter((text:string)=>text.includes('整组证据超出'))).toHaveLength(2);
  await expect(page.getByRole('button',{name:'仅用字幕继续',exact:true})).toHaveCount(0);
  const saved=(await command({type:'artifact.query',workspaceId:space.workspaceId,sourceChatId:space.chatId})).view.artifacts.artifacts;
  expect(saved).toHaveLength(1);expect(saved[0].title).toBe('正常完成的笔记');
  await page.getByRole('button',{name:'打开笔记',exact:true}).click();await expect(page.getByRole('heading',{name:'正常完成的笔记',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('slot-completed.png')});
  expect(forbidden).toEqual([]);
 }finally{await context.close();}
});
