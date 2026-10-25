import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

test('translation shows real batch progress outside settings and offers the completed version directly',async()=>{
  test.setTimeout(60_000);
  const {context,page,worker,fixture}=await setup();
  try {
    await worker.evaluate(()=>{
      const original=fetch;(globalThis as any).translationCalls=0;
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'local-text'}]});
        const termPayload=JSON.parse(JSON.parse(init.body).messages[1].content);
        if(termPayload.stage){const content=JSON.stringify({terms:[]});return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
        const source=JSON.parse(JSON.parse(init.body).messages[1].content);
        (globalThis as any).translationCalls++;
        await new Promise<void>((resolve,reject)=>{
          (globalThis as any).releaseTranslation=resolve;
          init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
        });
        const content=JSON.stringify({cues:source.cues.map((cue:any)=>({...cue,content:'Translated line '+cue.index}))});
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    });
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_TRANSLATION_STATUS'});
    const provider=await command({type:'provider.fetch',expectedRevision:1});
    const imported=await command({type:'provider.import-models',expectedRevision:provider.view.provider.revision,modelIds:['local-text']});
    expect(imported.ok).toBe(true);
    expect((await command({type:'provider.default',expectedRevision:imported.view.provider.revision,modelId:'local-text'})).ok).toBe(true);
    // A saved 165-line source produces two real executor batches without changing the video fixture.
    await page.evaluate(async({workspaceId,enhanced})=>{
      await new Promise<void>((resolve,reject)=>{
        const open=indexedDB.open('vcamp');open.onerror=()=>reject(open.error);
        open.onsuccess=()=>{
          const db=open.result,tx=db.transaction(['subtitleVersions','workspaces'],'readwrite');
          const upstream=tx.objectStore('subtitleVersions').get(enhanced);upstream.onsuccess=()=>tx.objectStore('subtitleVersions').put({...upstream.result,id:'translation-status-source',type:'translate',language:'zh',createdAt:Date.now(),cues:Array.from({length:165},(_,i)=>({from:i*2,to:i*2+1,content:'原文 '+i}))});
          const read=tx.objectStore('workspaces').get(workspaceId);read.onsuccess=()=>{const row=read.result;row.subtitleVersionIds=[...(row.subtitleVersionIds??[]),'translation-status-source'];row.analysisSource={kind:'version',versionId:'translation-status-source'};row.analysisSourceRevision=(row.analysisSourceRevision??0)+1;tx.objectStore('workspaces').put(row);};
          tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);
        };
      });
    },{workspaceId:fixture.workspaceId,enhanced:fixture.enhanced});
    await page.reload();await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await page.getByRole('button',{name:'字幕设置',exact:true}).click();
    await page.getByRole('checkbox',{name:'联网核对专有名词、人名和产品名称'}).uncheck();
    await page.getByRole('button',{name:'AI 翻译',exact:true}).click();
    await page.getByLabel('翻译目标语言').selectOption('en');
    await page.getByRole('button',{name:'开始翻译',exact:true}).click();
    const status=page.getByRole('region',{name:'AI 翻译进度'});
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).translationCalls)).toBe(1);
    await expect(status).toBeVisible({timeout:5000});
    await expect(page.getByRole('dialog',{name:'字幕设置'})).toHaveCount(0);
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).translationCalls)).toBe(1);
    await expect(status).toContainText('正在翻译');
    await expect(status.getByRole('progressbar')).toHaveAttribute('aria-valuenow','0');
    await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:15_000});
    await page.screenshot({path:'test-results/translation-started.png'});
    await worker.evaluate(()=>(globalThis as any).releaseTranslation());
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).translationCalls)).toBe(2);
    await expect(status).toContainText('1 / 2 批');
    await expect(status.getByRole('progressbar')).toHaveAttribute('aria-valuenow','1');
    await page.screenshot({path:'test-results/translation-progress.png'});
    await worker.evaluate(()=>(globalThis as any).releaseTranslation());
    await expect(status).toContainText('翻译完成');
    await expect(status).toContainText('165 条');
    const target={kind:'subtitle',workspaceId:fixture.workspaceId,operation:'translate'};
    const generated=(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles.versions.find((version:any)=>version.cues[0].content==='Translated line 0');
    expect(generated).toBeTruthy();
    // Only the current completion is announced; viewing it removes the notice.
    await expect(page.getByLabel('字幕时间轴')).toContainText('原文 0');
    await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:15_000});
    await page.screenshot({path:test.info().outputPath('translation-completed.png')});
    await status.getByRole('button',{name:'查看译文',exact:true}).click();
    await expect(page.getByLabel('字幕时间轴')).toContainText('Translated line 0');
    await expect(status).toHaveCount(0);
    await expect(page.getByLabel('字幕任务')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'切换字幕轨道'})).toContainText('AI 翻译 · en');
    const view=(await command({type:'generation.query',target})).view.generation;
    expect(view.jobs.find((job:any)=>job.jobId===generated.jobId)?.state).toBe('completed');
    expect(await worker.evaluate(()=>(globalThis as any).translationCalls)).toBe(2);
    await page.screenshot({path:'test-results/translation-viewing.png'});
    for(const [width,height] of [[280,650],[1000,850]]){
      await page.setViewportSize({width,height});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect(page.getByLabel('字幕时间轴')).toBeVisible();
      await page.screenshot({path:test.info().outputPath(`translation-viewing-${width}.png`)});
    }
    await page.reload();await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(page.getByLabel('字幕时间轴')).toContainText('Translated line 0');
    await expect(status).toHaveCount(0);
    await expect(page.getByLabel('字幕任务')).toHaveCount(0);
  } finally {await context.close();}
});

