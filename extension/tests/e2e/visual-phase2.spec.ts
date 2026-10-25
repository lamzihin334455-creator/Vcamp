import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

for(const mode of ['sufficient','partial-checks','limited-checks','interval','missing-unresolved','cue-plan','correct-plan','correct-review','repair','keep','bad-review','inconsistent-review','retry','takeover','source-change','stop'] as const)test(`phase two ${mode}: one batch review and bounded automatic continuation`,async({},testInfo)=>{
  test.setTimeout(60_000);
  const {context,page,site,worker,forbidden}=await setup();
  try{
    await worker.evaluate(mode=>{
      const original=fetch;(globalThis as any).phase2Requests=[];
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return new Response(JSON.stringify({object:'list',data:[{id:'local-vision',name:'Local vision',input_modalities:['text','image']}]}),{headers:{'content-type':'application/json'}});
        const body=JSON.parse(init.body),system=String(body.messages[0].content),kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'vision':system.includes('[P1:vision-review]')?'review':'answer';
        const leaseKeys=Object.keys(await chrome.storage.session.get(null)).filter(k=>k.startsWith('vcamp.currentMedia.')||k.startsWith('vcamp.visionGrant.'));
        (globalThis as any).phase2Requests.push({kind,body,leaseKeys});
        let content='本地模拟回答：请用真实模型与视频另行验证读字效果。';
        if(kind==='requirements')content=JSON.stringify({version:1,interpretedIntent:'核对设置页的菜单文字',additionalSources:[],outputRequirements:['只陈述实际图片证据']});
        if(kind==='vision')content=JSON.stringify({version:2,scope:'focused',needsNewFrames:true,evidence:[{id:'menu',need:'读取设置页菜单文字',priority:'required',mode:mode==='interval'?'sequence':'single',reuseAttachmentIds:[],detailNeed:'read-text',readTargets:['菜单名称'],reason:'在字幕附近查找实际页面',windows:[mode==='interval'?{from:1.3,to:3.3,anchor:2.3,cueIds:[0],basis:'subtitle'}:{from:1.3,to:1.9,anchor:1.5,cueIds:[0],basis:'subtitle'}]}],...(mode==='missing-unresolved'?{}:{unresolved:[]})});
        if(kind==='vision'&&['cue-plan','correct-plan'].includes(mode))content=mode==='correct-plan'&&(globalThis as any).phase2Requests.filter((r:any)=>r.kind==='vision').length===1?'{}':JSON.stringify({version:3,scope:'focused',evidence:[{need:'读取设置页菜单文字',priority:'required',mode:'single',detailNeed:'read-text',readTargets:['菜单名称'],reason:'按原字幕精确定位',windows:[{cueIds:[0]}]}],unresolved:[]});
        if(kind==='vision'){
          const planned=JSON.parse(content);
          if(planned.evidence?.length)planned.evidence[0].checkTargets=mode==='interval'?['菜单名称','连续运镜']:['partial-checks','limited-checks'].includes(mode)?['菜单名称','复选框大小','边框粗细']:['菜单名称'];
          content=JSON.stringify(planned);
        }
        if(kind==='review'){
          if((globalThis as any).phase2Requests.filter((r:any)=>r.kind==='review').length===1)await new Promise<void>(resolve=>{(globalThis as any).releaseReview=resolve;});
          const input=JSON.parse(body.messages[1].content[0].text),repair=['repair','keep','takeover','source-change'].includes(mode);
          content=mode==='bad-review'?'INVALID_PRIVATE_REVIEW_PAYLOAD':JSON.stringify({version:1,results:input.targets.map((t:any)=>({evidenceId:t.evidenceId,status:repair?'unreadable':mode==='interval'?'partial':'sufficient',imageRefs:t.imageRefs,observations:repair?[]:['模拟核验：图片中能看到设置文字'],missing:repair?'模拟缺口：目标文字读不清':mode==='interval'?'模拟缺口：静帧无法确认连续运镜或流畅度':'',refinements:repair?[{slotKey:t.slots[0].slotKey,window:{from:2.2,to:3.3,anchor:2.75,cueIds:[0],basis:'subtitle'}}]:[]}))});
          if(input.checksVersion===1&&mode!=='bad-review')content=JSON.stringify({version:3,results:input.targets.map((t:any)=>({evidenceId:t.evidenceId,checks:t.checks.map((c:any,i:number)=>({checkId:c.checkId,status:repair?'unreadable':mode==='partial-checks'&&i>0?'unreadable':mode==='interval'&&i===1?'uncertain':'confirmed',imageRefs:t.imageRefs,observation:repair?'模拟缺口：目标文字读不清':mode==='partial-checks'&&i>0?'模拟细节不可辨认':mode==='interval'&&i===1?'静帧不能证明连续运镜':'模拟可见菜单文字'})),refinements:repair?[{slotKey:t.slots[0].slotKey,cueIds:[0],checkIds:[t.checks[0].checkId],reason:'相关设置画面可补取清晰文字'}]:[]}))});
        }
        if(kind==='review'&&mode==='limited-checks'){const limited=JSON.parse(content);limited.results[0].checks.forEach((c:any,i:number)=>{c.status='confirmed';c.observation=i===0?'模拟可见菜单文字':i===1?'画面太小无法确认复选框大小':'需结合字幕判断边框';});content=JSON.stringify(limited);}
        if(kind==='answer'&&mode==='retry'&&(globalThis as any).phase2Requests.filter((r:any)=>r.kind==='answer').length===1)return new Response('{}',{status:500,headers:{'content-type':'application/json'}});
        if(kind==='review'&&mode==='inconsistent-review'){
          const invalid=JSON.parse(content),target=JSON.parse(body.messages[1].content[0].text).targets[0];
          if(invalid.version===3)invalid.results[0].checks[0].imageRefs=['invented'];else Object.assign(invalid.results[0],{status:'sufficient',missing:'模拟矛盾：还有重要内容未读出',refinements:[{slotKey:target.slots[0].slotKey,window:{from:2.2,to:3.3,anchor:2.75,cueIds:[0],basis:'subtitle'}}]});content=JSON.stringify(invalid);
        }
        if(kind==='review'&&mode==='correct-review'&&(globalThis as any).phase2Requests.filter((r:any)=>r.kind==='review').length===1)content='{}';
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:60,total_tokens:180}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    },mode);
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_LOCAL_ONLY'})).ok).toBe(true);
    const fetched=await command({type:'provider.fetch',expectedRevision:1});expect((await command({type:'provider.default',expectedRevision:fetched.view.provider.revision,modelId:'local-vision'})).ok).toBe(true);
    await page.reload();await site.bringToFront();
    // Reload first renders an unbound composer; its context menu has no new-chat action.
    await expect(page.getByLabel('输入草稿')).toBeEnabled();
    await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();
    const current=(await command({type:'workspace.query'})).view,target={kind:'chat',workspaceId:current.workspaceId,chatId:current.chatId},request=`核对设置页面菜单文字 ${mode}`;
    await page.getByLabel('输入草稿').fill(request);await page.getByRole('button',{name:'发送',exact:true}).click();
    const query=async()=>{const g=(await command({type:'generation.query',target})).view.generation;return g.jobs.find((j:any)=>j.jobId===g.messages.find((m:any)=>m.role==='user'&&m.text===request)?.jobId);};
    await expect.poll(async()=>(await query())?.visual?.phase,{timeout:20_000}).toBe('checking');
    const before=await query(),initialIds=before.visual.attachmentIds;
    const expectedImages=mode==='interval'?2:1;
    expect(initialIds).toHaveLength(expectedImages);
    if(['cue-plan','correct-plan'].includes(mode)){
      expect(before.visual.cueGrounded).toBe(true);
      expect(before.visual.evidencePlan.evidence[0].windows[0]).toMatchObject({from:1.234,to:3.456,anchor:(1.234+3.456)/2});
      expect(before.visual.planningTokensUpperBound).toBeGreaterThan(2048);
      if(mode==='correct-plan')expect(before.visual.planningCorrection).toMatchObject({outcome:'succeeded',firstFailure:{code:'invalid-schema'}});
    }
    if(mode==='missing-unresolved'){
      expect(before.visual.evidencePlan.unresolved).toEqual([expect.stringContaining('未提供未解决项清单')]);
      expect(before.visual.audit.unresolved).toEqual(expect.arrayContaining(before.visual.evidencePlan.unresolved));
    }
    if(mode==='interval'){
      expect(before.visual.audit.samplingNotes).toHaveLength(1);
      expect(before.visual.audit.slots.map((s:any)=>s.anchor)).toEqual([1.8,2.8]);
      expect(before.visual.audit.frames[0].time).toBeLessThan(before.visual.audit.frames[1].time);
    }
    const reviewCall=await worker.evaluate(()=>(globalThis as any).phase2Requests.find((r:any)=>r.kind==='review'));
    expect(reviewCall.leaseKeys).toEqual([]);expect(reviewCall.body.max_tokens).toBe(4096);
    const reviewImages=reviewCall.body.messages[1].content.filter((p:any)=>p.type==='image_url');expect(reviewImages).toHaveLength(expectedImages);expect(reviewImages[0].image_url.detail).toBe('original');
    expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(.5,1);
    if(mode!=='repair'&&mode!=='takeover'&&mode!=='source-change')await site.locator('video').evaluate(async(v:HTMLVideoElement)=>{v.currentTime=.9;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));});
    if(mode==='takeover')await site.locator('video').evaluate((v:HTMLVideoElement)=>{v.addEventListener('seeking',()=>{v.currentTime=.75;},{once:true});});
    if(mode==='source-change')await site.goto('https://www.bilibili.com/video/BVexperience/?p=2');
    if(mode==='stop'){
      await page.getByRole('button',{name:'停止生成',exact:true}).click();
      await worker.evaluate(()=>(globalThis as any).releaseReview());
      await expect.poll(async()=>(await query()).state).toBe('stopped');
      expect(await worker.evaluate(()=>(globalThis as any).phase2Requests.map((r:any)=>r.kind))).toEqual(['requirements','vision','review']);
      expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(.9,1);
      await page.locator('.visual-evidence > summary').click();
      await expect(page.locator('.visual-evidence')).toContainText('核验已中止，未形成核验结论');
      await expect(page.locator('.visual-evidence')).not.toContainText('正在核验实际截图');
      await page.locator('.visual-evidence').screenshot({path:testInfo.outputPath('stopped-audit.png')});
      return;
    }
    await worker.evaluate(()=>(globalThis as any).releaseReview());
    if(mode==='retry'){
      await expect.poll(async()=>(await query()).state).toBe('failed');
      await page.getByText('失败详情 / 重试',{exact:true}).click();await page.getByRole('button',{name:'重试原请求',exact:true}).click();
    }
    await expect.poll(async()=>(await query()).state,{timeout:25_000}).toBe('completed');
    const job=await query(),v=job.visual,requests=await worker.evaluate(()=>(globalThis as any).phase2Requests);
    expect(requests.map((r:any)=>r.kind)).toEqual(mode==='retry'?['requirements','vision','review','answer','answer']:mode==='correct-plan'?['requirements','vision','vision','review','answer']:['correct-review','bad-review','inconsistent-review'].includes(mode)?['requirements','vision','review','review','answer']:['requirements','vision','review','answer']);
    if(['partial-checks','limited-checks'].includes(mode)){
      expect(v.review.results[0]).toMatchObject({status:'partial',checks:[{target:'菜单名称',status:'confirmed'},{target:'复选框大小',status:mode==='limited-checks'?'uncertain':'unreadable'},{target:'边框粗细',status:mode==='limited-checks'?'uncertain':'unreadable'}]});
      const envelope=JSON.stringify(requests.at(-1).body.messages);expect(envelope).toContain('复选框大小');expect(envelope).toContain(mode==='limited-checks'?'uncertain':'unreadable');expect(envelope).not.toContain('模拟可见菜单文字');
    }
    if(mode==='correct-review')expect(v.review).toMatchObject({status:'complete',correction:{firstFailure:'schema',outcome:'succeeded'}});
    expect(v.attachmentIds).toHaveLength(expectedImages);expect(v.audit.budget.captures).toBeLessThanOrEqual(18);expect(v.audit.budget.mediaMs).toBeLessThan(45000);
    expect(v.audit.budget.reviewTokensUpperBound).toBeGreaterThan(1024);
    expect(requests.at(-1).leaseKeys).toEqual([]);
    if(mode==='repair'){
      expect(v.attachmentIds).not.toEqual(initialIds);expect(v.review.repairs[0]).toMatchObject({state:'captured-unverified',originalTime:before.visual.audit.frames[0].time});
      expect(v.audit.frames[0].time).toBeGreaterThanOrEqual(2.2);expect(v.audit.frames[0].time).toBeLessThanOrEqual(3.3);
      expect(v.audit.candidates.some((c:any)=>c.decision==='superseded')).toBe(true);
      expect(JSON.stringify(requests.at(-1).body.messages)).toContain('补帧没有再次独立核验');
    }else{
      expect(v.attachmentIds).toEqual(initialIds);
      if(mode==='keep'){expect(v.review.repairs[0].state).toBe('media');expect(v.mediaFailure).toBe('user-control');}
      if(mode==='takeover'){expect(v.review.repairs[0].state).toBe('media');expect(v.mediaFailure).toBe('user-control');}
      if(mode==='source-change'){expect(v.review.repairs[0].state).toBe('media');expect(v.mediaFailure).toBe('source-changed');}
      if(mode==='bad-review')expect(v.review).toMatchObject({status:'failed',failure:'json',results:[]});
      if(mode==='inconsistent-review')expect(v.review).toMatchObject({status:'failed',failure:'references',results:[],repairs:[]});
    }
    if(mode!=='source-change')expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(mode==='takeover'?.75:mode==='repair'?.5:.9,1);
    expect(await worker.evaluate(async()=>Object.keys(await chrome.storage.session.get(null)).filter(k=>k.startsWith('vcamp.currentMedia.')||k.startsWith('vcamp.mediaContinuation.')||k.startsWith('vcamp.visionGrant.')))).toEqual([]);
    await expect(page.getByRole('button',{name:'授权补充画面',exact:true})).toHaveCount(0);
    const finalImages=requests.at(-1).body.messages.flatMap((m:any)=>typeof m.content==='string'?[]:m.content).filter((p:any)=>p.type==='image_url');expect(finalImages).toHaveLength(expectedImages);
    if(mode==='keep'||mode==='source-change')expect(v.audit.budget.captures).toBe(before.visual.audit.budget.captures);
    if(mode==='source-change'){
      await writeFile(testInfo.outputPath('audit.json'),JSON.stringify({mode,state:job.state,visual:v,requestKinds:requests.map((r:any)=>r.kind),restoredBeforeReview:reviewCall.leaseKeys.length===0,realPaidModelCalls:0,usageIsMocked:true,sourceChangePreserved:true},null,2));
      return;
    }
    if(mode==='interval'){
      expect(v.review.results[0]).toMatchObject({status:'partial',missing:'连续运镜：无法确定'});
      expect(JSON.stringify(requests.at(-1).body.messages)).toContain(v.audit.samplingNotes[0]);
      await page.reload();await site.bringToFront();
      await expect(page.getByTestId('startup')).toHaveCount(0);
      expect((await query()).visual.audit.samplingNotes).toEqual(v.audit.samplingNotes);
    }
    if(mode==='missing-unresolved'){
      expect(JSON.stringify(requests.at(-1).body.messages)).toContain(v.audit.unresolved[0]);
      expect(v.review.status).toBe('complete');
      await page.reload();await site.bringToFront();
      await expect(page.getByTestId('startup')).toHaveCount(0);
      expect((await query()).visual.audit.unresolved).toEqual(v.audit.unresolved);
    }
    if(['cue-plan','correct-plan'].includes(mode)){
      await page.reload();await site.bringToFront();await expect(page.getByTestId('startup')).toHaveCount(0);
      const persisted=(await query()).visual;expect(persisted.cueGrounded).toBe(true);expect(persisted.planningCorrection).toEqual(v.planningCorrection);expect(persisted.planningTokensUpperBound).toEqual(v.planningTokensUpperBound);
    }
    await page.setViewportSize({width:400,height:1600});await page.locator('.visual-evidence > summary').click();
    await expect(page.locator('.visual-evidence')).toContainText('按问题需求提取关键帧');
    if(['partial-checks','limited-checks'].includes(mode)){
      await expect(page.locator('.visual-evidence')).toContainText('部分满足');
      await expect(page.locator('.visual-evidence')).toContainText(mode==='limited-checks'?'复选框大小：无法确定':'复选框大小：看不清');
      await page.reload();await site.bringToFront();await expect(page.getByTestId('startup')).toHaveCount(0);
      expect((await query()).visual.review.results[0].checks).toEqual(v.review.results[0].checks);
      await page.locator('.visual-evidence > summary').click();
    }
    if(mode==='interval')await expect(page.locator('.visual-evidence')).toContainText('连续区间取样安排');
    if(mode==='missing-unresolved')await expect(page.locator('.visual-evidence')).toContainText('未提供未解决项清单');
    if(['cue-plan','correct-plan'].includes(mode))await expect(page.locator('.visual-evidence')).toContainText('本地按原字幕精确时间计算');
    if(mode==='correct-plan')await expect(page.locator('.visual-evidence')).toContainText('一次');
    if(mode==='repair')await expect(page.locator('.visual-evidence')).not.toContainText(/补帧|补图|补前/);
    if(['bad-review','inconsistent-review'].includes(mode)){
      await page.getByText('核验诊断（回答已完成）',{exact:true}).click();
      await expect(page.locator('.visual-evidence').getByRole('button',{name:'复制完整诊断'})).toBeVisible();
      await page.locator('.visual-evidence').getByText('失败详情（用于反馈）',{exact:true}).click();
      const feedback=JSON.parse(await page.getByLabel('完整诊断文本').inputValue());expect(feedback.state).toBe('completed');expect(feedback.visual.review.correction.outcome).toBe('failed');
      expect(JSON.stringify(feedback)).not.toContain('INVALID_PRIVATE_REVIEW_PAYLOAD');
      const trace=(await command({type:'instructions.query',jobId:job.jobId,workspaceId:target.workspaceId,chatId:target.chatId})).view.instructions;
      expect(trace.calls.filter((c:any)=>c.stage==='vision-review').every((c:any)=>!!c.failedReviewResponse)).toBe(true);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.locator('.visual-evidence').screenshot({path:testInfo.outputPath(`${mode}-audit.png`)});
    await writeFile(testInfo.outputPath('audit.json'),JSON.stringify({mode,state:job.state,visual:v,requestKinds:requests.map((r:any)=>r.kind),restoredBeforeReview:reviewCall.leaseKeys.length===0,realPaidModelCalls:0,usageIsMocked:true,unexpectedRequests:forbidden},null,2));
  }finally{await context.close();}
});
