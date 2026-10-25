import {startNewChat} from './workbench-actions';
import {expect,test} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

for(const mode of ['actual-nine','invalid-empty'] as const)test(`production visual note handles ${mode} cue references without extra retries or invalid captures`,async()=>{
  test.setTimeout(120000);
  const proposal=JSON.parse(await readFile('tests/fixtures/vision-plan-nine-cues.json','utf8'));
  if(mode==='invalid-empty')proposal.evidence[4].windows[0].cueIds=[];
  const cues=Array.from({length:200},(_,id)=>({from:id*2+.125,to:id*2+1.875,content:`合成字幕 ${id}`}));
  const {context,page,site,worker}=await setup({mediaPath:'tests/fixtures/vision-407-synthetic.mp4',cues,title:'九条字幕引用回归',relayOrigin:'https://unused-fixture.test'});
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  try{
    await worker.evaluate(proposal=>{
      const original=fetch,state=globalThis as any;state.cueCalls=[];
      state.fetch=async(input:any,init?:RequestInit)=>{
        if(!String(input).startsWith('https://api.deepseek.com'))return original(input,init);
        if(String(input).endsWith('/models'))return Response.json({data:[{id:'deepseek-flash',input_modalities:['text','image']}]});
        const body=JSON.parse(String(init?.body)),system=String(body.messages[0].content),kind=system.includes('[P1:requirements-plan]')?'requirements':system.includes('[P1:vision-plan]')?'plan':system.includes('[P1:vision-review]')?'review':'answer';
        state.cueCalls.push({kind,body});
        const content=kind==='requirements'?JSON.stringify({version:1,interpretedIntent:'按字幕和实际画面整理笔记',additionalSources:[],outputRequirements:[]})
          :kind==='plan'?JSON.stringify(proposal)
          :kind==='review'?JSON.stringify({version:3,results:JSON.parse(body.messages[1].content[0].text).targets.map((target:any)=>({evidenceId:target.evidenceId,checks:target.checks.map((check:any)=>({checkId:check.checkId,status:'uncertain',imageRefs:target.imageRefs,observation:'合成黑色画面不提供价格或架构事实'})),refinements:[]}))})
          :'# 回放完成的笔记\n\n合成字幕用于验证流程；未确认的画面事实保留为缺口。';
        return new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
      };
    },proposal);
    let provider=(await command({type:'provider.query'})).view.provider;
    provider=(await command({type:'provider.save-key',providerId:'deepseek',key:'SYNTHETIC_CUE_BOUNDARY_KEY',expectedRevision:provider.revision})).view.provider;
    provider=(await command({type:'provider.fetch',expectedRevision:provider.revision})).view.provider;
    await command({type:'provider.import-models',modelIds:['deepseek-flash'],expectedRevision:provider.revision});
    const workspace=(await command({type:'workspace.query'})).view;
    const subtitles=(await command({type:'subtitles.query',workspaceId:workspace.workspaceId})).view.subtitles;
    expect((await command({type:'subtitles.source.select',workspaceId:workspace.workspaceId,source:{kind:'native',language:'zh-CN'},expectedRevision:subtitles.sourceRevision})).ok).toBe(true);
    await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);await site.bringToFront();
    await startNewChat(page);
    await page.getByLabel('输入草稿',{exact:true}).fill('@独立阅读文档');
    await page.locator('#mention-menu').getByRole('button',{name:'独立阅读文档',exact:true}).click();
    await page.getByRole('button',{name:'更多输入操作',exact:true}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();
    const space=(await command({type:'workspace.query'})).view,target={kind:'chat',workspaceId:space.workspaceId,chatId:space.chatId};
    const query=async()=>(await command({type:'generation.query',target})).view.generation.jobs.at(-1);
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect.poll(async()=>{const job=await query();return job&&['completed','awaiting-permission','failed'].includes(job.state)?job.state:'running';},{timeout:60000}).not.toBe('running');
    let job=await query();
    await writeFile(test.info().outputPath('first-result.json'),JSON.stringify({mode,state:job.state,visual:job.visual},null,2));
    if(mode==='actual-nine'){
      expect(job.state).toBe('completed');
      const window=job.visual.evidencePlan.evidence[4].windows[0];
      expect(window.cueIds).toHaveLength(8);expect(window.cueIds).toEqual(expect.arrayContaining([82,85,91]));
      expect(window).toMatchObject({from:cues[82].from,to:cues[91].to,anchor:(cues[85].from+cues[85].to)/2});
      expect(job.visual.planningCorrection).toBeUndefined();expect(job.visual.planningFailure).toBeUndefined();
      expect(job.visual.attachmentIds.length).toBeGreaterThan(0);expect(job.visual.attachmentIds.length).toBeLessThanOrEqual(6);
      expect(job.visual.audit.samplingNotes.join('')).toContain('9');
    }else{
      expect(job).toMatchObject({state:'awaiting-permission',visual:{attachmentIds:[],planningFailure:{code:'invalid-schema',fields:['evidence.4.windows.0.cueIds']},planningCorrection:{outcome:'failed'}}});
      const calls=await worker.evaluate(()=>(globalThis as any).cueCalls),plans=calls.filter((call:any)=>call.kind==='plan');
      expect(plans).toHaveLength(2);
      expect(JSON.parse(plans[1].body.messages.at(-1).content)).toMatchObject({constraints:{cueIds:{minItems:1,maxItems:64,maxId:199}}});
      await page.getByRole('button',{name:'仅用字幕继续',exact:true}).click();
      await expect.poll(async()=>(await query())?.state).toBe('completed');job=await query();
      expect(job.visual.attachmentIds).toEqual([]);
    }
    await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'打开笔记',exact:true}).click();
    await expect(page.getByRole('heading',{name:'回放完成的笔记',exact:true})).toBeVisible();
    const calls=await worker.evaluate(()=>(globalThis as any).cueCalls.map((call:any)=>call.kind));
    expect(calls).toEqual(mode==='actual-nine'?['requirements','plan','review','answer']:['requirements','plan','plan','answer']);
    await writeFile(test.info().outputPath('completed-result.json'),JSON.stringify({mode,state:job.state,visual:job.visual,calls,paidModelCalls:0},null,2));
    await page.screenshot({path:test.info().outputPath('note-completed.png')});
  }finally{await context.close();}
});
