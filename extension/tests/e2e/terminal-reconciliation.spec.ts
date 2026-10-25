import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

for(const mode of ['held','missed-event','all-slow'] as const)test(`a completed note becomes available without stopping (${mode})`,async()=>{
  const {context,page,site,worker}=await setup();
  const command=(operation:unknown)=>page.evaluate(operation=>((window as any).directTaskRequest??chrome.runtime.sendMessage.bind(chrome.runtime))({version:1,requestId:crypto.randomUUID(),operation}),operation);
  try{
    await worker.evaluate(()=>{
      const original=fetch,state=globalThis as any;
      state.taskCalls=0;
      state.fetch=async(url:string,init?:RequestInit)=>{
        if(!String(url).startsWith('https://api.deepseek.com'))return original(url,init);
        if(String(url).endsWith('/models'))return Response.json({data:[{id:'deepseek-flash',input_modalities:['text']}]});
        state.taskCalls++;
        const planning=JSON.parse(String(init?.body)).max_tokens===768;
        const event=(content:string,finish_reason:string|null)=>`data: ${JSON.stringify({choices:[{index:0,delta:{content},finish_reason}]})}\n\n`;
        if(planning)return new Response(event(JSON.stringify({version:1,interpretedIntent:'生成笔记',additionalSources:[],outputRequirements:[]}),'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
        const encoder=new TextEncoder();
        return new Response(new ReadableStream({start(controller){
          controller.enqueue(encoder.encode(event('# 已完成的笔记\n\n',null)));
          state.finishTask=()=>{controller.enqueue(encoder.encode(event('正文完整保存。','stop')+'data: [DONE]\n\n'));controller.close();};
        }}),{headers:{'content-type':'text/event-stream'}});
      };
    });
    let provider=(await command({type:'provider.query'})).view.provider;
    provider=(await command({type:'provider.save-key',providerId:'deepseek',key:'SYNTHETIC_TERMINAL_KEY',expectedRevision:provider.revision})).view.provider;
    provider=(await command({type:'provider.fetch',expectedRevision:provider.revision})).view.provider;
    await command({type:'provider.import-models',modelIds:['deepseek-flash'],expectedRevision:provider.revision});
    await page.addInitScript(()=>{
      const original=chrome.runtime.connect.bind(chrome.runtime);
      chrome.runtime.connect=((...args:any[])=>{
        const port=(original as any)(...args),listen=port.onMessage.addListener.bind(port.onMessage);
        port.onMessage.addListener=(listener:any)=>listen((message:any)=>{if(!(window as any).suppressTaskEvents||message?.type!=='invalidate')listener(message);});
        return port;
      }) as any;
    });
    await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容',exact:true}).click();
    await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await page.getByRole('button',{name:/^产物类型：/}).click();
    await page.getByRole('menuitemradio',{name:'Markdown 笔记',exact:true}).click();
    await page.getByLabel('输入草稿',{exact:true}).fill('生成完整笔记');
    const workspace=(await command({type:'workspace.query'})).view,target={kind:'chat',workspaceId:workspace.workspaceId,chatId:workspace.chatId};
    await page.evaluate(mode=>{
      const state=window as any,original=chrome.runtime.sendMessage.bind(chrome.runtime);
      state.directTaskRequest=original;state.heldTaskRead=false;
      chrome.runtime.sendMessage=(async(message:any)=>{
        const response=await original(message);
        if(mode==='all-slow'&&message.operation?.type==='generation.query')await new Promise(resolve=>setTimeout(resolve,2800));
        if(mode==='held'&&message.operation?.type==='generation.query'&&!state.heldTaskRead&&response.view?.generation?.jobs.some((job:any)=>job.state==='running')){
          state.heldTaskRead=true;
          await new Promise(resolve=>{state.releaseTaskRead=resolve;});
          state.lateReadDelivered=true;
        }
        if(message.operation?.type==='generation.stop')state.stopWasClicked=true;
        return response;
      }) as any;
    },mode);
    await page.getByRole('button',{name:'发送',exact:true}).click();
    if(mode==='held')await expect.poll(()=>page.evaluate(()=>(window as any).heldTaskRead)).toBe(true);
    await expect(page.getByRole('button',{name:'停止生成',exact:true})).toBeVisible();
    await expect.poll(()=>worker.evaluate(()=>typeof (globalThis as any).finishTask)).toBe('function');
    if(mode==='missed-event')await page.evaluate(()=>{(window as any).suppressTaskEvents=true;});
    await worker.evaluate(()=>(globalThis as any).finishTask());
    await expect.poll(async()=>(await command({type:'generation.query',target})).view.generation.jobs.at(-1)?.state).toBe('completed');
    const notes=(await command({type:'artifact.query',workspaceId:target.workspaceId,sourceChatId:target.chatId})).view.artifacts.artifacts;
    expect(notes.at(-1).content).toContain('正文完整保存。');
    await expect.soft(page.getByRole('button',{name:'打开笔记',exact:true}),'saved note must appear without pressing stop').toBeVisible({timeout:6000});
    await expect.soft(page.getByRole('button',{name:'停止生成',exact:true}),'completed job must leave generating state').toHaveCount(0,{timeout:1000});
    await page.screenshot({path:test.info().outputPath('completed-before-stop.png')});
    if(await page.getByRole('button',{name:'停止生成',exact:true}).count()){
      await page.getByRole('button',{name:'停止生成',exact:true}).click();
      await expect(page.getByRole('button',{name:'打开笔记',exact:true})).toBeVisible();
      await page.screenshot({path:test.info().outputPath('completed-after-stop.png')});
    }
    if(mode==='held'){
      await page.evaluate(()=>(window as any).releaseTaskRead());
      await expect.poll(()=>page.evaluate(()=>(window as any).lateReadDelivered)).toBe(true);
    }
    await expect(page.getByRole('button',{name:'打开笔记',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'打开笔记',exact:true}).click();
    await expect(page.locator('.markdown-body')).toContainText('正文完整保存。');
    expect(await worker.evaluate(()=>(globalThis as any).taskCalls)).toBe(2);
    await writeFile(test.info().outputPath('result.json'),JSON.stringify({mode,stopWasClicked:await page.evaluate(()=>(window as any).stopWasClicked??false),providerCalls:2,lateReadRolledBack:false},null,2));
  }finally{await context.close();}
});

for(const mode of ['held','all-slow'] as const)test(`SPA video changes bypass old workspace reads without rolling back the chat or new draft (${mode})`,async()=>{
  const {context,page,site}=await setup();
  try{
    const workspace=await page.evaluate(async()=>{const response=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'workspace.query'}});return response.view;});
    await page.evaluate(mode=>{
      const state=window as any,original=chrome.runtime.sendMessage.bind(chrome.runtime);
      state.holdNextWorkspace=true;
      chrome.runtime.sendMessage=(async(message:any)=>{
        const response=await original(message);
        if(mode==='all-slow'&&message.operation?.type==='workspace.query'){state.workspaceHeld=true;await new Promise(resolve=>setTimeout(resolve,2800));}
        if(mode==='held'&&message.operation?.type==='workspace.query'&&state.holdNextWorkspace){
          state.holdNextWorkspace=false;state.workspaceHeld=true;
          await new Promise(resolve=>{state.releaseWorkspace=resolve;});state.workspaceDelivered=true;
        }
        return response;
      }) as any;
    },mode);
    // A saved draft produces a real invalidation before navigation. No UI draft
    // mutation or direct refresh is used to bypass the subscription under test.
    await page.evaluate(async workspace=>{await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'draft.save',target:{workspaceId:workspace.workspaceId,chatId:workspace.chatId},expectedRevision:workspace.draft.revision,draft:workspace.draft}});},workspace);
    await expect.poll(()=>page.evaluate(()=>(window as any).workspaceHeld)).toBe(true);
    await site.evaluate(()=>{
      history.pushState({},'','/video/BVterminal/?p=1');
      (window as any).__INITIAL_STATE__={videoData:{bvid:'BVterminal',title:'新视频的工作区',pages:[{page:1,cid:91,part:'新视频'}]}};
      (window as any).player={getVideoMessage:()=>({bvid:'BVterminal',cid:91})};
      void fetch('https://api.bilibili.com/x/player/wbi/v2?cid=91&bvid=BVterminal');
    });
    await expect(page.locator('.context-current-button')).toContainText('新视频的工作区',{timeout:5500});
    await page.getByLabel('输入草稿',{exact:true}).fill('新视频的新问题');
    if(mode==='held'){
      await page.evaluate(()=>(window as any).releaseWorkspace());
      await expect.poll(()=>page.evaluate(()=>(window as any).workspaceDelivered)).toBe(true);
    }
    await expect(page.locator('.context-current-button')).toContainText('新视频的工作区');
    await expect(page.getByLabel('输入草稿',{exact:true})).toHaveValue('新视频的新问题');
    await page.screenshot({path:test.info().outputPath('switched-with-old-read-pending.png')});
  }finally{await context.close();}
});

