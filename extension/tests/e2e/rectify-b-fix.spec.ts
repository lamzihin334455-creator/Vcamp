import {test,expect,chromium} from '@playwright/test';
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:http';

test('autonomous required frames stay on source page, reach image input, and respect user playback; HTML opens and resets',async()=>{
  test.setTimeout(100000);
  const output=resolve('../.tmp/rectify-b-fix');await mkdir(output,{recursive:true});await writeFile(resolve(output,'results.json'),JSON.stringify({status:'running'}));
  const bundle=await mkdtemp(resolve(output,'bundle-'));await cp(resolve('dist-capture'),bundle,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(bundle,'manifest.json'),'utf8'));manifest.host_permissions.push(...(manifest.optional_host_permissions??[]));delete manifest.optional_host_permissions;await writeFile(resolve(bundle,'manifest.json'),JSON.stringify(manifest));
  const media=(await readFile(resolve('tests/fixtures/t16-original.mp4'))).toString('base64');
  const requests:any[]=[];let videoNavigations=0;let htmlMode:'complete'|'incomplete'|'length'='complete';
  const html='<!doctype html><html lang="zh"><head><title>离线交互学习页</title><style>body{font:17px/1.7 sans-serif;margin:16px}button{font:inherit}</style></head><body><h1>记忆与偏见</h1><p>本地响应夹具，不是真实模型成果。</p><button onclick="this.textContent=\'解释已展开\'">展开解释</button></body></html>';
  const server=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const request=JSON.parse(body);requests.push(request);
    const system=request.messages[0].content,planning=system.includes('[P1:vision-plan]'),review=system.includes('[P1:vision-review]'),requirements=system.includes('[P1:requirements-plan]'),isHtml=system.includes('[P1:html-format]');
    const text=requirements?JSON.stringify({version:1,interpretedIntent:'按本次要求处理视频',additionalSources:[],outputRequirements:[]}):planning?JSON.stringify({version:2,scope:'focused',needsNewFrames:true,evidence:[{id:'comparison',need:'比较1秒和3秒的颜色与形状',priority:'required',mode:'pair',reuseAttachmentIds:[],detailNeed:'overview',readTargets:[],checkTargets:['颜色与形状差异'],reason:'用户指定两个时间点',windows:[1,3].map(anchor=>({from:anchor-.1,to:anchor+.1,anchor,cueIds:[],basis:'user-time'}))}],unresolved:[]}):review?JSON.stringify({version:3,results:JSON.parse(request.messages[1].content[0].text).targets.map((t:any)=>({evidenceId:t.evidenceId,checks:t.checks.map((c:any)=>({checkId:c.checkId,status:'confirmed',imageRefs:t.imageRefs,observation:'本地模拟对比结果'})),refinements:[]}))}):isHtml?(htmlMode==='complete'?html:html.slice(0,-14)):'离线回答：已读取本请求的两张实际图片。';
    res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:isHtml&&htmlMode==='length'?'length':'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(r=>server.listen(43105,'127.0.0.1',r));
  const context=await chromium.launchPersistentContext(await mkdtemp(resolve(output,'profile-')),{channel:'chromium',headless:true,viewport:{width:400,height:850},args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
  context.setDefaultTimeout(7000);
  try{
    await context.route('https://www.bilibili.com/video/**',route=>{videoNavigations++;return route.fulfill({contentType:'text/html; charset=utf-8',body:`<video muted controls playsinline></video><script>window.__INITIAL_STATE__={videoData:{bvid:'BVfixture',title:'同页帧夹具',pages:[{page:1,cid:20,part:'P1'}]}};window.player={getVideoMessage:()=>({bvid:'BVfixture',cid:20})};document.querySelector('video').src='data:video/mp4;base64,${media}';fetch('https://api.bilibili.com/x/player/wbi/v2?cid=20');</script>`});});
    await context.route('https://api.bilibili.com/**',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/fixture.json'}]}}})}));
    await context.route('https://aisubtitle.hdslb.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({body:[{from:0,to:6,content:'需要观察视频两处颜色和形状，不能仅凭字幕回答。'}]})}));
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const site=await context.newPage();await site.goto('https://www.bilibili.com/video/BVfixture/?p=1');
    await expect.poll(()=>site.evaluate(()=>document.querySelector('video')!.readyState)).toBeGreaterThanOrEqual(2);
    const probe=await context.newPage();await probe.goto(`chrome-extension://${id}/tests/installed/t16-media-probe.html`);
    const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://www.bilibili.com/video/*'}))[0].id!);
    await site.bringToFront();await site.evaluate(()=>{document.querySelector('video')!.currentTime=4;});
    await expect.poll(()=>site.evaluate(()=>document.querySelector('video')!.seeking)).toBe(false);
    let created=0;const opened=()=>created++;context.on('page',opened);
    await probe.evaluate(tabId=>{(window as any).acquireOutcome=null;void (window as any).acquireOriginal(tabId).then((v:any)=>(window as any).acquireOutcome={ok:true,value:v},(e:any)=>(window as any).acquireOutcome={ok:false,error:String(e)});},tabId);
    await expect.poll(async()=>created,{timeout:2000}).toBe(0);
    await expect.poll(()=>probe.evaluate(()=>(window as any).acquireOutcome!==null),{timeout:15000}).toBe(true);const outcome=await probe.evaluate(()=>(window as any).acquireOutcome);if(!outcome.ok)throw new Error(JSON.stringify(outcome));
    const frame=await probe.evaluate(()=>(window as any).captureOriginal(1));expect(frame.dataUrl).toMatch(/^data:image\/png;base64,/);expect(frame.time).toBeCloseTo(1,1);expect(frame.width).toBeGreaterThan(0);
    await probe.evaluate(()=>(window as any).releaseOriginal());
    expect(await site.evaluate(()=>({time:document.querySelector('video')!.currentTime,paused:document.querySelector('video')!.paused}))).toEqual({time:4,paused:true});expect(created).toBe(0);
    // Playing state is resumed only when control ownership is unchanged.
    await site.evaluate(async()=>{const v=document.querySelector('video')!;v.currentTime=4;await v.play();});await site.waitForFunction(()=>document.querySelector('video')!.currentTime>4.1);
    await probe.evaluate(tabId=>(window as any).acquireOriginal(tabId),tabId);await probe.evaluate(()=>(window as any).captureOriginal(1));await probe.evaluate(()=>(window as any).releaseOriginal());
    expect(await site.evaluate(()=>document.querySelector('video')!.paused)).toBe(false);expect(await site.evaluate(()=>document.querySelector('video')!.currentTime)).toBeGreaterThan(4);
    await site.evaluate(()=>document.querySelector('video')!.pause());
    // A real user control gesture cancels ownership; release must preserve the new choice.
    await site.bringToFront();await probe.evaluate(tabId=>(window as any).acquireOriginal(tabId),tabId);await site.locator('video').click({position:{x:20,y:20}});
    await site.evaluate(()=>{document.querySelector('video')!.pause();document.querySelector('video')!.currentTime=2;});
    await expect(probe.evaluate(()=>(window as any).captureOriginal(3))).rejects.toThrow();await probe.evaluate(()=>(window as any).releaseOriginal());
    expect(await site.evaluate(()=>document.querySelector('video')!.currentTime)).toBeCloseTo(2,1);expect(created).toBe(0);context.off('page',opened);
    // SPA identity changes revoke the original document's control grant.
    await site.evaluate(()=>document.querySelector('video')!.pause());
    const beforeSpa=await site.evaluate(()=>({time:document.querySelector('video')!.currentTime,paused:document.querySelector('video')!.paused}));
    await site.bringToFront();await probe.evaluate(tabId=>(window as any).acquireOriginal(tabId),tabId);
    await site.evaluate(()=>history.pushState({},'', '?p=2'));
    await expect(probe.evaluate(()=>(window as any).captureOriginal(3))).rejects.toThrow();await probe.evaluate(()=>(window as any).releaseOriginal());
    expect(await site.evaluate(()=>({time:document.querySelector('video')!.currentTime,paused:document.querySelector('video')!.paused}))).toEqual(beforeSpa);expect(created).toBe(0);
    await site.evaluate(()=>history.replaceState({},'', '?p=1'));
    // Remaining full-task checks follow the same installed capture/executor path.
    await probe.close();await panel.reload();await expect(panel.getByRole('button',{name:'切换当前内容'})).toContainText('完整字幕已就绪');
    const op=async(operation:any)=>panel.evaluate(async operation=>{const reply=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation});if(!reply.ok)throw new Error(reply.code);return reply.view;},operation);
    const view=await op({type:'workspace.query'});const target={kind:'chat',workspaceId:view.workspaceId,chatId:view.chatId};
    await context.route('https://api.deepseek.com/models',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({object:'list',data:[{id:'local-vision',name:'Local vision',input_modalities:['text','image']}]})}));
    const pv=(await op({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'LOCAL_FIXTURE_TOKEN'})).provider;const fetched=(await op({type:'provider.fetch',expectedRevision:pv.revision})).provider;await op({type:'provider.import-models',modelIds:['local-vision'],expectedRevision:fetched.revision});await panel.reload();
    // One manual screenshot regression: actual saved draft attachment only.
    await panel.getByRole('button',{name:'更多输入操作',exact:true}).click();await panel.getByRole('button',{name:'截取当前画面',exact:true}).click();await expect(panel.getByLabel('草稿图片').locator('img')).toHaveCount(1);
    await panel.getByLabel('草稿图片').getByRole('button',{name:/移除图片/}).click();
    await panel.getByRole('button',{name:'更多输入操作',exact:true}).click();await panel.getByRole('button',{name:/^开启自主识别画面/}).click();await panel.getByLabel('输入草稿').fill('比较1秒和3秒的实际颜色与形状');
    const videoPages=()=>context.pages().filter(p=>p.url().startsWith('https://www.bilibili.com/video/')).length;
    const count=videoPages();await panel.getByRole('button',{name:'发送',exact:true}).click();
    await expect.poll(async()=> {const j=(await op({type:'generation.query',target})).generation.jobs[0];return j&&['completed','awaiting-permission','failed'].includes(j.state);},{timeout:30000}).toBe(true);
    const observed=(await op({type:'generation.query',target})).generation.jobs[0];await writeFile(resolve(output,'task-observed.json'),JSON.stringify(observed,null,2));expect(observed.state,JSON.stringify(observed.visual)).toBe('completed');
    const done=(await op({type:'generation.query',target})).generation.jobs[0];expect(done.visual.attachmentIds).toHaveLength(2);expect(videoPages()).toBe(count);expect(videoNavigations).toBe(1);
    const answer=requests.find(r=>Array.isArray(r.messages.at(-1).content));expect(answer.messages.at(-1).content.filter((p:any)=>p.type==='image_url')).toHaveLength(2);
    // Reproduce a zero-frame task via an actual intervening player seek.
    await site.evaluate(()=>document.querySelector('video')!.addEventListener('seeked',()=>{document.querySelector('video')!.currentTime=5;},{once:true}));
    await panel.getByLabel('输入草稿').fill('再次比较两处实际画面');await panel.getByRole('button',{name:'发送',exact:true}).click();
    await expect.poll(async()=> (await op({type:'generation.query',target})).generation.jobs.find((j:any)=>j.jobId!==done.jobId)?.state,{timeout:20000}).toBe('awaiting-permission');
    const failed=(await op({type:'generation.query',target})).generation.jobs.find((j:any)=>j.jobId!==done.jobId);expect(failed.visual.attachmentIds).toHaveLength(0);expect(failed.visual).toMatchObject({issue:'media',mediaFailure:'user-control'});
    expect(requests).toHaveLength(6);await op({type:'generation.stop',jobId:failed.jobId});expect(await site.evaluate(()=>document.querySelector('video')!.currentTime)).toBeCloseTo(5,1);expect(videoNavigations).toBe(1);
    await panel.getByRole('button',{name:'关闭自主识别画面',exact:true}).click();await panel.getByLabel('输入草稿').fill('生成精炼的可交互学习页');await panel.getByRole('button',{name:'产物类型：Chat',exact:true}).click();await panel.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();htmlMode='incomplete';await panel.getByRole('button',{name:'发送',exact:true}).click();
    await expect.poll(async()=> (await op({type:'generation.query',target})).generation.jobs.find((j:any)=>j.error==='html-format')).toBeTruthy();
    let rejected=(await op({type:'generation.query',target})).generation.jobs.find((j:any)=>j.error==='html-format');expect(rejected.diagnostics.at(-1)).toMatchObject({purpose:'html-page',cause:'stop',modelId:'local-vision',htmlEnvelope:'missing-end'});await expect(panel.getByRole('button',{name:'打开页面',exact:true})).toHaveCount(0);
    htmlMode='length';await panel.getByLabel('输入草稿').fill('生成同类学习页');await panel.getByRole('button',{name:'产物类型：Chat',exact:true}).click();await panel.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();await panel.getByRole('button',{name:'发送',exact:true}).click();
    await expect.poll(async()=> (await op({type:'generation.query',target})).generation.jobs.find((j:any)=>j.error==='output-limit')).toBeTruthy();
    rejected=(await op({type:'generation.query',target})).generation.jobs.find((j:any)=>j.error==='output-limit');expect(rejected.diagnostics.at(-1)).toMatchObject({purpose:'html-page',cause:'service-length',htmlEnvelope:'missing-end'});await expect(panel.getByRole('button',{name:'打开页面',exact:true})).toHaveCount(0);
    htmlMode='complete';await panel.getByLabel('输入草稿').fill('生成精炼的可交互学习页');await panel.getByRole('button',{name:'产物类型：Chat',exact:true}).click();await panel.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();await panel.getByRole('button',{name:'发送',exact:true}).click();
    await expect(panel.getByRole('button',{name:'打开页面',exact:true})).toBeVisible();await panel.getByRole('button',{name:'打开页面',exact:true}).click();
    const content=()=>panel.frameLocator('.html-page-frame').frameLocator('iframe');await content().getByRole('button',{name:'展开解释'}).click();await expect(content().getByRole('button',{name:'解释已展开'})).toBeVisible();await panel.getByRole('button',{name:'初始化',exact:true}).click();await expect(content().getByRole('button',{name:'展开解释'})).toBeVisible();
    await panel.screenshot({path:resolve(output,'html-local.png')});
    await panel.getByRole('button',{name:'退出页面',exact:true}).click();await panel.getByRole('button',{name:'问答',exact:true}).click();
    await panel.locator('.output-control > button').click();await panel.getByRole('menuitemradio',{name:'Markdown 笔记',exact:true}).click();await panel.getByLabel('输入草稿').fill('整理一段学习笔记');await panel.getByRole('button',{name:'发送',exact:true}).click();await expect(panel.getByRole('button',{name:'打开笔记',exact:true})).toBeVisible();await writeFile(resolve(output,'results.json'),JSON.stringify({status:'passed',browser:context.browser()?.version(),fixture:true,externalModelCalls:0,requiredFrames:2,imagesInAnswer:2,newVideoPages:0,manualScreenshot:true,htmlInteractionReset:true,invalidHtmlNeverSaved:true,serviceLengthDistinct:true,spaRevoke:true,userSeekZeroFrameExplicit:true,playingResume:true,markdown:true,simulatedGenerationPosts:requests.length},null,2));
  }finally{await context.close();await new Promise<void>(r=>server.close(()=>r()));}
});
