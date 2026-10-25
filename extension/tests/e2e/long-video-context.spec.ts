import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

for(const autonomous of [false,true])test(`long native subtitles answer in full with autonomous=${autonomous}`,async()=>{
 test.setTimeout(90_000);
 // Dense short media drives the real browser/worker transport and cue-count
 // boundary; the unit suite separately validates a 24-hour source timeline.
 const cues=Array.from({length:21001},(_,i)=>({from:i/4000,to:i/4000+.001,content:`长字幕第${i}条。`}));
 const {context,page,site,worker,fixture,forbidden}=await setup({mediaPath:'tests/fixtures/t02-synthetic.mp4',cues,title:'完整长字幕输入回归',relayOrigin:'https://unused-fixture.test'});
 try{
  await worker.evaluate(()=>{
   const original=fetch;(globalThis as any).longCalls=[];
   globalThis.fetch=(async(input:any,init:any)=>{
    if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
    if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'local-vision',input_modalities:['text','image']}]});
    const body=JSON.parse(init.body),system=String(body.messages[0].content),kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'vision':'final';
    const payload=body.messages.map((m:any)=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
    const sourceText:string=kind==='final'?JSON.parse(body.messages[1].content.split('\n').slice(1).join('\n')).subtitle.content:payload;
    const cueIds=[...sourceText.matchAll(/长字幕第(\d+)条。/g)].map(m=>Number(m[1]));
    (globalThis as any).longCalls.push({kind,chars:payload.length,cueCount:cueIds.length,allCuesInOrder:cueIds.every((id,index)=>id===index),hasTail:sourceText.includes('长字幕第21000条。'),maxTokens:body.max_tokens});
    const content=kind==='requirements'?JSON.stringify({version:1,interpretedIntent:'根据完整字幕解释末尾内容',additionalSources:[],outputRequirements:[]})
     :kind==='vision'?JSON.stringify({version:3,scope:'whole-video',evidence:[],unresolved:[]})
     :'已收到完整的 21001 条字幕，最后一条为：长字幕第21000条。';
    return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   }) as typeof fetch;
  });
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_LONG_CONTEXT_KEY'})).ok).toBe(true);
  const fetched=await command({type:'provider.fetch',expectedRevision:1});await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-vision']});
  await site.goto('https://www.bilibili.com/video/BVlongcontext/?p=1');await site.bringToFront();
  await expect.poll(async()=>(await command({type:'workspace.query'})).view.video?.cues.length,{timeout:15_000}).toBe(21001);
  await page.reload();await expect(page.getByLabel('输入草稿')).toBeEditable();
  if(autonomous){await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();}
  const space=(await command({type:'workspace.query'})).view;fixture.workspaceId=space.workspaceId;fixture.chatId=space.chatId;
  const target={kind:'chat',workspaceId:space.workspaceId,chatId:space.chatId};
  const query=async()=>(await command({type:'generation.query',target})).view.generation;
  await page.getByLabel('输入草稿').fill('视频最后一条字幕说了什么？');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=>(await query()).jobs.at(-1)?.state??'not-started',{timeout:30_000}).toBe('completed');
  const generation=await query(),job=generation.jobs.at(-1),calls=await worker.evaluate(()=>(globalThis as any).longCalls);
  expect(calls.map((call:any)=>call.kind)).toEqual(autonomous?['requirements','vision','final']:['requirements','final']);
  for(const call of calls.filter((call:any)=>call.kind!=='requirements'))expect(call).toMatchObject({cueCount:21001,allCuesInOrder:true,hasTail:true});
  expect(calls.at(-1).chars).toBeGreaterThan(60000);expect(job.coverage.total).toBeGreaterThan(16);expect(job.coverage.covered).toBe(job.coverage.total);
  expect(job.coverage.ranges.at(-1).lastCue).toBe(21000);expect(generation.messages.at(-1).text).toContain('长字幕第21000条。');
  await expect(page.getByText('已收到完整的 21001 条字幕，最后一条为：长字幕第21000条。',{exact:true})).toBeVisible();
  await writeFile(test.info().outputPath('long-context-audit.json'),JSON.stringify({autonomous,calls,coverage:job.coverage,paidModelCalls:0},null,2));
  await page.screenshot({path:test.info().outputPath('long-context-completed.png'),animations:'disabled'});
  expect(forbidden).toEqual([]);
 }finally{await context.close();}
});