test('stopped and failed translation stay distinct from completion and can retry the same request',async()=>{
  test.setTimeout(60_000);
  const {context,page,worker,fixture}=await setup();
  try {
    await worker.evaluate(()=>{
      const original=fetch;(globalThis as any).translationMode='hold';(globalThis as any).translationCalls=0;
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'local-text'}]});
        const termPayload=JSON.parse(JSON.parse(init.body).messages[1].content);
        if(termPayload.stage){const content=JSON.stringify({terms:[]});return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
        (globalThis as any).translationCalls++;
        if((globalThis as any).translationMode==='hold')await new Promise<void>((resolve,reject)=>{(globalThis as any).releaseStoppedTranslation=resolve;init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
        if((globalThis as any).translationMode==='fail')return new Response('',{status:503});
        const source=JSON.parse(JSON.parse(init.body).messages[1].content),content=JSON.stringify({cues:source.cues.map((cue:any)=>({...cue,content:'Retried translation'}))});
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    });
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_TRANSLATION_RETRY'});
    const provider=await command({type:'provider.fetch',expectedRevision:1});
    const imported=await command({type:'provider.import-models',expectedRevision:provider.view.provider.revision,modelIds:['local-text']});
    expect(imported.ok).toBe(true);
    expect((await command({type:'provider.default',expectedRevision:imported.view.provider.revision,modelId:'local-text'})).ok).toBe(true);
    const before=(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles;
    await page.reload();await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:15_000});
    await page.getByRole('button',{name:'字幕设置',exact:true}).click();
    await page.getByRole('checkbox',{name:'联网核对专有名词、人名和产品名称'}).uncheck();
    await page.getByRole('button',{name:'AI 翻译',exact:true}).click();
    await page.getByRole('button',{name:'开始翻译',exact:true}).click();
    const status=page.getByRole('region',{name:'AI 翻译进度'});
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).translationCalls)).toBe(1);
    const jobId=await status.getAttribute('data-translation-job-id');
    await status.getByRole('button',{name:'停止翻译',exact:true}).click();
    await expect(status).toContainText('翻译已停止');
    await expect(status.getByRole('button',{name:'查看译文',exact:true})).toHaveCount(0);
    await page.screenshot({path:'test-results/translation-stopped.png'});
    await worker.evaluate(()=>(globalThis as any).translationMode='fail');
    await status.getByRole('button',{name:'重试翻译',exact:true}).click();
    await expect(status).toContainText('翻译未完成');
    await expect(status).toContainText('网络或服务失败');
    await expect(status.getByRole('button',{name:'查看译文',exact:true})).toHaveCount(0);
    expect((await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles.versions).toHaveLength(before.versions.length);
    await page.screenshot({path:'test-results/translation-failed.png'});
    await worker.evaluate(()=>(globalThis as any).translationMode='success');
    await status.getByRole('button',{name:'重试翻译',exact:true}).click();
    await expect(status).toContainText('翻译完成');
    await expect(status.getByRole('button',{name:'查看译文',exact:true})).toBeVisible();
    expect(await status.getAttribute('data-translation-job-id')).toBe(jobId);
    expect(await worker.evaluate(()=>(globalThis as any).translationCalls)).toBe(3);
    const after=(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles;
    expect(after.versions).toHaveLength(before.versions.length+1);
    expect(after.analysisSource).toEqual(before.analysisSource);
    await status.getByRole('button',{name:'查看译文',exact:true}).click();
    await expect(page.getByLabel('字幕时间轴')).toContainText('Retried translation');
    await expect(status).toHaveCount(0);
  } finally {await context.close();}
});

