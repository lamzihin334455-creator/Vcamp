import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setup} from './interaction-fixture';

for(const termsResponse of ['recorded','user-failure'] as const)test(`installed executor saves every cue with ${termsResponse} terms and captured paid responses`,async()=>{
 test.skip(!process.env.SUBTITLE_LIVE_REPLAY,'Explicit local captured-response fixture required; never calls an API.');test.setTimeout(90000);
 const directory=resolve(process.env.SUBTITLE_LIVE_REPLAY!),input=JSON.parse(await readFile(resolve(directory,'input.json'),'utf8'));
 const ledger=JSON.parse(await readFile(resolve(directory,'call-ledger.json'),'utf8'));
 const replies=await Promise.all(ledger.requests.map(async(row:any)=>{
  const request=JSON.parse(await readFile(resolve(directory,`${row.id}.request.json`),'utf8'));let payload:any;try{payload=JSON.parse(request.messages?.[1]?.content);}catch{}
  return {id:row.id,kind:request.query?'search':payload?.stage??(String(request.messages?.[0]?.content).includes('P1:web-query')?'query':'batch'),first:payload?.cues?.[0]?.index,body:await readFile(resolve(directory,`${row.id}.response.txt`),'utf8'),contentType:row.contentType};
 }));
 if(termsResponse==='user-failure'){
  const terms=JSON.parse(await readFile(resolve('tests/fixtures/subtitle-empty-variants.json'),'utf8'));
  const reviewed=JSON.parse(await readFile(resolve('tests/fixtures/subtitle-empty-variants-reviewed.json'),'utf8'));
  // The user's failed precheck has different candidates from our paid run.
  // Use an explicit compatible review fixture, including empty variants;
  // search and all six batch replies still use the original paid recordings.
  for(const [kind,value] of [['terms',terms],['reconcile',reviewed]] as const){
   replies.find(row=>row.kind===kind)!.body='data: '+JSON.stringify({choices:[{index:0,delta:{content:JSON.stringify(value)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';
  }
 }
 const {context,page,worker,fixture}=await setup({mediaPath:'tests/fixtures/t02-synthetic.mp4',cues:input.cues,title:input.title,relayOrigin:'https://unused-fixture.test'});
 try{
  await worker.evaluate(replies=>{
   const original=fetch;(globalThis as any).replayCalls=[];
   globalThis.fetch=(async(url:any,init:any)=>{
    if(!String(url).startsWith('https://api.deepseek.com/'))return original(url,init);
    if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'deepseek-flash'}]});
    const request=JSON.parse(init.body);let payload:any;try{payload=JSON.parse(request.messages?.[1]?.content);}catch{}
    const kind=String(url).endsWith('/search')?'search':payload?.stage??(String(request.messages?.[0]?.content).includes('P1:web-query')?'query':'batch');
    if(request.messages?.length>2)throw Error('A valid recorded response must not need protocol repair');
    if(kind==='correction-review'){
     // This NEW review stage uses an explicit conservative fixture, not a paid
     // recording or a claim that model judgment has been tested live.
     const safe=new Set(['deep sick=>DeepSeek','DEPC=>DeepSeek','DEPSK=>DeepSeek','cloud=>Claude','ATHROPIC=>Anthropic','OHGBT=>GPT','制=>智','征留=>蒸馏']);
     (globalThis as any).replayCalls.push('review-fixture');
     const content=JSON.stringify({approved:payload.edits.filter((edit:any)=>safe.has(edit.from+'=>'+edit.to)).map((edit:any)=>edit.id)});
     return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    }
    const reply=replies.find(row=>row.kind===kind&&(kind!=='batch'||row.first===payload.cues[0].index));
    if(!reply)throw Error(`No recorded response for ${kind}`);
    (globalThis as any).replayCalls.push(reply.id);
    return new Response(reply.body,{headers:{'content-type':reply.contentType}});
   }) as typeof fetch;
  },replies);
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_REPLAY_KEY'});const provider=await command({type:'provider.fetch',expectedRevision:1});await command({type:'provider.default',expectedRevision:provider.view.provider.revision,modelId:'deepseek-flash'});
  const subtitle=(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles;
  await command({type:'subtitles.source.select',workspaceId:fixture.workspaceId,expectedRevision:subtitle.sourceRevision,source:{kind:'native',language:'zh-CN'}});
  await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:15000});await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();await page.getByRole('button',{name:'字幕设置',exact:true}).click();await page.getByRole('button',{name:'AI 字幕修正',exact:true}).click();
  const status=page.getByRole('region',{name:'AI 修正进度'});await expect(status).toContainText('修正完成',{timeout:45000});const jobId=await status.getAttribute('data-translation-job-id');
  const view=(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles,cues=view.versions.find((v:any)=>v.jobId===jobId)?.cues;
  expect(cues).toHaveLength(input.cues.length);expect(cues.every((cue:any,index:number)=>cue.from===input.cues[index].from&&cue.to===input.cues[index].to)).toBe(true);
  for(const index of [0,1,3,105,109,114,115,116,117,257,362,379])expect(cues[index].content).toBe(input.cues[index].content);
  const jobs=(await command({type:'generation.query',target:{kind:'subtitle',workspaceId:fixture.workspaceId,operation:'enhance'}})).view.generation.jobs;
  const job=jobs.find((row:any)=>row.jobId===jobId);expect(job.state).toBe('completed');expect(job.coverage.covered).toBe(job.coverage.total);
  const calls=await worker.evaluate(()=>(globalThis as any).replayCalls);
  expect(calls.filter((id:string)=>id!=='review-fixture')).toEqual(ledger.requests.map((row:any)=>row.id));
  expect(calls.filter((id:string)=>id==='review-fixture').length).toBeGreaterThan(0);
  await status.getByRole('button',{name:'查看修正版',exact:true}).click();await expect(status).toHaveCount(0);await page.screenshot({path:test.info().outputPath('real-video-replayed-complete.png'),animations:'disabled'});
 }finally{await context.close();}
});
