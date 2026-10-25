import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

test('correction searches names, shares translation feedback, and changes the main track only on view',async()=>{
 test.setTimeout(60_000);
 const {context,page,worker,fixture,forbidden}=await setup({mediaPath:'tests/fixtures/t02-synthetic.mp4',cues:Array.from({length:481},(_,i)=>({from:i/100,to:i/100+.009,content:'小梁说 remousion 就是就是可以制作动画。'})),title:'用 Remotion 制作动画',relayOrigin:'https://unused-fixture.test'});
 try{
  await worker.evaluate(()=>{
   const original=fetch;(globalThis as any).qualityCalls=[];
   globalThis.fetch=(async(input:any,init:any)=>{
    if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
    if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'deepseek-flash'}]});
    const body=JSON.parse(init.body);
    if(String(input).endsWith('/v1/tools/search')){(globalThis as any).qualityCalls.push('search');return Response.json({results:[{url:'https://www.remotion.dev/',title:'Remotion',summary:'Remotion 官方文档'}]});}
    const system=String(body.messages[0].content),payload=JSON.parse(body.messages[1].content.startsWith('用户资料')?body.messages[1].content.slice(body.messages[1].content.indexOf('：')+1):body.messages[1].content);
    let content:string;
    if(system.includes('[P1:web-query]')){(globalThis as any).qualityCalls.push('query');content=JSON.stringify({query:'Remotion 动画'});}
    else if(payload.stage==='correction-review'){(globalThis as any).qualityCalls.push(payload.stage);if(!payload.context.every((row:any)=>row.content.includes('小梁说 remousion 就是就是')))throw new Error('Review source was rewritten');content=JSON.stringify({approved:payload.edits.map((edit:any)=>edit.id)});}
    else if(payload.stage){(globalThis as any).qualityCalls.push(payload.stage);if(payload.stage==='reconcile'&&!payload.webMaterial.includes('remotion.dev'))throw new Error('Missing actual search material');content='```json\n'+JSON.stringify({terms:[payload.stage==='terms'?{canonical:'remousion',variants:['remousion']}:{canonical:'Remotion',variants:['remousion','Remotion']}]})+'\n```';}
    else{(globalThis as any).qualityCalls.push('process');if(!payload.cues.every((cue:any)=>cue.content==='小梁说 remousion 就是就是可以制作动画。'))throw new Error('Batch source was rewritten');if(payload.cues[0].index===0&&body.messages.length===2){await new Promise<void>(resolve=>(globalThis as any).releaseQuality=resolve);content='{"changes":[';}else content=JSON.stringify({changes:payload.cues.map((cue:any)=>({index:cue.index,content:'梁文锋说 Remotion 就是可以制作动画。'}))});}
    return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   }) as typeof fetch;
  });
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_QUALITY_KEY'});const provider=await command({type:'provider.fetch',expectedRevision:1});await command({type:'provider.import-models',expectedRevision:provider.view.provider.revision,modelIds:['deepseek-flash']});
  const source=(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles;
  await command({type:'subtitles.source.select',workspaceId:fixture.workspaceId,expectedRevision:source.sourceRevision,source:{kind:'native',language:'zh-CN'}});
  const original=(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles.analysisSource;
  await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:15000});await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();await page.getByRole('button',{name:'字幕设置',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'联网核对专有名词、人名和产品名称'})).toBeChecked();await page.getByRole('button',{name:'AI 字幕修正',exact:true}).click();
  const status=page.getByRole('region',{name:'AI 修正进度'});await expect(status).toBeVisible();await expect(page.getByRole('dialog',{name:'字幕设置'})).toHaveCount(0);
  await expect.poll(()=>worker.evaluate(()=>(globalThis as any).qualityCalls)).toContain('process');await expect(status).toContainText('正在修正字幕');
  const jobId=await status.getAttribute('data-translation-job-id');
  await worker.evaluate(()=>(globalThis as any).releaseQuality());await expect(status).toContainText('修正完成');await expect(status.getByRole('button',{name:'查看修正版',exact:true})).toBeVisible();
  expect((await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles.analysisSource).toEqual(original);await expect(page.getByLabel('字幕时间轴')).toContainText('remousion');
  await page.screenshot({path:test.info().outputPath('correction-completed.png'),animations:'disabled'});
  await status.getByRole('button',{name:'查看修正版',exact:true}).click();await expect(page.getByLabel('字幕时间轴')).toContainText('Remotion');await expect(status).toHaveCount(0);
  const view=(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles,cues=view.versions.find((version:any)=>version.jobId===jobId).cues;expect(cues).toHaveLength(481);expect([...new Set(cues.map((cue:any)=>cue.content))]).toEqual(['小梁说 Remotion 就是就是可以制作动画。']);
  const jobs=(await command({type:'generation.query',target:{kind:'subtitle',workspaceId:fixture.workspaceId,operation:'enhance'}})).view.generation.jobs;expect(jobs.find((job:any)=>job.jobId===jobId).webEvidence.sources[0].uri).toBe('https://www.remotion.dev/');
  const inspection=(await command({type:'instructions.query',jobId,workspaceId:fixture.workspaceId})).view.instructions;
  expect(inspection.calls.some((call:any)=>call.stage==='subtitle-correction-review')).toBe(true);
  expect((await worker.evaluate(()=>(globalThis as any).qualityCalls)).filter((kind:string)=>kind==='search')).toHaveLength(1);expect(forbidden).toEqual([]);
 }finally{await context.close();}
});
