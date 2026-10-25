import {expect,test} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

test('different setting pages retain reading detail, compare local candidates and batch review actual images',async({},testInfo)=>{
  test.setTimeout(60_000);
  const {context,page,site,worker}=await setup();
  try{
    const reference=process.env.VISUAL_TEST_MEDIA;
    {
      const media=await readFile(reference??'tests/fixtures/two-settings-quality.mp4'),url='https://www.bilibili.com/visual-reference-fixture.mp4';
      // Use a normal source URL like the real player: embedding megabytes in
      // currentSrc needlessly stresses media identity messages in this fixture.
      await context.route(url,route=>{
        const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range??'');
        if(!range)return route.fulfill({contentType:'video/mp4',headers:{'accept-ranges':'bytes'},body:media});
        const start=Number(range[1]),end=Math.min(media.length-1,range[2]?Number(range[2]):media.length-1);
        return route.fulfill({status:206,contentType:'video/mp4',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${media.length}`},body:media.subarray(start,end+1)});
      });
      await site.locator('video').evaluate((video:HTMLVideoElement,url)=>{video.src=url;video.load();},url);
      await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.seekable.length>0&&v.seekable.end(v.seekable.length-1)>=v.duration-.1)).toBe(true);
    }
    const native=await site.locator('video').evaluate((v:HTMLVideoElement)=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration}));
    const anchors=reference?[1.5,5.5]:[native.duration*.25,native.duration*.75];
    await site.locator('video').evaluate((video:HTMLVideoElement)=>{
      (window as any).visualEvents=[];
      for(const name of ['seeking','seeked','play','pause','emptied','loadstart','ratechange'])video.addEventListener(name,()=>{(window as any).visualEvents.push({event:name,time:video.currentTime,paused:video.paused,ready:video.readyState});});
      document.addEventListener('visibilitychange',()=>{(window as any).visualEvents.push({event:'visibilitychange',hidden:document.hidden});});
    });
    await worker.evaluate(({anchors,reference})=>{
      const original=fetch;(globalThis as any).strengthenRequests=[];
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return new Response(JSON.stringify({object:'list',data:[{id:'local-vision',name:'Local vision',input_modalities:['text','image']}]}),{headers:{'content-type':'application/json'}});
        const body=JSON.parse(init.body),system=String(body.messages?.[0]?.content??'');
        const kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'vision':system.includes('[P1:vision-review]')?'review':'answer';
        (globalThis as any).strengthenRequests.push({kind,body});
        const content=kind==='requirements'?JSON.stringify({version:1,interpretedIntent:'核对两个不同设置页上的选项和勾选状态',additionalSources:[],outputRequirements:['根据画面读取文字和状态']})
          :kind==='vision'?JSON.stringify({version:2,scope:'focused',needsNewFrames:true,evidence:anchors.map((anchor,index)=>({id:index?'layout':'background',
            need:index?'核对布局选项和当前勾选状态':'读取背景菜单选项',priority:'required',mode:'single',reuseAttachmentIds:[],
            detailNeed:'overview',readTargets:index?['布局选项名称','当前勾选状态']:['背景选项名称'],checkTargets:index?['布局选项名称','当前勾选状态']:['背景选项名称'],reason:'按用户指定时间定位各页，等待实际画面核对',
            windows:[{from:reference?anchor-1:anchor-.1,to:reference?anchor+2:anchor+.1,anchor,cueIds:[],basis:'user-time'}]})),unresolved:[]})
            :kind==='review'?JSON.stringify({version:3,results:JSON.parse(body.messages[1].content[0].text).targets.map((t:any)=>({evidenceId:t.evidenceId,checks:t.checks.map((c:any)=>({checkId:c.checkId,status:'confirmed',imageRefs:t.imageRefs,observation:'本地模拟核验结果'})),refinements:[]}))})
            :'本地模拟回答：图片已传入，真实读字质量需要人工与模型实测。';
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:60,total_tokens:180}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    },{anchors,reference:Boolean(reference)});
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_LOCAL_ONLY'})).ok).toBe(true);
    const fetched=await command({type:'provider.fetch',expectedRevision:1});
    expect((await command({type:'provider.default',expectedRevision:fetched.view.provider.revision,modelId:'local-vision'})).ok).toBe(true);
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();
    const current=(await command({type:'workspace.query'})).view,target={kind:'chat',workspaceId:current.workspaceId,chatId:current.chatId};
    const initial=await site.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,paused:v.paused}));
    const request=`读取 ${anchors[0].toFixed(2)} 秒附近背景页和 ${anchors[1].toFixed(2)} 秒附近布局页的菜单选项，核对勾选状态。`;
    await page.getByLabel('输入草稿').fill(request);await page.getByRole('button',{name:'发送',exact:true}).click();
    const query=async()=>{const generation=(await command({type:'generation.query',target})).view.generation;const message=generation.messages.find((m:any)=>m.role==='user'&&m.text===request);return generation.jobs.find((j:any)=>j.jobId===message?.jobId);};
    await expect.poll(async()=>['completed','awaiting-permission','failed'].includes((await query())?.state),{timeout:30_000}).toBe(true);
    const job=await query(),audit=job.visual.audit;
    const events=await site.evaluate(()=>(window as any).visualEvents);
    await writeFile(testInfo.outputPath('media-check.json'),JSON.stringify({state:job.state,visual:job.visual,events},null,2));
    expect(job.state,JSON.stringify({visual:job.visual,events})).toBe('completed');
    expect(audit.qualityVersion).toBe('local-v2');expect(audit.frames).toHaveLength(2);
    expect(audit.slots.map((s:any)=>s.detail)).toEqual(['original','original']);
    expect(audit.slots.every((s:any)=>s.detailReason.includes('已校正'))).toBe(true);
    expect(audit.candidates.every((c:any)=>c.quality<1&&Number.isFinite(c.metrics?.sharpness))).toBe(true);
    expect(audit.budget.captures).toBeGreaterThanOrEqual(4);expect(audit.budget.captures).toBeLessThanOrEqual(6);
    expect(audit.budget.mediaMs).toBeLessThan(45_000);
    if(reference){
      expect(audit.frames.map((f:any)=>f.time)).toEqual([2.5,6.5]);
      for(const f of audit.frames){const c=audit.candidates.find((c:any)=>c.slotKey===f.slotKey&&c.decision==='selected');expect([c.width,c.height]).toEqual([native.width,native.height]);}
    }
    const requests=await worker.evaluate(()=>(globalThis as any).strengthenRequests);
    expect(requests.map((r:any)=>r.kind)).toEqual(['requirements','vision','review','answer']);
    expect(JSON.stringify(requests[1].body.messages)).toContain('readTargets');
    expect(JSON.stringify(requests.at(-1).body.messages)).toContain('当前勾选状态');
    const images=requests.at(-1).body.messages.flatMap((m:any)=>typeof m.content==='string'?[]:m.content).filter((p:any)=>p.type==='image_url');
    expect(images).toHaveLength(2);expect(images.every((p:any)=>p.image_url.detail==='original')).toBe(true);
    await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement,t)=>Math.abs(v.currentTime-t),initial.time)).toBeLessThan(.15);
    expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(initial.paused);
    await page.setViewportSize({width:400,height:1600});
    await page.locator('.visual-evidence > summary').click();
    await expect(page.locator('.visual-evidence')).toContainText('已校正规划中的概览标记');
    await page.locator('.visual-evidence details > summary').click();
    await expect(page.locator('.visual-evidence')).toContainText('不是文字识别置信度');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.locator('.visual-evidence').screenshot({path:testInfo.outputPath('reading-audit.png')});
    await writeFile(testInfo.outputPath('reading-audit.json'),JSON.stringify({referenceMedia:Boolean(reference),native,audit,requestKinds:requests.map((r:any)=>r.kind),usageIsMocked:true,realPaidModelCalls:0},null,2));
  }finally{await context.close();}
});
