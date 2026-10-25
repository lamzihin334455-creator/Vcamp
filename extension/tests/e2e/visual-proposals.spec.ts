import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

for(const mode of ['mixed','required'] as const)test(`excess review suggestions: ${mode} keeps findings and bounds actual repairs`,async({},testInfo)=>{
  test.setTimeout(60_000);
  const {context,page,site,worker,forbidden}=await setup({mediaPath:'tests/fixtures/visual-proposals.mp4',relayOrigin:'http://127.0.0.1:1',title:'补图建议本地回归',cues:[{from:1.3,to:1.8,content:'第一处静态布局'},{from:2.30,to:2.39,content:'第二处静态布局'},{from:2.8,to:3.3,content:'第三处静态布局'}]});
  try{
    await worker.evaluate(mode=>{
      const original=fetch;(globalThis as any).proposalRequests=[];
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return new Response(JSON.stringify({object:'list',data:[{id:'local-vision',name:'Local vision',input_modalities:['text','image']}]}),{headers:{'content-type':'application/json'}});
        const body=JSON.parse(init.body),system=String(body.messages[0].content),kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'plan':system.includes('[P1:vision-review]')?'review':'answer';
        (globalThis as any).proposalRequests.push({kind,body});
        let content='本地模拟回答：保留无法确定的画面缺口。';
        if(kind==='requirements')content=JSON.stringify({version:1,interpretedIntent:'核对三处静态布局',additionalSources:[],outputRequirements:['保留未确认项']});
        if(kind==='plan')content=JSON.stringify({version:2,scope:'focused',needsNewFrames:true,unresolved:[],evidence:[
          {id:'e1',window:{from:1.3,to:1.8,anchor:1.55}},
          {id:'e2',window:{from:2.30,to:2.39,anchor:2.345}},
          {id:'e3',window:{from:2.8,to:3.3,anchor:3.05}}
        ].map((e,i)=>({id:e.id,need:`静态布局 ${i+1}`,priority:mode==='mixed'&&i===2?'optional':'required',mode:'single',reuseAttachmentIds:[],windows:[{...e.window,cueIds:[i],basis:'subtitle'}],detailNeed:mode==='mixed'&&i>0?'read-text':'overview',checkTargets:['主布局'],readTargets:[],reason:'核对该处布局'}))});
        if(kind==='review'){
          await new Promise<void>(resolve=>{(globalThis as any).releaseProposalReview=resolve;});
          const input=JSON.parse(body.messages[1].content[0].text);
          content=JSON.stringify({version:3,results:input.targets.map((t:any,i:number)=>({evidenceId:t.evidenceId,checks:[{checkId:'c0',status:'uncertain',imageRefs:t.imageRefs,observation:'本地模拟：布局细节无法确定'}],refinements:[{slotKey:t.slots[0].slotKey,cueIds:[i===0&&mode==='mixed'?1:i],checkIds:['c0'],reason:'核对相关时间的布局细节'}]}))});
        }
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:60,total_tokens:180}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    },mode);
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    const initial=(await command({type:'workspace.query'})).view;
    const subtitles=(await command({type:'subtitles.query',workspaceId:initial.workspaceId})).view.subtitles;
    expect((await command({type:'subtitles.source.select',workspaceId:initial.workspaceId,source:{kind:'native',language:'zh-CN'},expectedRevision:subtitles.sourceRevision})).ok).toBe(true);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_LOCAL_ONLY'})).ok).toBe(true);
    const fetched=await command({type:'provider.fetch',expectedRevision:1});
    expect(fetched.ok).toBe(true);
    expect((await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-vision']})).ok).toBe(true);
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();
    const current=(await command({type:'workspace.query'})).view,target={kind:'chat',workspaceId:current.workspaceId,chatId:current.chatId},input=`核对三处布局 ${mode}`;
    await page.getByLabel('输入草稿').fill(input);await page.getByRole('button',{name:'发送',exact:true}).click();
    const query=async()=>{const g=(await command({type:'generation.query',target})).view.generation;return g.jobs.find((j:any)=>j.jobId===g.messages.find((m:any)=>m.role==='user'&&m.text===input)?.jobId);};
    await expect.poll(async()=>(await query())?.visual?.phase,{timeout:20_000}).toMatch(/^(checking|permission)$/);
    await writeFile(testInfo.outputPath('before-review.json'),JSON.stringify(await query(),null,2));
    expect((await query()).visual.phase).toBe('checking');
    const before=await query();expect(before.visual.attachmentIds).toHaveLength(3);
    expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(.5,1);
    await worker.evaluate(()=>(globalThis as any).releaseProposalReview());
    await expect.poll(async()=>(await query()).state,{timeout:20_000}).toBe('completed');
    const checked=(await query()).visual.review;
    expect(checked.status).toBe('complete');expect(checked.correction).toBeUndefined();
    expect(checked.results).toHaveLength(3);expect(checked.results.every((r:any)=>r.checks[0].status==='uncertain')).toBe(true);
    expect(checked.repairs.map((r:any)=>r.slotKey)).toEqual(mode==='mixed'?['e1_0']:['e1_0','e2_0']);
    await expect(page.getByRole('button',{name:'授权补充画面',exact:true})).toHaveCount(0);
    await expect.poll(async()=>(await query()).state,{timeout:25_000}).toBe('completed');
    const job=await query(),requests=await worker.evaluate(()=>(globalThis as any).proposalRequests);
    expect(requests.map((r:any)=>r.kind)).toEqual(['requirements','plan','review','answer']);
    expect(job.visual.review.results).toEqual(checked.results);
    expect(job.visual.review.repairs.every((r:any)=>r.state==='captured-unverified')).toBe(true);
    const delivered=await command({type:'attachment.read',target:{workspaceId:target.workspaceId,chatId:target.chatId},ids:job.visual.attachmentIds});
    expect(delivered.ok).toBe(true);
    const finalImages=requests.at(-1).body.messages.flatMap((m:any)=>typeof m.content==='string'?[]:m.content).filter((p:any)=>p.type==='image_url').map((p:any)=>p.image_url.url);
    expect(new Set(finalImages)).toEqual(new Set(delivered.view.attachment.images.map((i:any)=>i.dataUrl)));
    expect(JSON.stringify(requests.at(-1).body.messages)).toContain('uncertain');
    expect(job.visual.audit.budget.captures).toBeLessThanOrEqual(18);
    expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(.5,1);
    // The fixture blocks the normal public metadata fallback as well as all
    // unmocked traffic; no real API or other network request may escape.
    const unexpected=forbidden.filter(url=>url!=='https://api.bilibili.com/x/web-interface/view?bvid=BVexperience');
    expect(unexpected).toEqual([]);
    await page.reload();await site.bringToFront();await expect(page.getByTestId('startup')).toHaveCount(0);
    expect((await query()).visual.review).toEqual(job.visual.review);
    await page.setViewportSize({width:600,height:1600});await page.locator('.visual-evidence > summary').click();
    await expect(page.locator('.visual-evidence')).not.toContainText('核验响应未通过校验');
    await expect(page.locator('.visual-evidence')).toContainText('主布局：无法确定');
    await expect(page.locator('.visual-evidence')).not.toContainText(/补帧|补图|补前/);
    await page.locator('.visual-evidence').screenshot({path:testInfo.outputPath(`${mode}-audit.png`)});
    await writeFile(testInfo.outputPath('audit.json'),JSON.stringify({mode,state:job.state,visual:job.visual,requestKinds:requests.map((r:any)=>r.kind),realPaidModelCalls:0,usageIsMocked:true,blockedRequests:forbidden,unexpectedRequests:unexpected},null,2));
  }finally{await context.close();}
});
