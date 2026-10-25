import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

test('Bailian Qwen template HTML: report genuine truncation, never save fragments, manually retry the frozen request and keep the complete page',async()=>{
  test.setTimeout(60000);
  const {context,page,worker,site,forbidden}=await setup();
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  try{
    await page.setViewportSize({width:360,height:800});
    await worker.evaluate(()=>{
      const original=fetch,state=globalThis as any;state.qwenCalls=[];state.qwenTruncate=true;
      state.fetch=async(url:string,init:RequestInit={})=>{
        if(!String(url).startsWith('https://dashscope.aliyuncs.com/compatible-mode/v1/'))return original(url,init);
        if(String(url).endsWith('/models'))return Response.json({data:[{id:'qwen3.8-flash',max_output_tokens:8192,input_modalities:['text']}]});
        const body=JSON.parse(String(init.body)),planning=body.max_tokens===768;
        state.qwenCalls.push({planning,body});
        const html='<!doctype html><html><head><title>千问完整学习页</title></head><body><h1>千问完整学习页</h1><p>知识结构与交互练习</p><!--'+'完整资料依据。'.repeat(16000)+'--><button onclick="this.textContent=\'已展开\'">展开解释</button></body></html>';
        state.qwenExpected=html;
        const truncate=!planning&&(state.qwenTruncate||body.max_tokens<32768);
        const text=planning?JSON.stringify({version:1,interpretedIntent:'生成风格化交互页面',additionalSources:[],outputRequirements:[]}):truncate?html.slice(0,18709):html;
        return new Response(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:truncate?'length':'stop'}]})}\n\ndata: ${JSON.stringify({choices:[],usage:{prompt_tokens:2000,completion_tokens:truncate?8192:35000,total_tokens:truncate?10192:37000,completion_tokens_details:{reasoning_tokens:0}}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
      };
    });
    let provider=(await command({type:'provider.query'})).view.provider;
    provider=(await command({type:'provider.configure',providerId:'bailian',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',expectedRevision:provider.revision})).view.provider;
    provider=(await command({type:'provider.save-key',providerId:'bailian',key:'SYNTHETIC_QWEN_KEY',expectedRevision:provider.revision})).view.provider;
    provider=(await command({type:'provider.fetch',expectedRevision:provider.revision})).view.provider;
    await command({type:'provider.import-models',modelIds:['qwen3.8-flash'],expectedRevision:provider.revision});
    await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);
    await page.getByRole('button',{name:'切换当前内容',exact:true}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await page.getByLabel('输入草稿',{exact:true}).fill('@风格化交互页面');
    await page.locator('#mention-menu').getByRole('button',{name:'风格化交互页面',exact:true}).click();
    await expect(page.getByRole('button',{name:'移除任务模板 风格化交互页面',exact:true})).toBeVisible();
    await page.getByLabel('输入草稿',{exact:true}).fill('生成完整的风格化交互页面');await site.bringToFront();
    const workspace=(await command({type:'workspace.query'})).view,target={kind:'chat',workspaceId:workspace.workspaceId,chatId:workspace.chatId};
    const query=async()=>(await command({type:'generation.query',target})).view.generation.jobs.at(-1);
    const artifacts=async()=>(await command({type:'knowledge.query',workspaceId:workspace.workspaceId})).view.knowledge.artifacts.filter((a:any)=>a.sourceChatId===workspace.chatId);
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect.poll(async()=>(await query())?.state).toBe('failed');
    const failed=await query();expect(failed.error).toBe('output-limit');
    expect(failed.diagnostics.at(-1)).toMatchObject({purpose:'html-page',providerId:'bailian',modelId:'qwen3.8-flash',maxTokens:131072,cause:'service-length',htmlEnvelope:'missing-end'});
    expect(await artifacts()).toHaveLength(0);
    await expect(page.getByText('模型输出被服务端截断，HTML 未完成，未保存。可手动重试或切换模型。',{exact:true})).toBeVisible();
    await page.bringToFront();await page.screenshot({path:test.info().outputPath('qwen-service-length-360.png')});
    expect(await worker.evaluate(()=>(globalThis as any).qwenCalls.filter((c:any)=>!c.planning).length)).toBe(1);
    await page.getByLabel('输入草稿',{exact:true}).fill('这条新草稿不应进入原请求重试');
    await worker.evaluate(()=>{(globalThis as any).qwenTruncate=false;});
    await page.getByText('失败详情 / 重试',{exact:true}).click();await page.getByRole('button',{name:'重试原请求',exact:true}).click();
    await expect.poll(async()=>(await query())?.state,{timeout:30000}).toBe('completed');
    const completed=await query();expect(completed.jobId).toBe(failed.jobId);expect(completed.attemptId).not.toBe(failed.attemptId);
    const expected=await worker.evaluate(()=>(globalThis as any).qwenExpected);expect(expected.length).toBeGreaterThan(100000);
    expect((await artifacts())[0].source).toBe(expected);
    expect(completed.diagnostics.at(-1)).toMatchObject({cause:'stop',htmlEnvelope:'complete',usage:{outputTokens:35000,reasoningTokens:0}});
    const calls=await worker.evaluate(()=>(globalThis as any).qwenCalls.filter((c:any)=>!c.planning));expect(calls).toHaveLength(2);
    for(const {body} of calls){
      expect(body.max_tokens).toBe(131072);expect(body.enable_thinking).toBe(false);expect(body.stream_options.include_usage).toBe(true);
      expect(body.reasoning_effort).toBeUndefined();expect(body.thinking_budget).toBeUndefined();
      expect(JSON.stringify(body.messages)).toContain('生成完整的风格化交互页面');expect(JSON.stringify(body.messages)).toContain('P2 当前任务模板');
      expect(JSON.stringify(body.messages)).not.toContain('这条新草稿不应进入原请求重试');
      expect(body.messages[0].content).not.toMatch(/131072|本次输出上限/);
    }
    await page.getByRole('button',{name:'打开页面',exact:true}).click();
    const frame=page.frameLocator('.html-page-frame').frameLocator('iframe');
    await expect(frame.getByRole('heading',{name:'千问完整学习页'})).toBeVisible();await frame.getByRole('button',{name:'展开解释'}).click();await expect(frame.getByRole('button',{name:'已展开'})).toBeVisible();
    await page.screenshot({path:test.info().outputPath('qwen-complete-page-360.png')});
    await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);expect((await query()).state).toBe('completed');expect((await artifacts())[0].source).toBe(expected);
    expect(errors).toEqual([]);expect(forbidden).toEqual([]);
    await writeFile(test.info().outputPath('audit.json'),JSON.stringify({model:'qwen3.8-flash',provider:'bailian',maxTokens:131072,htmlChars:expected.length,finalRequests:2,firstFailedWithoutSave:true,manualRetryCompleted:true,reloadExact:true,realPaidCalls:0,pageErrors:errors,forbiddenRequests:forbidden},null,2));
  }finally{await context.close();}
});
