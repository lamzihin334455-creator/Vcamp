import {expect,test,chromium} from '@playwright/test';
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {navigationScript} from '../../src/html/navigation';
import {setup} from './interaction-fixture';

const answer=`**文字理解适用度：88/100**

AI 对初级岗位的冲击[50.7–56.93]、任务思维[106.76–158.78]、效率与就业[200–303.9]、可复制与不可复制[380.9–515.28]、三段结构[545.669–585.91]、结构性矛盾[650.26–691.86]、四个方向[879.53–1026.92]、财富分配[1327.04–1758.31]。

**不看画面可能错失的内容：**

1. 英文原声[108.789–114.61]、[589.04–591.74]、[1330.84–1344.78]。
2. 图表[207.36–216.1]，占比37%到50%，25岁以下。
3. 广告（[1186–1312](vcamp-time:1186)），结尾配乐约[1884–1926](vcamp-time:1884.97)。
4. 错误模型引用[105:22](vcamp-time:6312.76)。

年份[2024–2025]，概率[0–1]，代码\`[106.76–158.78]\`。`;

test('chat and note renderer displays screenshot second ranges, preserves fractional seek and rejects the actual bad reference',async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{TimedMarkdown}from'./src/workbench/TimedMarkdown';window.seeks=[];createRoot(document.getElementById('root')).render(<TimedMarkdown content={${JSON.stringify(answer)}} duration={1927} seek={time=>window.seeks.push(time)}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(`<style>${await readFile('src/app/styles.css','utf8')}</style><article class="chat-turn assistant"><div id="root" class="answer-content"></div></article>`);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.getByRole('button',{name:'01:46',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'19:46–21:52',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'31:24–32:06',exact:true})).toBeVisible();
    await expect(page.locator('.invalid-answer-time')).toHaveAttribute('title',/32:07/);
    for(const [label,time] of [['01:46',106.76],['01:48',108.789],['31:24–32:06',1884.97]] as const){
      await page.getByRole('button',{name:label,exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>(window as any).seeks.at(-1))).toBe(time);
    }
    await expect(page.locator('code')).toHaveText('[106.76–158.78]');
    for(const variant of ['answer-content','markdown-body']){
      await page.locator('#root').evaluate((el,className)=>el.setAttribute('class',className),variant);
      for(const width of [280,420,960]){
        await page.setViewportSize({width,height:900});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:test.info().outputPath(`${variant}-${width}.png`),fullPage:true});
      }
    }
  }finally{await browser.close();}
});

test('HTML preview and offline export use the same second-range labels and exact targets',async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:420,height:850}});
    const source='<h1>片段时间线</h1><p id="raw">原声[108.789–114.61]</p><p id="explicit"><a href="vcamp-time:1884.97">1884–1926</a></p><p>年份[2024–2025]</p><pre>[106.76–158.78]</pre>';
    await page.setContent('<iframe sandbox="allow-scripts" style="height:750px;width:100%;border:0"></iframe>');
    await page.evaluate(({source,script})=>{
      (window as any).actions=[];window.addEventListener('message',e=>(window as any).actions.push(e.data));
      document.querySelector('iframe')!.srcdoc=`<!doctype html><html><head><script>${script}</script></head><body>${source}</body></html>`;
    },{source,script:navigationScript('seconds-ranges')});
    const frame=page.frameLocator('iframe');
    await expect(frame.locator('#raw')).toHaveText('原声01:48–01:54');
    await expect(frame.locator('#raw a').first()).toHaveAttribute('href','vcamp-time:108.789');
    await expect(frame.locator('#explicit a')).toHaveText('31:24–32:06');
    await frame.locator('#raw a').first().click();
    await expect.poll(()=>page.evaluate(()=>(window as any).actions.at(-1))).toMatchObject({kind:'seek',time:108.789});
    await expect(frame.locator('pre')).toHaveText('[106.76–158.78]');
    const exporting=await build({entryPoints:['src/library/document-download.ts'],bundle:true,write:false,format:'iife',globalName:'ExportTest'});
    await page.addScriptTag({content:exporting.outputFiles[0].text});
    const exported=await page.evaluate(source=>(window as any).ExportTest.portableHtml({type:'html',name:'timeline.html',content:source,source:{videoId:'BVfixture',pageNumber:1}}),source);
    await page.setContent(exported);
    const offline=page.frameLocator('iframe');
    await expect(offline.locator('#raw')).toHaveText('原声01:48–01:54');
    await expect(offline.locator('#explicit a')).toHaveText('31:24–32:06');
    await expect(offline.locator('#explicit a')).toHaveAttribute('href',/t=1884/);
    await page.screenshot({path:test.info().outputPath('offline-time-ranges.png')});
  }finally{await browser.close();}
});

