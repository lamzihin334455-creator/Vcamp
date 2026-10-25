import {startNewChat} from './workbench-actions';
import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

for(const longAnswer of [false,true])test(`completed ${longAnswer?'long':'short'} answers release the composer and follow SPA videos while a post-submit refresh is slow`,async()=>{
  const {context,page,site,worker}=await setup();
  const command=(operation:unknown)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  try{
    await worker.evaluate(longAnswer=>{
      const original=fetch;
      (globalThis as any).completionCalls=0;
      globalThis.fetch=async(url,init)=>{
        if(!String(url).startsWith('https://api.deepseek.com'))return original(url,init);
        if(String(url).endsWith('/models'))return Response.json({data:[{id:'deepseek-flash',input_modalities:['text']}]});
        const planning=JSON.parse(String(init?.body)).max_tokens===768;
        (globalThis as any).completionCalls++;
        const content=planning?JSON.stringify({version:1,interpretedIntent:'本次问题',additionalSources:[],outputRequirements:[]}):longAnswer?'完整长回答。'.repeat(12000)+'正文终点':'本次回答已完整生成。';
        return new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
      };
    },longAnswer);
    let provider=(await command({type:'provider.query'})).view.provider;
    provider=(await command({type:'provider.save-key',providerId:'deepseek',key:'SYNTHETIC_COMPLETION_KEY',expectedRevision:provider.revision})).view.provider;
    provider=(await command({type:'provider.fetch',expectedRevision:provider.revision})).view.provider;
    await command({type:'provider.import-models',modelIds:['deepseek-flash'],expectedRevision:provider.revision});
    await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);await site.bringToFront();
    const oldChat=(await command({type:'workspace.query'})).view.chatId;
    await startNewChat(page);
    await expect.poll(async()=>(await command({type:'workspace.query'})).view.chatId).not.toBe(oldChat);
    await page.getByLabel('输入草稿',{exact:true}).fill('概括这个视频');
    await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
    const workspace=(await command({type:'workspace.query'})).view;
    const target={kind:'chat',workspaceId:workspace.workspaceId,chatId:workspace.chatId};
    // Delay one actual workspace response, without changing product state or
    // delaying the generation terminal notification. Release it after the test.
    await page.evaluate(()=>{
      const state=window as any,original=chrome.runtime.sendMessage.bind(chrome.runtime);
      state.slowRead={sent:false,held:false};
      chrome.runtime.sendMessage=(async(message:any)=>{
        const response=await original(message);
        if(message.operation?.type==='generation.send')state.slowRead.sent=true;
        else if(message.operation?.type==='workspace.query'&&state.slowRead.sent&&!state.slowRead.held){
          state.slowRead.held=true;
          await new Promise(resolve=>{state.releaseSlowRead=resolve;});
          state.slowRead.delivered=true;
        }
        return response;
      }) as any;
    });
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect.poll(async()=>(await command({type:'generation.query',target})).view.generation.jobs.at(-1)?.state).toBe('completed');
    await expect(page.locator('.chat-turn.assistant').last()).toContainText(longAnswer?'正文终点':'本次回答已完整生成。');
    await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>(window as any).slowRead.held)).toBe(true);
    const header=page.locator('.context-current-button .sr-only');
    const completedAt=Date.now();
    await expect.soft(header,'completed task must not leave a generating/submission lock').not.toHaveText('正在生成',{timeout:1800});
    const completionStatusMs=Date.now()-completedAt;
    await page.screenshot({path:test.info().outputPath('answer-completed.png')});
    // Same document navigation, no panel reload and no release of the old read.
    const switchingAt=Date.now();
    await site.evaluate(()=>{
      history.pushState({},'','/video/BVregression/?p=1');
      (window as any).__INITIAL_STATE__={videoData:{bvid:'BVregression',title:'切换后的新视频',pages:[{page:1,cid:91,part:'新视频'}]}};
      (window as any).player={getVideoMessage:()=>({bvid:'BVregression',cid:91})};
      void fetch('https://api.bilibili.com/x/player/wbi/v2?cid=91&bvid=BVregression');
    });
    await expect(page.locator('.context-current-button')).toContainText('切换后的新视频',{timeout:3500});
    const switchMs=Date.now()-switchingAt;
    await page.getByLabel('输入草稿',{exact:true}).fill('新视频的问题');
    await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
    await page.evaluate(()=>(window as any).releaseSlowRead());
    await expect.poll(()=>page.evaluate(()=>(window as any).slowRead.delivered)).toBe(true);
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await expect(page.locator('.context-current-button')).toContainText('切换后的新视频');
    await expect(page.getByLabel('输入草稿',{exact:true})).toHaveValue('新视频的问题');
    expect(await worker.evaluate(()=>(globalThis as any).completionCalls)).toBe(2);
    await writeFile(test.info().outputPath('result.json'),JSON.stringify({longAnswer,completionStatusMs,switchMs,lateResponseRolledBack:false,providerCalls:2},null,2));
    await page.screenshot({path:test.info().outputPath('completed-and-switched.png')});
  }finally{await context.close();}
});
