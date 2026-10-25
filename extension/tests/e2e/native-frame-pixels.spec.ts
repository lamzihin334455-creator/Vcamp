import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

test('capture preserves decoded pixels at small and large page sizes without changing playback or fullscreen',async({},testInfo)=>{
  const {context,page,site,forbidden}=await setup();
  try{
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    const current=(await command({type:'workspace.query'})).view,target={workspaceId:current.workspaceId,chatId:current.chatId};
    const before=await site.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,paused:v.paused,width:v.videoWidth,height:v.videoHeight,fullscreen:!!document.fullscreenElement}));
    const captured=[];
    for(const width of [80,360]){
      await site.locator('video').evaluate((v:HTMLVideoElement,width)=>{v.style.width=`${width}px`;v.style.height='auto';},width);
      const count=(await command({type:'workspace.query'})).view.draft.attachmentIds.length;
      await page.getByRole('button',{name:'更多输入操作',exact:true}).click();
      await page.getByRole('button',{name:'截取当前画面',exact:true}).click();
      await expect.poll(async()=>(await command({type:'workspace.query'})).view.draft.attachmentIds.length).toBe(count+1);
      const draft=(await command({type:'workspace.query'})).view.draft;
      const reply=await command({type:'attachment.read',target,ids:[draft.attachmentIds.at(-1)]});expect(reply.ok).toBe(true);
      captured.push(reply.view.attachment.images[0]);
    }
    expect(captured.map(f=>[f.width,f.height])).toEqual([[before.width,before.height],[before.width,before.height]]);
    expect(captured[0].dataUrl).toBe(captured[1].dataUrl);
    const after=await site.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,paused:v.paused,width:v.videoWidth,height:v.videoHeight,fullscreen:!!document.fullscreenElement}));
    expect(after).toEqual(before);
    expect(forbidden.filter(url=>url.includes('api.deepseek.com'))).toEqual([]);
    await writeFile(testInfo.outputPath('native-pixel-proof.json'),JSON.stringify({before,after,cssWidths:[80,360],captured:captured.map(f=>({width:f.width,height:f.height,time:f.time})),samePixels:true,realApiCalls:0},null,2));
  }finally{await context.close();}
});
