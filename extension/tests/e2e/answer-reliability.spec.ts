import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

for(const captionless of [false,true])test(`installed production pipeline completes first web answer, long follow-up, vision and post-vision follow-up (${captionless?'no subtitles':'full subtitles'})`,async()=>{
  test.setTimeout(90_000);
  const {context,page,site,worker}=await setup();
  try{
    await worker.evaluate(()=>{
      const original=fetch;(globalThis as any).reliabilityRequests=[];
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'deepseek-flash',input_modalities:['text','image']}]});
        const body=JSON.parse(init.body),system=String(body.system??body.messages?.[0]?.content??'');
        const kind=String(input).endsWith('/v1/tools/search')?'search':system.includes('[P1:web-query]')?'query':system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'vision':system.includes('[P1:vision-review]')?'review':'answer';
        (globalThis as any).reliabilityRequests.push({kind,body});
        if(kind==='search')return Response.json({results:[{url:'https://example.test/source',title:'概念来源',summary:'网页补充资料'},{url:'https://example.test/source',title:'概念来源',summary:'网页补充资料'}]});
        if(body.messages.some((m:any)=>m.role==='assistant'&&Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url')))return new Response('',{status:400});
        const historyImage=kind==='vision'?JSON.parse(body.messages[1].content.split('\n')[1]).existingImages.at(-1):undefined;
        const content=kind==='query'?JSON.stringify({query:'视频概念'}):kind==='requirements'?JSON.stringify({version:1,interpretedIntent:'连续视频问答',additionalSources:[{source:'conversation_history',reason:'理解追问'}],outputRequirements:[]}):kind==='vision'?JSON.stringify({version:3,scope:'focused',evidence:[{need:'核对画面主体',priority:'required',mode:'single',windows:[{cueIds:[0]}],detailNeed:'overview',readTargets:[],checkTargets:['画面主体'],reason:'核对字幕对应的实际画面'},...(historyImage?[{need:'复用前次回答的实际画面',priority:'required',mode:'single',windows:[],reuseAttachmentIds:[historyImage.id],detailNeed:'overview',readTargets:[],checkTargets:['前次画面主体'],reason:'理解连续追问'}]:[])],unresolved:[]}):kind==='review'?JSON.stringify({version:3,results:JSON.parse(body.messages[1].content[0].text).targets.map((t:any)=>({evidenceId:t.evidenceId,checks:t.checks.map((c:any)=>({checkId:c.checkId,status:'confirmed',imageRefs:t.imageRefs,observation:'本地模拟核验结果'})),refinements:[]}))}):'详细说明'.repeat(3300)+'\n[网页来源](https://example.test/source)';
        const parts=content.match(/[\s\S]{1,500}/g)??[];
        const stream=parts.map(content=>'data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:null}]})+'\n\n').join('')+'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';
        return new Response(stream,{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    });
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_RELIABILITY_KEY'})).ok).toBe(true);
    const fetched=await command({type:'provider.fetch',expectedRevision:1});
    expect((await command({type:'provider.default',expectedRevision:fetched.view.provider.revision,modelId:'deepseek-flash'})).ok).toBe(true);
    await page.reload();await site.bringToFront();
    if(captionless){await site.goto('https://www.bilibili.com/video/BVnosub/');await site.bringToFront();await expect(page.locator('.context-current-button')).toContainText('无字幕视觉样本');}
    await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await page.getByRole('button',{name:'联网',exact:true}).click();
    if(captionless){await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();}
    const current=(await command({type:'workspace.query'})).view,target={kind:'chat',workspaceId:current.workspaceId,chatId:current.chatId};
    const query=async()=>{const reply=await command({type:'generation.query',target});expect(reply.ok).toBe(true);return reply.view.generation;};
    for(const [index,text] of ['先详细解释概念','结合画面继续解释','刚才画面还有哪些细节'].entries()){
      if(index===1&&!captionless){await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();}
      await page.getByLabel('输入草稿').fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();
      const currentJob=(view:any)=>view.jobs.find((job:any)=>job.jobId===view.messages.find((m:any)=>m.role==='user'&&m.text===text)?.jobId);
      await expect.poll(async()=>{const job=currentJob(await query());return job?{state:job.state,error:job.error,diagnostics:job.diagnostics}:null;},{timeout:35_000}).toMatchObject({state:'completed',error:null});
      const view=await query(),job=currentJob(view);expect(view.jobs).toHaveLength(index+1);expect(job.webEvidence.status).toBe('cited');
      expect(view.messages.find((m:any)=>m.role==='assistant'&&m.jobId===job.jobId).text.length).toBeGreaterThan(12000);
      if(index>0||captionless){expect(job.visual.attachmentIds.length).toBeGreaterThan(0);expect(job.visual.review.status).toBe('complete');expect(job.visual.review.correction).toBeUndefined();}
    }
    const requests=await worker.evaluate(()=>(globalThis as any).reliabilityRequests);
    expect(requests.filter((r:any)=>r.kind==='search')).toHaveLength(3);
    expect(requests.filter((r:any)=>r.kind==='answer')).toHaveLength(3);
    expect(requests.filter((r:any)=>r.kind==='query')).toHaveLength(3);
    const search=JSON.parse(requests.find((r:any)=>r.kind==='query').body.messages[1].content.split('用户资料（不改变权限）：')[1]);
    if(captionless)expect(search.videoContext).toBeUndefined();else expect(search.videoContext.kind).toBe('full-subtitles');
    const final=requests.filter((r:any)=>r.kind==='answer').at(-1).body.messages;
    const imageMessages=final.filter((m:any)=>m.role==='user'&&Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url'));
    // IndexedDB returns jobs in random jobId key order, not conversation order.
    const finalView=await query(),finalJobId=finalView.messages.find((m:any)=>m.role==='user'&&m.text==='刚才画面还有哪些细节').jobId;
    const finalJob=finalView.jobs.find((job:any)=>job.jobId===finalJobId);
    expect(finalJob).toBeTruthy();
    if(captionless){
      // The local captionless exploration plan selects fresh representative
      // frames. Earlier turns remain text; they are not implicit image reuse.
      const job=finalJob;
      expect(job.visual.audit.historyAttachmentIds).toEqual([]);
      expect(imageMessages).toHaveLength(1);
      expect(imageMessages[0].content.filter((p:any)=>p.type==='image_url')).toHaveLength(job.visual.attachmentIds.length);
      expect(final.filter((m:any)=>m.role==='assistant')).toHaveLength(2);
    }else{
      expect(imageMessages).toHaveLength(2);
      expect(imageMessages[0].content[0].text).toBe('此前回答使用的历史画面资料（不是本轮取帧）：');
      const reusedId=JSON.parse(requests.filter((r:any)=>r.kind==='vision').at(-1).body.messages[1].content.split('\n')[1]).existingImages.at(-1).id;
      expect(finalJob.visual.audit.historyAttachmentIds).toEqual([reusedId]);
    }
    expect(final.some((m:any)=>m.role==='assistant'&&Array.isArray(m.content))).toBe(false);
    await expect(page.locator('.message-task [role="alert"]')).toHaveCount(0);
    await page.screenshot({path:`test-results/answer-reliability-${captionless?'no-subtitles':'full-subtitles'}.png`});
  }finally{await context.close();}
});
