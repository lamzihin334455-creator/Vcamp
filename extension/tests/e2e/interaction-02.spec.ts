import {startNewChat} from './workbench-actions';
import {test,expect} from '@playwright/test';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {setup} from './interaction-fixture';
import {unzipSync,strFromU8} from 'fflate';

const output=resolve('../.tmp/interaction-02');
test('HTML trusted click directly seeks, rejects synthetic navigation and keeps local anchors',async()=>{
  const {context,page,site,fixture,id}=await setup();
  try{
    await page.getByRole('button',{name:'HTML',exact:true}).click();const content=page.frameLocator('.html-page-frame').frameLocator('iframe');
    await expect(content.getByRole('heading',{name:'导航与来源'})).toBeVisible();expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(0.5);
    await content.getByRole('link',{name:'00:02',exact:true}).click();
    await expect(page.getByRole('group',{name:'页面导航确认'})).toHaveCount(0);
    await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(2,2);
    expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
    const before=context.pages().length;
    await content.getByRole('button',{name:'00:03',exact:true}).evaluate((b:HTMLButtonElement)=>b.click());
    await content.getByRole('button',{name:'00:03',exact:true}).evaluate((b:HTMLButtonElement)=>new Promise<void>(resolve=>setTimeout(()=>{b.click();resolve();},30)));
    expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(2);expect(context.pages()).toHaveLength(before);
    await content.getByRole('link',{name:'中文锚点',exact:true}).click();await expect(content.getByRole('heading',{name:'目标解释'})).toBeInViewport();
    await page.screenshot({path:resolve(output,'direct-seek.png')});
    // From a fixed saved reader while B is active, the user's click must reuse
    // A's already-open decoder instead of seeking B or creating another A tab.
    const reader=await context.newPage();await reader.goto(`chrome-extension://${id}/reader.html?workspaceId=${encodeURIComponent(fixture.workspaceId)}&knowledgeId=${fixture.htmlId}`);
    const b=await context.newPage();await b.goto('https://www.bilibili.com/video/BVsecond/?p=1');await b.bringToFront();await expect.poll(()=>b.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
    const beforeReuse=context.pages().length;await reader.frameLocator('.html-page-frame').frameLocator('iframe').getByRole('link',{name:'00:04',exact:true}).click();
    await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(4,2);expect(context.pages()).toHaveLength(beforeReuse);expect(await b.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(0);
    await writeFile(resolve(output,'direct-seek-result.json'),JSON.stringify({trustedSingleClick:true,noConfirmation:true,syntheticClickIgnored:true,localAnchor:true,reusedPersistedSource:true,noBSeek:true,noDuplicateTab:true,externalModelCalls:0},null,2));
  }finally{await context.close();}
});

test('single-part site metadata hides P1 while a multi-part video with one saved part retains P',async()=>{
  const {context,page,site}=await setup();
  try{
    await site.goto('https://www.bilibili.com/video/BVsingle/?p=1');await site.bringToFront();await expect(page.locator('.context-current-button strong')).toHaveText('单视频样本');await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    await page.getByRole('button',{name:'导出',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:/^字幕/}).click();await expect(dialog.getByLabel('导出分 P')).toHaveCount(0);expect(await dialog.innerText()).not.toContain('P1');await page.screenshot({path:resolve(output,'single-video.png')});await dialog.getByRole('checkbox',{name:/原始字幕 · 中文/}).check();await dialog.getByRole('radio',{name:'分别下载'}).check();await dialog.getByRole('button',{name:'开始导出'}).click();await expect(dialog.getByRole('status')).toContainText('source.txt：下载完成');const files=await page.evaluate(()=>chrome.downloads.search({state:'complete'}));expect(files).toHaveLength(2);expect(files.every(f=>!f.filename.includes('_P1'))).toBe(true);expect(await readFile(files.find(f=>f.filename.endsWith('.source.txt'))!.filename,'utf8')).not.toContain('P1');expect(await readFile(files.find(f=>f.filename.endsWith('.source.txt'))!.filename,'utf8')).toContain('?p=1');await dialog.getByRole('button',{name:'关闭导出'}).click();
    await site.goto('https://www.bilibili.com/video/BVmultiOnly/?p=1');await site.bringToFront();await expect(page.locator('.context-current-button strong')).toContainText('P1');await page.getByRole('button',{name:'导出',exact:true}).click();await expect(dialog.getByLabel('导出分 P')).toBeVisible();await expect(dialog.getByLabel('导出分 P').getByRole('option')).toHaveCount(2);await expect(dialog.getByLabel('导出分 P')).toContainText('P1');await page.screenshot({path:resolve(output,'multi-one-saved.png')});await writeFile(resolve(output,'part-label-result.json'),JSON.stringify({siteSingleHidesP1:true,downloadNamesHideP1:true,sourceRetainsIdentity:true,multiWithOneSavedRetainsP1:true,externalModelCalls:0},null,2));
  }finally{await context.close();}
});

test('generation stays in the worker and frozen A while the workbench follows B',async()=>{
  test.setTimeout(60000);const {context,page,site,worker,fixture}=await setup();
  try{
    await worker.evaluate(()=>{const original=fetch; (globalThis as any).syntheticCalls=[];globalThis.fetch=(async(input:any,init:any)=>{
      if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
      if(!init?.method||init.method==='GET')return new Response(JSON.stringify({object:'list',data:[{id:'local-fixture',input_modalities:['text','image']}]}),{headers:{'content-type':'application/json'}});
      const request=JSON.parse(init.body),system=String(request.messages?.[0]?.content??''),kind=system.includes('[P1:requirements-plan]')?'requirements':'answer';(globalThis as any).syntheticCalls.push({kind,model:request.model,hasB:JSON.stringify(request.messages).includes('B 视频样本')});
      if(kind==='requirements')return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:JSON.stringify({version:1,interpretedIntent:'根据A视频生成独立HTML学习页',additionalSources:[],outputRequirements:[]})},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      return new Response(new ReadableStream({start(c){const event=(text:string,finish:string|null=null)=>new TextEncoder().encode('data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:finish}]})+'\n\n');c.enqueue(event('<!doctype html><html><head><title>A 冻结结果</title></head><body><h1>A 独立答案</h1>'));(globalThis as any).finishSynthetic=()=>{c.enqueue(event('<a href="vcamp-time:2">00:02</a></body></html>','stop'));c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));c.close();};init.signal?.addEventListener('abort',()=>c.error(new DOMException('Aborted','AbortError')));}}),{headers:{'content-type':'text/event-stream'}});
    }) as typeof fetch;});
    const command=(operation:any)=>page.evaluate(async operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_LOCAL_ONLY'})).ok).toBe(true);const fetched=await command({type:'provider.fetch',expectedRevision:1});expect(fetched.view.provider.status).toBe('ready');expect((await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-fixture']})).ok).toBe(true);
    await page.reload();await site.bringToFront();await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    await startNewChat(page);await expect(page.locator('.context-module')).toHaveText('对话 02');fixture.chatId=(await command({type:'workspace.query'})).view.chatId;
    await page.getByLabel('输入草稿').fill('A 视频的独立 HTML 学习页');await page.getByRole('button',{name:/产物类型/}).click();await page.getByRole('menuitemradio',{name:/HTML/}).click();
    const pagesBefore=context.pages().length;await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).syntheticCalls.map((call:any)=>call.kind))).toEqual(['requirements','answer']);
    await expect.poll(async()=>{const r=await command({type:'generation.query',target:{kind:'chat',workspaceId:fixture.workspaceId,chatId:fixture.chatId}});return r.view.generation.jobs.at(-1)?.state;}).toBe('running');expect(context.pages()).toHaveLength(pagesBefore);
    await site.goto('https://www.bilibili.com/video/BVsecond/?p=1');await site.bringToFront();await expect(page.locator('.context-current-button strong')).toContainText('B 视频样本');
    await page.getByLabel('输入草稿').fill('B 保留的未发送草稿');await worker.evaluate(()=>(globalThis as any).finishSynthetic());
    await expect.poll(async()=>{const r=await command({type:'generation.query',target:{kind:'chat',workspaceId:fixture.workspaceId,chatId:fixture.chatId}});return r.view.generation.jobs.at(-1).state;}).toBe('completed');
    await expect(page.locator('.context-current-button strong')).toContainText('B 视频样本');await expect(page.getByLabel('输入草稿')).toHaveValue('B 保留的未发送草稿');await expect(page.getByText('A 独立答案',{exact:true})).toHaveCount(0);expect(context.pages()).toHaveLength(pagesBefore);expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(0);
    await site.goto('https://www.bilibili.com/video/BVexperience/?p=1');await site.bringToFront();await expect(page.getByRole('button',{name:'打开页面',exact:true}).last()).toBeVisible();await page.getByRole('button',{name:'打开页面',exact:true}).last().click();
    const content=page.frameLocator('.html-page-frame').frameLocator('iframe');await expect(content.getByRole('heading',{name:'A 独立答案'})).toBeVisible();await content.getByRole('link',{name:'00:02'}).click();await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(2,2);
    const calls=await worker.evaluate(()=>(globalThis as any).syntheticCalls);expect(calls).toEqual([{kind:'requirements',model:'local-fixture',hasB:false},{kind:'answer',model:'local-fixture',hasB:false}]);await writeFile(resolve(output,'generation-result.json'),JSON.stringify({frozenA:true,workbenchB:true,draftBPreserved:true,noCreatedTabs:true,noBSeek:true,completedA:true,syntheticTransportCalls:calls.length,externalModelCalls:0},null,2));
  }finally{await context.close();}
});