test('production answer receives copyable time context, renders numeric ranges and seeks the native player without rounding',async()=>{
  // Black-frame fixture with the user's real 32:07 duration. No overridden
  // video duration or simulated native seek: later points must be reachable.
  const {context,page,worker,site}=await setup({mediaPath:'tests/fixtures/timeline-1927-synthetic.mp4',title:'时间引用回归样本',relayOrigin:'http://127.0.0.1',cues:[{from:50.7,to:56.93,content:'第一处原文'},{from:106.76,to:158.78,content:'第二处原文'},{from:1186,to:1312,content:'广告原文'},{from:1884.97,to:1926,content:'配乐原文'}]});
  const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
  try{
    await worker.evaluate(()=>{
      const original=fetch,state=globalThis as any;state.timelineCalls=[];
      state.fetch=async(url:string,init:RequestInit={})=>{
        if(!String(url).startsWith('https://api.deepseek.com/'))return original(url,init);
        if(String(url).endsWith('/models'))return Response.json({data:[{id:'deepseek-flash',input_modalities:['text']}]});
        const body=JSON.parse(String(init.body));state.timelineCalls.push(body);
        const content=body.max_tokens===768?JSON.stringify({version:1,interpretedIntent:'按字幕引用片段',additionalSources:[],outputRequirements:[]}):'第一处原文[50.7–56.93]。第二处[106.76–158.78](vcamp-time:106.76)。广告[1186–1312](vcamp-time:1186)。配乐[1884–1926](vcamp-time:1884.97)。错误引用[105:22](vcamp-time:6312.76)。';
        return new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
      };
    });
    let provider=(await command({type:'provider.query'})).view.provider;
    provider=(await command({type:'provider.save-key',providerId:'deepseek',key:'SYNTHETIC_TIMELINE_KEY',expectedRevision:provider.revision})).view.provider;
    provider=(await command({type:'provider.fetch',expectedRevision:provider.revision})).view.provider;
    await command({type:'provider.import-models',modelIds:['deepseek-flash'],expectedRevision:provider.revision});
    let workspace=(await command({type:'workspace.query'})).view;
    const subtitles=(await command({type:'subtitles.query',workspaceId:workspace.workspaceId})).view.subtitles;
    expect((await command({type:'subtitles.source.select',workspaceId:workspace.workspaceId,source:{kind:'native',language:'zh-CN'},expectedRevision:subtitles.sourceRevision})).ok).toBe(true);
    await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);await site.bringToFront();
    await page.evaluate(()=>{
      const original=chrome.runtime.sendMessage.bind(chrome.runtime);(window as any).locateLog=[];
      chrome.runtime.sendMessage=(async(message:any)=>{
        const response=await original(message);
        if(message.operation?.type==='library.locate')(window as any).locateLog.push({operation:message.operation,ok:response.ok});
        return response;
      }) as any;
    });
    const old=(await command({type:'workspace.query'})).view.chatId;
    await page.getByRole('button',{name:'切换当前内容',exact:true}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await expect.poll(async()=>(await command({type:'workspace.query'})).view.chatId).not.toBe(old);
    await page.getByLabel('输入草稿',{exact:true}).fill('引用这两处原文');await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.getByRole('button',{name:'01:46–02:38',exact:true})).toBeVisible();
    await expect(page.locator('.invalid-answer-time')).toHaveCount(1);
    const calls=await worker.evaluate(()=>(globalThis as any).timelineCalls);
    expect(calls).toHaveLength(2);
    const data=JSON.parse(calls[1].messages[1].content.split('\n').slice(1).join('\n'));
    expect(data.subtitle.content).toContain('[01:46–02:38](vcamp-time:106.76)');
    expect(data.videoTimeline).toMatchObject({durationSeconds:1927,durationLabel:'32:07'});
    const seeks=[];
    for(const [label,time] of [['00:50',50.7],['01:46–02:38',106.76],['19:46–21:52',1186],['31:24–32:06',1884.97]] as const){
      await page.getByRole('button',{name:label,exact:true}).click();
      await expect.poll(()=>site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(time,2);
      await expect.poll(()=>page.evaluate(()=>(window as any).locateLog.at(-1))).toMatchObject({operation:{type:'library.locate',time},ok:true});
      seeks.push({time:await site.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)});
    }
    await writeFile(test.info().outputPath('native-seek.json'),JSON.stringify({seeks,requests:calls.length}));
    await page.screenshot({path:test.info().outputPath('production-numeric-time.png')});
  }finally{await context.close();}
});