test('automatic video following preserves an outgoing draft without waiting for its save acknowledgement',async()=>{
  const {context,page,site}=await setup();
  try{
    await page.evaluate(()=>{
      const state=window as any,original=chrome.runtime.sendMessage.bind(chrome.runtime);
      state.directTaskRequest=original;
      chrome.runtime.sendMessage=(async(message:any)=>{
        const response=await original(message);
        if(message.operation?.type==='draft.save'&&message.operation.draft.text==='旧视频尚在确认的草稿'&&!state.oldWriteHeld){
          state.oldWriteHeld=true;await new Promise(resolve=>{state.releaseOldWrite=resolve;});
        }
        return response;
      }) as any;
    });
    await page.getByLabel('输入草稿',{exact:true}).fill('旧视频尚在确认的草稿');
    await expect.poll(()=>page.evaluate(()=>(window as any).oldWriteHeld)).toBe(true);
    await site.evaluate(()=>{
      history.pushState({},'','/video/BVdraft/?p=1');
      (window as any).__INITIAL_STATE__={videoData:{bvid:'BVdraft',title:'草稿确认期间的新视频',pages:[{page:1,cid:92,part:'新视频'}]}};
      (window as any).player={getVideoMessage:()=>({bvid:'BVdraft',cid:92})};
      void fetch('https://api.bilibili.com/x/player/wbi/v2?cid=92&bvid=BVdraft');
    });
    await expect.soft(page.locator('.context-current-button')).toContainText('草稿确认期间的新视频',{timeout:4000});
    await page.evaluate(()=>(window as any).releaseOldWrite());
    await expect(page.locator('.context-current-button')).toContainText('草稿确认期间的新视频');
    await page.getByLabel('输入草稿',{exact:true}).fill('仅属于新视频的草稿');
    await expect.poll(()=>page.evaluate(async()=>{const response=await (window as any).directTaskRequest({version:1,requestId:crypto.randomUUID(),operation:{type:'workspace.query'}});return response.view.draft?.text;})).toBe('仅属于新视频的草稿');
    await site.evaluate(()=>{
      history.pushState({},'','/video/BVexperience/?p=1');
      (window as any).__INITIAL_STATE__={videoData:{bvid:'BVexperience',title:'体验修复本地夹具',pages:[{page:1,cid:11,part:'第一部分'}]}};
      (window as any).player={getVideoMessage:()=>({bvid:'BVexperience',cid:11})};
      void fetch('https://api.bilibili.com/x/player/wbi/v2?cid=11&bvid=BVexperience');
    });
    await expect(page.getByLabel('输入草稿',{exact:true})).toHaveValue('旧视频尚在确认的草稿');
    await page.screenshot({path:test.info().outputPath('drafts-remain-separated.png')});
  }finally{await context.close();}
});