test('completion fades away after five seconds, never revives from history, and remains selectable in settings',async()=>{
  const {context,page,worker,fixture}=await setup();
  try{
    await worker.evaluate(()=>{
      const original=fetch;
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'local-text'}]});
        const termPayload=JSON.parse(JSON.parse(init.body).messages[1].content);
        if(termPayload.stage){const content=JSON.stringify({terms:[]});return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
        await new Promise<void>(resolve=>(globalThis as any).releaseTransientTranslation=resolve);
        const source=JSON.parse(JSON.parse(init.body).messages[1].content),content=JSON.stringify({cues:source.cues.map((cue:any)=>({...cue,content:'Transient translation'}))});
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    });
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_TRANSIENT_TRANSLATION'});
    const provider=await command({type:'provider.fetch',expectedRevision:1});
    const imported=await command({type:'provider.import-models',expectedRevision:provider.view.provider.revision,modelIds:['local-text']});
    expect(imported.ok).toBe(true);
    expect((await command({type:'provider.default',expectedRevision:imported.view.provider.revision,modelId:'local-text'})).ok).toBe(true);
    await page.reload();await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(page.getByRole('region',{name:'AI 翻译进度'})).toHaveCount(0);
    // The seed completes enhancement before translation. Enhancement activates its
    // saved track asynchronously when the user has not selected another source.
    await expect(page.getByLabel('字幕时间轴')).toContainText('增强内容');
    await expect.poll(async()=>(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles.analysisSource).toEqual({kind:'version',versionId:fixture.enhanced});
    const originalText=await page.getByLabel('字幕时间轴').textContent()??'';
    await page.getByRole('button',{name:'字幕设置',exact:true}).click();
    await page.getByRole('checkbox',{name:'联网核对专有名词、人名和产品名称'}).uncheck();
    await page.getByRole('button',{name:'AI 翻译',exact:true}).click();
    await page.getByRole('button',{name:'开始翻译',exact:true}).click();
    const status=page.getByRole('region',{name:'AI 翻译进度'});
    await expect(status).toContainText('正在翻译');
    // Reopening during work still shows genuine progress, rather than losing the task.
    await page.reload();await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(status).toContainText('正在翻译');
    await page.clock.install();
    await worker.evaluate(()=>(globalThis as any).releaseTransientTranslation());
    await expect(status).toContainText('翻译完成');
    await expect(status.getByRole('button',{name:'查看译文',exact:true})).toBeVisible();
    await page.screenshot({path:test.info().outputPath('completion-before-timeout.png')});
    await page.clock.runFor(4900);
    await expect(status).toBeVisible();
    await page.clock.runFor(120);
    await expect(page.locator('.subtitle-translation-notice')).toHaveAttribute('data-dismissing','true');
    await page.clock.runFor(300);
    await expect(status).toHaveCount(0);
    await expect(page.getByLabel('字幕时间轴')).toHaveText(originalText);
    await expect(page.getByLabel('字幕任务')).toHaveCount(0);
    await page.screenshot({path:test.info().outputPath('idle-after-timeout.png')});
    await page.getByRole('navigation').getByRole('button',{name:'问答',exact:true}).click();
    await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(page.getByLabel('字幕时间轴')).toBeVisible();
    await expect(status).toHaveCount(0);
    const subtitles=(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles;
    const translated=subtitles.versions.find((v:any)=>v.cues[0]?.content==='Transient translation');
    expect(translated).toBeTruthy();
    await page.getByRole('button',{name:'字幕设置',exact:true}).click();
    await page.getByRole('checkbox',{name:'联网核对专有名词、人名和产品名称'}).uncheck();
    await page.getByLabel('主字幕',{exact:true}).selectOption('saved:'+translated.id);
    await expect.poll(async()=>(await command({type:'subtitles.query',workspaceId:fixture.workspaceId})).view.subtitles.analysisSource).toEqual({kind:'version',versionId:translated.id});
    await page.getByRole('button',{name:'关闭字幕设置',exact:true}).click();
    await expect(page.getByLabel('字幕时间轴')).toContainText('Transient translation');
    await expect(status).toHaveCount(0);
    await page.reload();await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(page.getByLabel('字幕时间轴')).toContainText('Transient translation');
    await expect(status).toHaveCount(0);
  }finally{await context.close();}
});
