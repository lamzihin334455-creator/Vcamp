import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

test('system default synchronizes current chat; independent overrides control actual search, retry and bounded time links',async()=>{
  test.setTimeout(100_000);
  const {context,page,worker,site}=await setup();
  try{
    await worker.evaluate(()=>{
      const original=fetch;(globalThis as any).permissionRequests=[];(globalThis as any).badSearch=false;
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'deepseek-flash',input_modalities:['text','image']}]});
        const body=JSON.parse(init.body),kind=String(input).endsWith('/v1/tools/search')?'search':String(body.messages?.[0]?.content).includes('[P1:web-query]')?'query':String(body.messages?.[0]?.content).includes('[P1:requirements-plan]')?'plan':'answer';
        (globalThis as any).permissionRequests.push({kind,body});
        if(kind==='search')return Response.json((globalThis as any).badSearch?{results:[{url:42}]}:{results:[{url:'https://example.test/source',title:null,summary:'检索摘录'}]});
        const text=kind==='query'?JSON.stringify({query:'视频概念'}):kind==='plan'?JSON.stringify({version:1,interpretedIntent:'核实视频',additionalSources:[{source:'web',reason:'模型自行要求搜索'}],outputRequirements:[]}):'视频内容 [00:01](vcamp-time:1.234)。错误引用 [01:07:48](vcamp-time:4068)。';
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    });
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_PERMISSION_KEY'})).ok).toBe(true);
    let fetched=await command({type:'provider.fetch',expectedRevision:1});fetched=await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:fetched.view.provider.catalog.map((model:any)=>model.id)});
    expect((await command({type:'provider.default',expectedRevision:fetched.view.provider.revision,modelId:'deepseek-flash'})).ok).toBe(true);
    await page.reload();await site.bringToFront();
    const newChat=async()=>{await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();};
    const top=page.getByRole('button',{name:'联网',exact:true});
    const saved=async()=>(await command({type:'workspace.query'})).view;
    const searches=async()=>worker.evaluate(()=>(globalThis as any).permissionRequests.filter((r:any)=>r.kind==='search').length);
    const setDefault=async(value:boolean)=>{
      await page.getByRole('button',{name:'设置',exact:true}).click();
      const toggle=page.getByRole('switch',{name:'新对话默认联网'});
      if(await toggle.getAttribute('aria-checked')!==String(value))await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked',String(value));
      await expect(top).toHaveAttribute('aria-pressed',String(value));
      await expect.poll(async()=>(await saved()).draft.webEnabled??false).toBe(value);
      await page.getByRole('button',{name:'设置',exact:true}).click();
    };
    await newChat();const first=await saved();
    await page.getByLabel('输入草稿').fill('保留这份未发送输入');
    await setDefault(true);await expect(page.getByLabel('输入草稿')).toHaveValue('保留这份未发送输入');
    await top.click();await expect(top).toHaveAttribute('aria-pressed','false');
    const send=async(text:string,state='completed')=>{
      await page.getByLabel('输入草稿').fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();
      const current=await saved(),target={kind:'chat',workspaceId:current.workspaceId,chatId:current.chatId};
      const query=async()=>(await command({type:'generation.query',target})).view.generation;
      const job=async()=>{const view=await query();return view.jobs.find((j:any)=>j.jobId===view.messages.find((m:any)=>m.role==='user'&&m.text===text)?.jobId);};
      await expect.poll(async()=>(await job())?.state,{timeout:20_000}).toBe(state);return job();
    };
    await send('关闭时即使模型要求核实也不搜索');expect(await searches()).toBe(0);
    await expect(page.locator('.invalid-answer-time')).toHaveCount(1);
    await expect(page.locator('.chat-thread .answer-time')).toHaveCount(1);
    await page.reload();await expect(top).toHaveAttribute('aria-pressed','false');
    await newChat();await expect(top).toHaveAttribute('aria-pressed','true');
    await send('新对话按默认允许联网');expect(await searches()).toBe(1);
    await setDefault(false);await send('默认关闭同步到当前对话');expect(await searches()).toBe(1);
    // Selecting another chat retains its explicit override.
    expect((await command({type:'chat.select',workspaceId:first.workspaceId,chatId:first.chatId})).ok).toBe(true);
    await expect(top).toHaveAttribute('aria-pressed','false');
    await top.click();await send('当前对话独立开启');expect(await searches()).toBe(2);
    await worker.evaluate(()=>{(globalThis as any).badSearch=true;});
    const failed=await send('保留失败诊断','failed');
    expect(failed.error).toBe('web-protocol');
    expect(failed.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({purpose:'web-search',webStage:'envelope',webInvalidFields:expect.arrayContaining(['url'])})]));
    await top.click();await expect(top).toHaveAttribute('aria-pressed','false');
    const count=await searches();
    const retry=await command({type:'generation.retry',jobId:failed.jobId});
    expect(retry).toMatchObject({ok:false,code:'web-disabled'});expect(await searches()).toBe(count);
    // Model an existing 0.1.27 failed task in this isolated profile. Retrying
    // keeps its frozen route readable but must dispatch only the direct API.
    await page.evaluate(jobId=>new Promise<void>((resolve,reject)=>{
      const request=indexedDB.open('vcamp');
      request.onsuccess=()=>{const db=request.result,tx=db.transaction('jobs','readwrite'),store=tx.objectStore('jobs'),read=store.get(jobId);read.onsuccess=()=>{const job=read.result;job.snapshot.web.route='deepseek-native-v1';store.put(job);};tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};request.onerror=()=>reject(request.error);
    }),failed.jobId);
    await worker.evaluate(()=>{(globalThis as any).badSearch=false;});
    await top.click();
    expect((await command({type:'generation.retry',jobId:failed.jobId})).ok).toBe(true);
    const retried=async()=>(await command({type:'generation.query',target:failed.target})).view.generation.jobs.find((j:any)=>j.jobId===failed.jobId);
    await expect.poll(async()=>(await retried())?.state).toBe('completed');
    expect((await retried()).attemptId).not.toBe(failed.attemptId);expect(await searches()).toBe(count+1);
    const inspection=(await command({type:'instructions.query',jobId:failed.jobId,workspaceId:failed.target.workspaceId,chatId:failed.target.chatId})).view.instructions;
    expect(inspection.calls.some((c:any)=>c.stage==='web-query')).toBe(true);
    expect(inspection.calls.filter((c:any)=>c.stage==='web-search').every((c:any)=>JSON.parse(c.body).count===5)).toBe(true);
    await top.click();
    const requests=await worker.evaluate(()=>(globalThis as any).permissionRequests);
    const answer=requests.find((r:any)=>r.kind==='answer').body.messages[1].content;
    expect(answer).toContain('startSeconds=1.234');expect(answer).toContain('durationSeconds');
    await expect.poll(async()=>(await saved()).draft.webEnabled).toBe(false);
    await expect(top).toHaveAttribute('aria-pressed','false');
    await expect(top).not.toHaveClass(/active/);
    await top.hover();
    await expect(top).toHaveCSS('color','rgb(112, 119, 128)');
    await page.screenshot({path:'test-results/web-permission-timeline.png'});
    await expect(top).toHaveAttribute('aria-pressed','false');
  } finally {await context.close();}
});
