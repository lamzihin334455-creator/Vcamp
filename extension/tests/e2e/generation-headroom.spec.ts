import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

for(const variant of ['deepseek','bailian','bailian-qwen'] as const)test(`production ${variant}: long chat, note and HTML complete without padding prompts or increased thinking`,async()=>{
  test.setTimeout(90000);
  const {context,page,worker,site}=await setup();
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  try{
    await page.setViewportSize({width:360,height:800});
    const providerId=variant==='deepseek'?'deepseek':'bailian',qwen=variant==='bailian-qwen';
    const model=providerId==='deepseek'?'deepseek-flash':qwen?'qwen3.8-flash':'deepseek-v4.1-flash-1017';
    await worker.evaluate(({providerId,model,qwen})=>{
      const original=fetch,state=globalThis as any;state.headroomCalls=[];state.nextOutput='chat';
      state.fetch=async(url:string,init:RequestInit={})=>{
        const address=String(url),base=providerId==='deepseek'?'https://api.deepseek.com':'https://dashscope.aliyuncs.com/compatible-mode/v1';
        if(!address.startsWith(base))return original(url,init);
        if(address.endsWith('/models'))return Response.json({data:[{id:model,max_output_tokens:qwen?8192:393216,input_modalities:['text']}]});
        const body=JSON.parse(String(init.body)),planning=body.max_tokens===768;
        const long='任务所需的完整依据。'.repeat(15000)+'正文终点';
        const output=state.nextOutput==='html'?`<!doctype html><html><head><title>完整长页面</title></head><body><h1>完整长页面</h1><!--${long}--><button onclick="this.textContent='操作成功'">展开</button></body></html>`:state.nextOutput==='markdown'?'# 完整长笔记\n\n'+long:long;
        state.headroomCalls.push({planning,body});
        if(!planning)state.expectedOutput=output;
        const text=planning?JSON.stringify({version:1,interpretedIntent:'本次任务',additionalSources:[],outputRequirements:[]}):output;
        const truncated=qwen&&!planning&&body.max_tokens<32768;
        return new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{content:truncated?text.slice(0,18709):text},finish_reason:truncated?'length':'stop'}],usage:{completion_tokens:planning?20:30000,completion_tokens_details:{reasoning_tokens:0}}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
      };
    },{providerId,model,qwen});
    let view=(await command({type:'provider.query'})).view.provider;
    if(providerId==='bailian')view=(await command({type:'provider.configure',providerId,baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',expectedRevision:view.revision})).view.provider;
    view=(await command({type:'provider.save-key',providerId,key:'SYNTHETIC_HEADROOM_KEY',expectedRevision:view.revision})).view.provider;
    view=(await command({type:'provider.fetch',expectedRevision:view.revision})).view.provider;
    expect(view.catalog[0].maxOutputTokens).toBe(qwen?8192:393216);
    await command({type:'provider.import-models',modelIds:[model],expectedRevision:view.revision});
    await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);await site.bringToFront();
    for(const output of ['chat','markdown','html'] as const){
      const old=(await command({type:'workspace.query'})).view.chatId;
      await page.getByRole('button',{name:'切换当前内容',exact:true}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
      await expect.poll(async()=>(await command({type:'workspace.query'})).view.chatId).not.toBe(old);
      if(output!=='chat'){
        await page.getByRole('button',{name:/^产物类型：/}).click();await page.getByRole('menuitemradio',{name:output==='markdown'?'Markdown 笔记':'HTML 页面',exact:true}).click();
      }
      await worker.evaluate(output=>{(globalThis as any).nextOutput=output;},output);
      await page.getByLabel('输入草稿',{exact:true}).fill('按本次需要生成完整内容');
      const workspace=(await command({type:'workspace.query'})).view,target={kind:'chat',workspaceId:workspace.workspaceId,chatId:workspace.chatId};
      await page.getByRole('button',{name:'发送',exact:true}).click();
      const query=async()=>(await command({type:'generation.query',target})).view.generation.jobs.at(-1);
      await expect.poll(async()=>(await query())?.state,{timeout:30000}).toBe('completed');
      const expected=await worker.evaluate(()=>(globalThis as any).expectedOutput);
      expect(expected.length).toBeGreaterThan(100000);
      if(output==='chat')expect((await query()).text).toBe(expected);
      if(output==='markdown')expect((await command({type:'artifact.query',workspaceId:workspace.workspaceId,sourceChatId:workspace.chatId})).view.artifacts.artifacts[0].content).toBe(expected);
      if(output==='html'){
        expect((await command({type:'knowledge.query',workspaceId:workspace.workspaceId})).view.knowledge.artifacts.find((a:any)=>a.sourceChatId===workspace.chatId).source).toBe(expected);
        await page.getByRole('button',{name:'打开页面',exact:true}).click();
        const frame=page.frameLocator('.html-page-frame').frameLocator('iframe');
        await expect(frame.getByRole('heading',{name:'完整长页面'})).toBeVisible();await frame.getByRole('button',{name:'展开',exact:true}).click();await expect(frame.getByRole('button',{name:'操作成功'})).toBeVisible();
        await page.bringToFront();await page.screenshot({path:test.info().outputPath(`${variant}-long-page-360.png`)});
      }
      await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);expect((await query()).state).toBe('completed');await site.bringToFront();
    }
    const calls=await worker.evaluate(()=>(globalThis as any).headroomCalls),final=calls.filter((c:any)=>!c.planning);
    expect(calls).toHaveLength(6);expect(final).toHaveLength(3);
    for(const {body} of final){
      expect(body.max_tokens).toBe(qwen?131072:393216);expect(body.reasoning_effort).toBeUndefined();expect(body.thinking_budget).toBeUndefined();
      expect(body[providerId==='deepseek'?'thinking':'enable_thinking']).toEqual(providerId==='deepseek'?{type:'disabled'}:false);
      expect(body.messages[0].content).toContain('完成任务即可结束');expect(body.messages[0].content).not.toMatch(/131072|393216|本次输出上限|源码硬上限/);
      if(qwen)expect(body.stream_options).toEqual({include_usage:true});
    }
  }finally{await context.close();}
});