test('pending A media is lost on switching to B and only explicit subtitle continuation resumes A',async()=>{
  test.setTimeout(60000);const {context,page,site,worker,fixture}=await setup();
  try{
    await worker.evaluate(()=>{const original=fetch;(globalThis as any).visionCalls=[];globalThis.fetch=(async(input:any,init:any)=>{
      if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
      if(!init?.method||init.method==='GET')return new Response(JSON.stringify({object:'list',data:[{id:'local-fixture',input_modalities:['text','image']}]}),{headers:{'content-type':'application/json'}});
      const request=JSON.parse(init.body),serialized=JSON.stringify(request.messages),system=String(request.messages?.[0]?.content??''),plan=system.includes('[P1:vision-plan]'),requirements=system.includes('[P1:requirements-plan]'),review=system.includes('[P1:vision-review]'),kind=requirements?'requirements':plan?'vision':review?'review':'answer';
      (globalThis as any).visionCalls.push({kind,hasB:serialized.includes('B 视频样本'),hasImages:serialized.includes('image_url')});
      return new Response(new ReadableStream({start(c){const finish=()=>{const content=requirements?JSON.stringify({version:1,interpretedIntent:'完成当前请求',additionalSources:[],outputRequirements:[]}):plan?JSON.stringify({version:3,scope:'focused',evidence:[{need:'核对A视频画面主体',priority:'required',mode:'single',windows:[{cueIds:[0]}],detailNeed:'overview',readTargets:[],checkTargets:['画面主体'],reason:'按A原字幕定位实际画面'}],unresolved:[]}):review?JSON.stringify({version:3,results:JSON.parse(request.messages[1].content[0].text).targets.map((t:any)=>({evidenceId:t.evidenceId,checks:t.checks.map((check:any)=>({checkId:check.checkId,status:'confirmed',imageRefs:t.imageRefs,observation:'本地模拟核验画面主体'})),refinements:[]}))}):'A 字幕继续完成';c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));c.close();};if(plan)(globalThis as any).finishPlan=finish;else finish();init.signal?.addEventListener('abort',()=>c.error(new DOMException('Aborted','AbortError')));}}),{headers:{'content-type':'text/event-stream'}});
    }) as typeof fetch;});
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    expect((await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_LOCAL_ONLY'})).ok).toBe(true);const fetched=await command({type:'provider.fetch',expectedRevision:1});await command({type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-fixture']});
    await page.reload();await site.bringToFront();await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    await startNewChat(page);await expect(page.locator('.context-module')).toHaveText('对话 02');fixture.chatId=(await command({type:'workspace.query'})).view.chatId;
    await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();
    await page.getByLabel('输入草稿').fill('A 的原视频画面说明');await page.getByRole('button',{name:'发送',exact:true}).click();
    const query=async()=> (await command({type:'generation.query',target:{kind:'chat',workspaceId:fixture.workspaceId,chatId:fixture.chatId}})).view.generation.jobs.at(-1);
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).visionCalls.length)).toBe(2);const pagesBefore=context.pages().length;
    await site.goto('https://www.bilibili.com/video/BVsecond/?p=1');await site.bringToFront();await expect(page.locator('.context-current-button strong')).toContainText('B 视频样本');await worker.evaluate(()=>(globalThis as any).finishPlan());
    await expect.poll(async()=> (await query()).state).toBe('awaiting-permission');const waiting=await query();expect(waiting.visual).toMatchObject({issue:'media',mediaFailure:'source-changed',attachmentIds:[]});expect(await worker.evaluate(()=>(globalThis as any).visionCalls.length)).toBe(2);expect(context.pages()).toHaveLength(pagesBefore);expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(0);
    await site.goto('https://www.bilibili.com/video/BVexperience/?p=1');await site.bringToFront();await expect(page.getByRole('button',{name:'仅用字幕继续',exact:true})).toBeVisible();await page.screenshot({path:resolve(output,'media-loss-hold.png')});await page.getByRole('button',{name:'仅用字幕继续',exact:true}).click();await expect.poll(async()=> (await query()).state).toBe('completed');
    const calls=await worker.evaluate(()=>(globalThis as any).visionCalls);expect(calls).toEqual([{kind:'requirements',hasB:false,hasImages:false},{kind:'vision',hasB:false,hasImages:false},{kind:'answer',hasB:false,hasImages:false}]);expect((await query()).visual).toMatchObject({resolution:'subtitle',attachmentIds:[]});expect(context.pages()).toHaveLength(pagesBefore);
    // Positive path: worker execution still captures the actual original MP4,
    // attaches the frame to this A task, and restores the untouched player.
    await startNewChat(page);await expect(page.locator('.context-module')).toHaveText('对话 03');fixture.chatId=(await command({type:'workspace.query'})).view.chatId;
    await page.getByRole('button',{name:'更多输入操作'}).click();await page.getByRole('button',{name:/^开启自主识别画面/}).click();await page.getByLabel('输入草稿').fill('A 的单帧依据');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>worker.evaluate(()=>(globalThis as any).visionCalls.length)).toBe(5);await site.bringToFront();const originalTime=await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime);await worker.evaluate(()=>(globalThis as any).finishPlan());await expect.poll(async()=> (await query()).state).toBe('completed');
    expect((await query()).visual.attachmentIds).toHaveLength(1);expect((await query()).visual.review.status).toBe('complete');expect((await query()).visual.review.correction).toBeUndefined();const allCalls=await worker.evaluate(()=>(globalThis as any).visionCalls);expect(allCalls).toEqual([...calls,{kind:'requirements',hasB:false,hasImages:false},{kind:'vision',hasB:false,hasImages:false},{kind:'review',hasB:false,hasImages:true},{kind:'answer',hasB:false,hasImages:true}]);await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(originalTime,2);expect(await site.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);expect(context.pages()).toHaveLength(pagesBefore);
    await writeFile(resolve(output,'media-loss-result.json'),JSON.stringify({heldBeforeAnswer:true,mediaFailure:waiting.visual.mediaFailure,noBFrames:true,noBSeek:true,explicitSubtitleContinuation:true,noNewPages:true,positiveOriginalFrame:true,restoredOriginalTime:true,syntheticTransportPosts:allCalls.length,externalModelCalls:0},null,2));
  }finally{await context.close();}
});

