import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

test('web HTTP failure persists safe diagnostics with copy, download and clipboard denial recovery',async()=>{
  test.setTimeout(70_000);
  const {context,page,worker,site}=await setup();
  try{
    await worker.evaluate(()=>{
      const original=fetch;
      globalThis.fetch=(async(input:any,init:any)=>{
        if(!String(input).startsWith('https://api.deepseek.com/'))return original(input,init);
        if(!init?.method||init.method==='GET')return Response.json({object:'list',data:[{id:'deepseek-flash',input_modalities:['text','image']}]});
        const body=JSON.parse(init.body);
        if(String(input).endsWith('/v1/tools/search'))return Response.json({error:{type:'invalid_request_error',message:'PRIVATE_REMOTE_RESPONSE SYNTHETIC_FEEDBACK_KEY'}},{status:400});
        const text=String(body.messages?.[0]?.content).includes('[P1:web-query]')?JSON.stringify({query:'视频概念'}):JSON.stringify({version:1,interpretedIntent:'核实视频',additionalSources:[],outputRequirements:[]});
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }) as typeof fetch;
    });
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'SYNTHETIC_FEEDBACK_KEY'});
    let provider=await command({type:'provider.fetch',expectedRevision:1});provider=await command({type:'provider.import-models',expectedRevision:provider.view.provider.revision,modelIds:provider.view.provider.catalog.map((model:any)=>model.id)});
    await command({type:'provider.default',expectedRevision:provider.view.provider.revision,modelId:'deepseek-flash'});
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await page.getByRole('button',{name:'联网',exact:true}).click();
    await page.getByLabel('输入草稿').fill('PRIVATE_USER_QUESTION');await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('搜索服务拒绝请求（HTTP 400）');
    const task=page.locator('.message-task').filter({has:page.getByRole('alert')});
    const jobId=await task.getAttribute('data-job-id');
    await page.reload();await expect(page.getByRole('alert')).toContainText('HTTP 400');
    const savedTask=page.locator(`[data-job-id="${jobId}"]`);
    await savedTask.getByText('失败详情 / 重试',{exact:true}).click();
    // Exercise both allowed and denied clipboard outcomes inside the installed UI.
    await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(text:string){(window as any).copiedFeedback=text;}}});});
    await savedTask.getByRole('button',{name:'复制完整诊断',exact:true}).click();
    await expect(savedTask.getByRole('status')).toHaveText('完整诊断已复制');
    const copied=await page.evaluate(()=>(window as any).copiedFeedback);
    expect(JSON.parse(copied)).toMatchObject({format:'vcamp-failure-feedback-v1',appVersionAtExport:JSON.parse(await readFile('package.json','utf8')).version,error:'web-tool',diagnosticStatus:'recorded',diagnostics:expect.arrayContaining([expect.objectContaining({httpStatus:400,webServiceError:'invalid_request_error',webFailure:'request-rejected',webAdapterVersion:3})])});
    expect(copied).not.toMatch(/PRIVATE_|SYNTHETIC_FEEDBACK_KEY/);
    const pending=page.waitForEvent('download');await savedTask.getByRole('button',{name:'下载诊断文件',exact:true}).click();
    const download=await pending;expect(download.suggestedFilename()).toMatch(/^vcamp-error-.*\.json$/);
    const downloaded=async()=>page.evaluate(async name=>(await chrome.downloads.search({filenameRegex:name})).find(file=>file.state==='complete'),download.suggestedFilename().replaceAll('.','\\.'));
    await expect.poll(async()=>!!await downloaded()).toBe(true);
    expect(await readFile((await downloaded())!.filename,'utf8')).toBe(copied);
    await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(){throw Error('clipboard denied');}}});});
    await savedTask.getByRole('button',{name:'复制完整诊断',exact:true}).click();
    const fallback=savedTask.getByLabel('手动复制诊断文本');await expect(fallback).toHaveValue(copied);
    expect(await fallback.evaluate((field:HTMLTextAreaElement)=>field.selectionEnd-field.selectionStart)).toBe(copied.length);
    await page.screenshot({path:'test-results/web-failure-feedback.png'});
  }finally{await context.close();}
});
