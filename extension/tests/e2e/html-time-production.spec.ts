import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {setup} from './interaction-fixture';

test('production official DeepSeek HTML repairs existing time syntax at read time, keeps source exact and seeks the current video without changing playback',async()=>{
  test.setTimeout(60000);
  const {context,page,worker,site,forbidden}=await setup();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  const source=`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>说法时间线</title>
    <style>body{margin:20px;background:#f4f2ec;color:#171717;font:15px/1.65 system-ui}h1{font-size:27px;line-height:1.2}h2{font-size:20px}small{color:#9b5b54}blockquote{border-left:3px solid;padding-left:12px;margin:20px 0}li{padding:12px 0;border-bottom:1px solid #ddd}a{color:inherit;text-underline-offset:3px}button{padding:8px 12px}table{border-collapse:collapse}td{padding:12px 4px;border-bottom:1px solid #ddd}</style>
    </head><body><small>视频原意 · 说法时间线</small><h1>同一个话题里的三种不同性质的话</h1>
    <blockquote>“试着写成一份大规格文档。” [27:56](vcamp-time:1676.23) 附近</blockquote>
    <ol><li>爱一场演讲潮响 [26:42](vcamp-time:1602.15)。</li><li>放弃规格文档，把精力放回代码 [28:27](vcamp-time:1707.51)。</li></ol>
    <h2>为什么认为规格路线走不通</h2><table><tr><td>现实的冲突</td><td>在框架里写代码 [28:46](vcamp-time:1726.43)。</td></tr></table>
    <p id="dynamic">稍后补充</p><button id="show">切换说法</button><p id="seek">本地定位验证 [00:02](vcamp-time:2.345)。</p>
    <script>document.querySelector('#show').onclick=()=>{document.querySelector('#dynamic').firstChild.data='后来转向交互演示 [33:38](vcamp-time:2018.25)。';};</script></body></html>`;
  try{
    await page.setViewportSize({width:420,height:900});
    await worker.evaluate(source=>{
      const original=fetch,state=globalThis as any;state.htmlTimeCalls=[];
      state.fetch=async(url:string,init:RequestInit={})=>{
        if(!String(url).startsWith('https://api.deepseek.com/'))return original(url,init);
        if(String(url).endsWith('/models'))return Response.json({data:[{id:'deepseek-flash',input_modalities:['text']}]});
        const body=JSON.parse(String(init.body));state.htmlTimeCalls.push(body);
        const text=body.max_tokens===768?JSON.stringify({version:1,interpretedIntent:'生成时间线学习页',additionalSources:[],outputRequirements:[]}):source;
        return new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
      };
    },source);
    let provider=(await command({type:'provider.query'})).view.provider;
    provider=(await command({type:'provider.save-key',providerId:'deepseek',key:'SYNTHETIC_HTML_TIME_KEY',expectedRevision:provider.revision})).view.provider;
    provider=(await command({type:'provider.fetch',expectedRevision:provider.revision})).view.provider;
    await command({type:'provider.import-models',modelIds:['deepseek-flash'],expectedRevision:provider.revision});
    await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);
    await page.getByRole('button',{name:'切换当前内容',exact:true}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await expect(page.locator('.context-module')).toHaveText('对话 02');
    await page.getByLabel('输入草稿',{exact:true}).fill('@风格化交互页面');await page.locator('#mention-menu').getByRole('button',{name:'风格化交互页面',exact:true}).click();
    await page.getByLabel('输入草稿',{exact:true}).fill('按原片的不同说法做交互时间线');await site.bringToFront();
    const space=(await command({type:'workspace.query'})).view,target={kind:'chat',workspaceId:space.workspaceId,chatId:space.chatId};
    const query=async()=>(await command({type:'generation.query',target})).view.generation.jobs.at(-1);
    const saved=async()=>(await command({type:'knowledge.query',workspaceId:space.workspaceId})).view.knowledge.artifacts.find((a:any)=>a.sourceChatId===space.chatId);
    await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(async()=>(await query())?.state).toBe('completed');expect((await saved()).source).toBe(source);
    await page.getByRole('button',{name:'打开页面',exact:true}).click();
    const frame=page.frameLocator('.html-page-frame').frameLocator('iframe');
    await expect(frame.locator('blockquote')).toHaveText('“试着写成一份大规格文档。” 27:56 附近');
    await expect(frame.locator('blockquote a')).toHaveAttribute('href','vcamp-time:1676.23');
    await expect(frame.locator('body')).not.toContainText('vcamp-time:');
    await frame.locator('#show').click();await expect(frame.locator('#dynamic')).toHaveText('后来转向交互演示 33:38。');
    const video=site.locator('video');const before=await video.evaluate((v:HTMLVideoElement)=>({paused:v.paused}));
    await frame.locator('#seek a').click();await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(2.345,2);
    expect(await video.evaluate((v:HTMLVideoElement)=>v.paused)).toBe(before.paused);
    await page.bringToFront();await page.screenshot({path:test.info().outputPath('html-timeline-420.png')});
    for(const width of [280,360]){await page.setViewportSize({width,height:850});expect(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath(`html-timeline-${width}.png`)});}
    await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);expect((await saved()).source).toBe(source);
    await page.getByRole('button',{name:'打开页面',exact:true}).click();
    await expect(frame.locator('blockquote')).toHaveText('“试着写成一份大规格文档。” 27:56 附近');
    const calls=await worker.evaluate(()=>(globalThis as any).htmlTimeCalls);expect(calls.filter((c:any)=>c.max_tokens!==768)).toHaveLength(1);
    expect(calls.at(-1).messages[0].content).toContain('<a href="vcamp-time:67.8">01:07</a>');
    expect(errors).toEqual([]);expect(forbidden).toEqual([]);
    await writeFile(test.info().outputPath('audit.json'),JSON.stringify({sourceExact:true,readTimeRepair:true,fractionalSeek:2.345,playbackPreserved:true,dynamicContent:true,reload:true,finalRequests:1,realPaidCalls:0,errors,forbidden},null,2));
  }finally{await context.close();}
});
