import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';
import {writeFile} from 'node:fs/promises';

// A synthetic invalid plan exercises the real stream -> validation -> task UI
// boundary. The user's original model response was not included in feedback.
for(const variant of ['cue','schema','json','cache','stop'] as const)test(`a completed but invalid ${variant} vision plan keeps search results and offers a bounded subtitle recovery`,async({},testInfo)=>{
  const {context,page,site,worker}=await setup();
  try{
    await worker.evaluate(variant=>{
      if(variant==='cache'){
        const set=chrome.storage.session.set.bind(chrome.storage.session);
        chrome.storage.session.set=(async(value:any)=>{if('vcamp.instruction-trace.v1' in value)throw new Error('synthetic session quota');return set(value);}) as typeof chrome.storage.session.set;
      }
      const original=fetch;(globalThis as any).recoveryCalls=[];
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'deepseek-flash',input_modalities:['text','image']} ]});
        const body=JSON.parse(init.body),system=String(body.messages?.[0]?.content??'');
        const kind=String(input).endsWith('/v1/tools/search')?'search':system.includes('[P1:web-query]')?'query':system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'vision':'answer';
        (globalThis as any).recoveryCalls.push({kind,body});
        if(kind==='search')return Response.json({results:[{url:'https://example.test/recovery',title:'示例来源',summary:'网页补充资料',snippet:'摘要'}]});
        const plan={version:2,scope:variant==='schema'?'focused|whole-video':'focused',needsNewFrames:true,evidence:[{id:'page',need:'PRIVATE_PLAN_TEXT',priority:'required',mode:'single',reuseAttachmentIds:[],detailNeed:'read-text',readTargets:['菜单文字'],reason:'字幕定位',windows:[{from:1.5,to:2.5,anchor:2,cueIds:[variant==='cue'||variant==='stop'?99:0],basis:'subtitle'}]}],unresolved:[]};
        const content=kind==='requirements'?JSON.stringify({version:1,interpretedIntent:'总结演示',additionalSources:[],outputRequirements:[]})
          :kind==='query'?JSON.stringify({query:'视频主题'})
            :kind==='vision'?(variant==='json'||variant==='cache'?JSON.stringify(plan).slice(0,-1):JSON.stringify(plan))
              :'根据字幕和网页资料归纳；本次未取得新截图。[资料](https://example.test/recovery)';
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    },variant);
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_RECOVERY_KEY'});
    const provider=await command({type:'provider.fetch',expectedRevision:1});
    await command({type:'provider.import-models',expectedRevision:provider.view.provider.revision,modelIds:['deepseek-flash']});
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await page.getByRole('button',{name:'联网',exact:true}).click();
    await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();
    const current=(await command({type:'workspace.query'})).view,target={kind:'chat',workspaceId:current.workspaceId,chatId:current.chatId};
    const request='快速总结并核对演示画面';
    const query=async()=>{const g=(await command({type:'generation.query',target})).view.generation;return g.jobs.find((j:any)=>j.jobId===g.messages.find((m:any)=>m.role==='user'&&m.text===request)?.jobId);};
    const before=await site.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,paused:v.paused}));
    await page.getByLabel('输入草稿').fill(request);await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect.poll(async()=>{const job=await query();return job&&['failed','awaiting-permission'].includes(job.state)?job.state:'running';}).toBe('awaiting-permission');
    const waiting=await query();
    const code=variant==='cue'||variant==='stop'?'invalid-cue':variant==='schema'?'invalid-schema':'invalid-json';
    const fields=variant==='cue'||variant==='stop'?['evidence.0.windows.0.cueIds']:variant==='schema'?['scope']:[];
    expect(waiting.visual).toMatchObject({issue:'plan',attachmentIds:[],planningFailure:{code,fields},planningCorrection:{outcome:'failed'}});
    expect(waiting.webEvidence.status).toBe('retrieved');
    expect(waiting.diagnostics.find((d:any)=>d.purpose==='vision-plan')).toMatchObject({cause:'stop'});
    if(variant==='json'){
      const inspection=(await command({type:'instructions.query',jobId:waiting.jobId,workspaceId:target.workspaceId,chatId:target.chatId})).view.instructions;
      expect(inspection.calls.find((c:any)=>c.stage==='vision-plan').failedPlanResponse).toContain('PRIVATE_PLAN_TEXT');
      expect(inspection.calls.filter((c:any)=>c.stage!=='vision-plan').every((c:any)=>c.failedPlanResponse===undefined)).toBe(true);
      expect(waiting.visual.planningFailure.syntax).toMatchObject({kind:'syntax',offset:expect.any(Number),line:1,column:expect.any(Number)});
    }
    await expect(page.getByText('画面规划未通过校验',{exact:false})).toBeVisible();
    await page.getByText('规划诊断',{exact:true}).click();
    const feedback=JSON.parse(await page.getByLabel('完整诊断文本').inputValue());
    expect(feedback.visual.planningFailure.code).toBe(code);
    expect(JSON.stringify(feedback)).not.toMatch(/PRIVATE_PLAN_TEXT|SYNTHETIC_RECOVERY_KEY/);
    await writeFile(testInfo.outputPath('planning-feedback.json'),JSON.stringify(feedback,null,2));
    await page.screenshot({path:testInfo.outputPath('planning-recovery.png')});
    await page.reload();await site.bringToFront();
    await expect(page.getByRole('button',{name:'仅用字幕继续',exact:true})).toBeVisible();
    if(variant==='json'){
      await page.getByRole('button',{name:'AI 指令',exact:true}).last().click();
      const dialog=page.getByRole('dialog',{name:'本次 AI 指令'});
      await expect(dialog.getByRole('heading',{name:'失败规划响应',exact:true})).toBeVisible();
      await dialog.getByText('展开失败规划响应',{exact:true}).click();
      const failedResponse=dialog.locator('section').filter({has:page.getByRole('heading',{name:'失败规划响应',exact:true})});
      await expect(failedResponse.locator('pre')).toHaveCount(1);await expect(failedResponse.locator('pre')).toContainText('PRIVATE_PLAN_TEXT');
      await expect(dialog.getByRole('button',{name:'复制失败规划响应',exact:true})).toBeVisible();
      expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      await dialog.screenshot({path:testInfo.outputPath('failed-plan-inspector.png')});
      await dialog.getByRole('button',{name:'关闭指令查看',exact:true}).click();
    }
    if(variant==='stop'){
      await page.getByRole('button',{name:'停止生成',exact:true}).click();
      await expect.poll(async()=>(await query())?.state).toBe('stopped');
      expect(await worker.evaluate(()=>(globalThis as any).recoveryCalls.map((c:any)=>c.kind))).toEqual(['requirements','query','search','vision','vision']);
      expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,paused:v.paused}))).toEqual(before);
      return;
    }
    await page.getByRole('button',{name:'仅用字幕继续',exact:true}).click();
    await expect.poll(async()=>(await query())?.state).toBe('completed');
    const done=await query();expect(done.visual).toMatchObject({frozen:true,resolution:'subtitle',attachmentIds:[]});
    expect(done.webEvidence.status).toBe('cited');
    expect(done.webEvidence.sources[0].url).toBe(waiting.webEvidence.sources[0].url);
    const calls=await worker.evaluate(()=>(globalThis as any).recoveryCalls);
    expect(calls.map((c:any)=>c.kind)).toEqual(['requirements','query','search','vision','vision','answer']);
    expect(JSON.stringify(calls.at(-1).body)).toContain('自主画面未作为回答依据');
    expect(JSON.stringify(calls.at(-1).body)).toContain('网页补充资料');
    expect(JSON.stringify(calls.at(-1).body)).not.toContain('PRIVATE_PLAN_TEXT');
    expect(calls.at(-1).body.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((p:any)=>p.type==='image_url')).toHaveLength(0);
    expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,paused:v.paused}))).toEqual(before);
    await expect(page.getByText('画面依据（规划未通过）',{exact:true})).toBeVisible();
    await page.getByText('画面依据（规划未通过）',{exact:true}).click();
    await expect(page.locator('.visual-evidence')).toContainText('本次没有新增截图');
    await page.locator('.visual-evidence').getByText('规划诊断',{exact:true}).click();
    const completedFeedback=JSON.parse(await page.getByLabel('完整诊断文本').inputValue());
    expect(completedFeedback).toMatchObject({state:'completed',visual:{planningFailure:{code,fields}}});
    expect(JSON.stringify(completedFeedback)).not.toMatch(/PRIVATE_PLAN_TEXT|SYNTHETIC_RECOVERY_KEY/);
    await page.locator('.visual-evidence').screenshot({path:testInfo.outputPath('continued-evidence.png')});
  }finally{await context.close();}
});
