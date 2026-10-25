import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

test('a normal request cannot make the planner start video-frame capture',async()=>{
  test.setTimeout(60_000);
  const {context,page,site,worker,fixture}=await setup();
  try{
    await worker.evaluate(()=>{
      const original=fetch;(globalThis as any).normalVisionRequests=[];
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return new Response(JSON.stringify({object:'list',data:[{id:'local-vision',name:'Local vision',input_modalities:['text','image']}]}),{headers:{'content-type':'application/json'}});
        const body=JSON.parse(init.body),system=String(body.messages?.[0]?.content??''),kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'vision':'answer';
        (globalThis as any).normalVisionRequests.push({kind,body});
        const content=kind==='requirements'?JSON.stringify({version:1,interpretedIntent:'普通视频问答',additionalSources:[{source:'video_frames',reason:'模型自行认为画面有帮助'}],outputRequirements:[]}):'仅根据本次实际提供的资料回答。';
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    });
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_LOCAL_ONLY'})).ok).toBe(true);
    const fetched=await command({type:'provider.fetch',expectedRevision:1});
    expect((await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-vision']})).ok).toBe(true);
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    {const current=(await command({type:'workspace.query'})).view;fixture.workspaceId=current.workspaceId;fixture.chatId=current.chatId;}
    await page.getByLabel('输入草稿').fill('概括一下视频内容');await page.getByRole('button',{name:'发送',exact:true}).click();
    const query=async()=> (await command({type:'generation.query',target:{kind:'chat',workspaceId:fixture.workspaceId,chatId:fixture.chatId}})).view.generation;
    const submittedJob=(view:any)=>view.jobs.find((job:any)=>job.jobId===view.messages.find((m:any)=>m.role==='user'&&m.text==='概括一下视频内容')?.jobId);
    await expect.poll(async()=> submittedJob(await query())?.state??'not-started',{timeout:30_000}).toBe('completed');
    const requests=await worker.evaluate(()=>(globalThis as any).normalVisionRequests);
    expect(requests.map((request:any)=>request.kind)).toEqual(['requirements','answer']);
    expect(JSON.stringify(requests.at(-1).body.messages)).not.toContain('image_url');
    expect(submittedJob(await query()).visual).toBeUndefined();
    expect(requests[0].body.messages.at(-1).content).toContain('pluginDataCapabilities');
  }finally{await context.close();}
});

test('builtin knowledge note carries its task into autonomous vision and stores the frame-backed Markdown',async()=>{
  test.setTimeout(60_000);
  const {context,page,site,worker,fixture}=await setup();
  try{
    await worker.evaluate(()=>{
      const original=fetch;
      (globalThis as any).autovisionRequests=[];
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return new Response(JSON.stringify({object:'list',data:[{id:'local-vision',name:'Local vision',input_modalities:['text','image']}]}),{headers:{'content-type':'application/json'}});
        const body=JSON.parse(init.body),system=String(body.messages?.[0]?.content??'');
        const kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'vision':system.includes('[P1:vision-review]')?'review':system.includes('Markdown 笔记')?'markdown':'answer';
        (globalThis as any).autovisionRequests.push({kind,body});
        const content=kind==='requirements'
          ?JSON.stringify({version:1,interpretedIntent:'按独立阅读文档模板整理章节、结论和关键时间点，并在确有必要时读取原视频画面',additionalSources:[],outputRequirements:['Markdown 笔记','关键时间点']})
          :kind==='vision'
            ?JSON.stringify({version:3,scope:'focused',evidence:[{need:'读取关键时间点附近的实际画面',priority:'required',mode:'single',windows:[{cueIds:[0]}],detailNeed:'overview',readTargets:[],checkTargets:['画面主体'],reason:'按原字幕定位关键时间点'}],unresolved:[]})
            :kind==='review'?JSON.stringify({version:3,results:JSON.parse(body.messages[1].content[0].text).targets.map((t:any)=>({evidenceId:t.evidenceId,checks:t.checks.map((c:any)=>({checkId:c.checkId,status:'confirmed',imageRefs:t.imageRefs,observation:'本地模拟核验结果'})),refinements:[]}))})
            :'# 自主识别独立阅读文档\n\n已结合 00:01 附近的实际画面完成整理。';
        const data='data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';
        return new Response(data,{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    });
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_LOCAL_ONLY'})).ok).toBe(true);
    const fetched=await command({type:'provider.fetch',expectedRevision:1});
    expect((await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-vision']})).ok).toBe(true);
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();
    await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    {const current=(await command({type:'workspace.query'})).view;fixture.workspaceId=current.workspaceId;fixture.chatId=current.chatId;}
    await page.getByLabel('输入草稿').fill('@独立阅读文档');
    await page.locator('#mention-menu').getByRole('button',{name:'独立阅读文档',exact:true}).click();
    await expect(page.getByLabel('输入草稿')).toBeEditable();
    await page.getByRole('button',{name:'更多输入操作'}).click();
    await page.getByRole('button',{name:/^开启自主识别画面/}).click();
    await expect(page.getByRole('button',{name:'关闭自主识别画面',exact:true})).toBeVisible();
    {const current=(await command({type:'workspace.query'})).view;fixture.workspaceId=current.workspaceId;fixture.chatId=current.chatId;}
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'本请求自主画面识别'})).toHaveCount(0);
    const query=async()=>{const reply=await command({type:'generation.query',target:{kind:'chat',workspaceId:fixture.workspaceId,chatId:fixture.chatId}});if(!reply.ok)throw new Error(`generation.query: ${reply.code}`);return reply.view.generation;};
    await expect.poll(async()=> (await query()).jobs.at(-1)?.state??'not-started',{timeout:30_000}).toBe('completed');
    const requests=await worker.evaluate(()=>(globalThis as any).autovisionRequests);
    expect(requests.map((request:any)=>request.kind)).toEqual(['requirements','vision','review','markdown']);
    const visionText=JSON.stringify(requests[1].body.messages);
    expect(visionText).toContain('独立阅读文档');
    expect(visionText).toContain('关键时间点');
    expect(JSON.stringify(requests[2].body.messages)).toContain('image_url');
    const generation=await query(),job=generation.jobs.at(-1);
    expect(job.visual).toMatchObject({phase:'answering',resolution:'images',frozen:true});
    expect(job.visual.attachmentIds).toHaveLength(1);
    const inspection=(await command({type:'instructions.query',jobId:job.jobId,workspaceId:fixture.workspaceId,chatId:fixture.chatId})).view.instructions;
    expect(inspection.calls.map((call:any)=>call.stage)).toEqual(['requirements-plan','vision-plan','vision-review','markdown-output']);
    expect(inspection.calls.at(-1).images).toHaveLength(1);
    expect(inspection.images).toHaveLength(1);
    expect(inspection.images[0]).toMatchObject({id:job.visual.attachmentIds[0],sha256:inspection.calls.at(-1).images[0].sha256});
    expect(JSON.stringify(inspection.calls)).not.toContain('data:image/png;base64,');
    expect((await command({type:'instructions.query',jobId:job.jobId,workspaceId:'wrong-workspace',chatId:fixture.chatId})).ok).toBe(false);
    await expect(page.getByRole('button',{name:'打开笔记',exact:true})).toBeVisible();
    const artifacts=(await command({type:'artifact.query',workspaceId:fixture.workspaceId,sourceChatId:fixture.chatId})).view.artifacts.artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({type:'markdown',title:'自主识别独立阅读文档'});
  }finally{await context.close();}
});

test('enabled autonomous vision does not force a frame when planning returns no times',async()=>{
  test.setTimeout(60_000);
  const {context,page,site,worker,fixture}=await setup();
  try{
    await worker.evaluate(()=>{
      const original=fetch;
      (globalThis as any).authorizedVisionRequests=[];
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return new Response(JSON.stringify({object:'list',data:[{id:'local-vision',name:'Local vision',input_modalities:['text','image']}]}),{headers:{'content-type':'application/json'}});
        const body=JSON.parse(init.body),system=String(body.messages?.[0]?.content??'');
        const kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'vision':'answer';
        (globalThis as any).authorizedVisionRequests.push({kind,body});
        const content=kind==='requirements'
          ?JSON.stringify({version:1,interpretedIntent:'回答问题，并按授权读取原视频画面',additionalSources:[],outputRequirements:['简洁回答']})
          :kind==='vision'
            ?JSON.stringify({version:3,scope:'focused',evidence:[],unresolved:[]})
            :'字幕已经足够，本次没有额外读取画面。';
        const data='data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';
        return new Response(data,{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    });
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_LOCAL_ONLY'})).ok).toBe(true);
    const fetched=await command({type:'provider.fetch',expectedRevision:1});
    expect((await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-vision']})).ok).toBe(true);
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();
    await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    {const current=(await command({type:'workspace.query'})).view;fixture.workspaceId=current.workspaceId;fixture.chatId=current.chatId;}
    await page.getByRole('button',{name:'更多输入操作'}).click();
    await page.getByRole('button',{name:/^开启自主识别画面/}).click();
    await expect(page.getByRole('button',{name:'关闭自主识别画面',exact:true})).toBeVisible();
    {const current=(await command({type:'workspace.query'})).view;fixture.workspaceId=current.workspaceId;fixture.chatId=current.chatId;}
    await page.getByLabel('输入草稿').fill('这个画面表达了什么？');
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'本请求自主画面识别'})).toHaveCount(0);
    const query=async()=>{const reply=await command({type:'generation.query',target:{kind:'chat',workspaceId:fixture.workspaceId,chatId:fixture.chatId}});if(!reply.ok)throw new Error(`generation.query: ${reply.code}`);return reply.view.generation;};
    await expect.poll(async()=> (await query()).jobs.at(-1)?.state??'not-started',{timeout:30_000}).toBe('completed');
    const requests=await worker.evaluate(()=>(globalThis as any).authorizedVisionRequests);
    expect(requests.map((request:any)=>request.kind)).toEqual(['requirements','vision','answer']);
    expect(JSON.stringify(requests[2].body.messages)).not.toContain('image_url');
    const job=(await query()).jobs.at(-1);
    expect(job.visual).toMatchObject({phase:'answering',frozen:true,attachmentIds:[]});
  }finally{await context.close();}
});

test('an explicitly authorized no-subtitle video is answered from representative frames',async()=>{
  test.setTimeout(60_000);
  const {context,page,site,worker}=await setup();
  try{
    await worker.evaluate(()=>{
      const original=fetch;(globalThis as any).captionlessRequests=[];
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return new Response(JSON.stringify({object:'list',data:[{id:'local-vision',name:'Local vision',input_modalities:['text','image']}]}),{headers:{'content-type':'application/json'}});
        const body=JSON.parse(init.body),system=String(body.messages?.[0]?.content??''),kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-review]')?'review':'answer';
        (globalThis as any).captionlessRequests.push({kind,body});
        const content=kind==='requirements'?JSON.stringify({version:1,interpretedIntent:'根据实际画面辨别无字幕视频内容',additionalSources:[],outputRequirements:['说明可见内容与不确定性']}):kind==='review'?JSON.stringify({version:3,results:JSON.parse(body.messages[1].content[0].text).targets.map((t:any)=>({evidenceId:t.evidenceId,checks:t.checks.map((c:any)=>({checkId:c.checkId,status:'confirmed',imageRefs:t.imageRefs,observation:'本地模拟核验结果'})),refinements:[]}))}):'已根据代表画面辨别视频内容。';
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    });
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_LOCAL_ONLY'})).ok).toBe(true);
    const fetched=await command({type:'provider.fetch',expectedRevision:1});
    expect((await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-vision']})).ok).toBe(true);
    await site.goto('https://www.bilibili.com/video/BVnosub/?p=1');await site.bringToFront();
    await expect.poll(async()=>{const view=(await command({type:'workspace.query'})).view;return {title:view.title,status:view.video?.status};},{timeout:10_000}).toEqual({title:'无字幕视觉样本',status:'no-subtitles'});
    const current=(await command({type:'workspace.query'})).view,target={workspaceId:current.workspaceId,chatId:current.chatId};
    await page.getByRole('button',{name:'更多输入操作'}).click();
    await page.getByRole('button',{name:/^开启自主识别画面/}).click();
    await expect(page.getByRole('button',{name:'关闭自主识别画面',exact:true})).toBeVisible();
    await page.getByLabel('输入草稿').fill('这个无字幕视频的画面主要展示什么？');
    await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'本请求自主画面识别'})).toHaveCount(0);
    const query=async()=> (await command({type:'generation.query',target:{kind:'chat',...target}})).view.generation;
    await expect.poll(async()=> (await query()).jobs.at(-1)?.state??'not-started',{timeout:30_000}).toBe('completed');
    const requests=await worker.evaluate(()=>(globalThis as any).captionlessRequests);
    expect(requests.map((request:any)=>request.kind)).toEqual(['requirements','review','answer']);
    expect(JSON.stringify(requests.at(-1).body.messages)).toContain('image_url');
    expect((await query()).jobs.at(-1).visual.attachmentIds.length).toBeGreaterThan(0);
  }finally{await context.close();}
});