test('two native tracks select SRT plus VTT, JSON availability and a separate HTML format',async()=>{
  test.setTimeout(60000);const {context,page}=await setup();
  try{
    await page.getByRole('button',{name:'导出',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:/^字幕/}).click();
    await dialog.getByRole('checkbox',{name:/原始字幕 · 中文/}).check();await dialog.getByRole('checkbox',{name:/原始字幕 · English/}).check();await dialog.getByRole('checkbox',{name:'VTT',exact:true}).check();await dialog.getByRole('radio',{name:'分别下载',exact:true}).check();
    await dialog.locator('.export-body').evaluate(e=>{e.scrollTop=0;});await page.screenshot({path:resolve(output,'export-tracks-400.png')});
    await dialog.getByRole('button',{name:'开始导出'}).click();await expect(dialog.getByRole('status')).toContainText('.vtt：下载完成');
    await expect.poll(()=>page.evaluate(async()=> (await chrome.downloads.search({state:'complete'})).length)).toBe(6);
    const downloads=await page.evaluate(()=>chrome.downloads.search({state:'complete'}));const bodies=downloads.filter(d=>/\.(srt|vtt)$/.test(d.filename));expect(bodies).toHaveLength(4);for(const d of bodies){const text=await readFile(d.filename,'utf8');expect(text).toContain('native ');expect(text).toContain(d.filename.endsWith('.srt')?'00:00:01,234 --> 00:00:03,456':'00:00:01.234 --> 00:00:03.456');if(d.filename.endsWith('.vtt'))expect(text).toMatch(/^WEBVTT/);}
    await mkdir(resolve(output,'actual-two-track'),{recursive:true});for(const d of downloads)await writeFile(resolve(output,'actual-two-track',basename(d.filename)),await readFile(d.filename));
    await dialog.getByRole('checkbox',{name:'JSON',exact:true}).check();await dialog.getByRole('checkbox',{name:'B站原始JSON',exact:true}).check();await dialog.getByRole('checkbox',{name:/翻译 · en/}).check();await expect(dialog.getByRole('alert')).toContainText('不支持 B站原始 JSON');
    await dialog.getByLabel('字幕来源筛选').selectOption('native');await expect(dialog.getByRole('checkbox',{name:/翻译 · en/})).toHaveCount(0);await expect(dialog.getByRole('checkbox',{name:/原始字幕/})).toHaveCount(3);
    await dialog.getByRole('tab',{name:/^HTML/}).click();await dialog.getByRole('checkbox').first().check();await dialog.getByRole('tab',{name:/^字幕/}).click();await expect(dialog.getByRole('checkbox',{name:'SRT',exact:true})).toBeChecked();await expect(dialog.getByRole('checkbox',{name:'VTT',exact:true})).toBeChecked();
    await dialog.getByRole('radio',{name:'合并打包',exact:true}).check();await page.screenshot({path:resolve(output,'export-multiformat.png')});await page.setViewportSize({width:320,height:850});await page.screenshot({path:resolve(output,'export-multiformat-320.png')});expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    await dialog.getByRole('button',{name:'开始导出'}).click();await expect(dialog.getByRole('status')).toContainText('.zip：下载完成');const zipDownload=await page.evaluate(async()=> (await chrome.downloads.search({state:'complete'})).find(d=>d.filename.endsWith('.zip'))!);const zip=unzipSync(await readFile(zipDownload.filename));
    const json=Object.entries(zip).filter(([n])=>n.endsWith('.json'));expect(json.filter(([n])=>n.endsWith('.bilibili.json'))).toHaveLength(2);expect(json.filter(([n])=>!n.endsWith('.bilibili.json'))).toHaveLength(3);for(const[n,b]of json){const data=JSON.parse(strFromU8(b));if(n.endsWith('.bilibili.json'))expect(data.body).toHaveLength(1);else expect(data).toMatchObject({format:'vcamp-subtitles',version:1});}expect(Object.keys(zip).filter(n=>n.endsWith('.html'))).toHaveLength(1);
    await writeFile(resolve(output,'actual-mixed.zip'),await readFile(zipDownload.filename));await writeFile(resolve(output,'multiformat-result.json'),JSON.stringify({browserDownloads:downloads.map(d=>({filename:d.filename,state:d.state})),fourBodies:true,files:Object.keys(zip),jsonNormalized:3,originalResponses:2,unsupportedCombinationShown:true,externalModelCalls:0},null,2));
  }finally{await context.close();}
});
