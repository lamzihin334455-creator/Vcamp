import {test,expect,chromium} from '@playwright/test';
import {navigationScript} from '../../src/html/navigation';
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';

test('HTML prose and timeline consume Markdown video-time links instead of exposing their protocol syntax',async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:420,height:760}});
    await page.setContent('<iframe title="generated" sandbox="allow-scripts" style="width:100%;height:700px;border:0"></iframe>');
    await page.evaluate(script=>{
      (window as any).actions=[];window.addEventListener('message',event=>(window as any).actions.push(event.data));
      document.querySelector('iframe')!.srcdoc=`<!doctype html><html><head><title>时间引用回归</title><script>${script}</script></head><body><h1>说法时间线</h1><blockquote id="quote">“试着写成一份大规格文档。” [27:56](vcamp-time:1676.23) 附近</blockquote><ol><li id="timeline">放弃规格文档，把精力放回代码 [28:27](vcamp-time:1707.51)。</li></ol></body></html>`;
    },navigationScript('html-markdown-time'));
    const frame=page.frameLocator('iframe');
    await page.screenshot({path:test.info().outputPath('timeline.png')});
    await expect(frame.locator('#quote')).toHaveText('“试着写成一份大规格文档。” 27:56 附近',{timeout:1000});
    await expect(frame.locator('#timeline')).toHaveText('放弃规格文档，把精力放回代码 28:27。');
    await expect(frame.locator('#quote a')).toHaveAttribute('href','vcamp-time:1676.23');
    await frame.locator('#quote a').click();
    await expect.poll(()=>page.evaluate(()=>(window as any).actions.at(-1))).toMatchObject({kind:'seek',time:1676.23});
  }finally{await browser.close();}
});

test('HTML dynamic labels and existing controls keep their structure; code examples and unsafe targets stay text; export uses the same repair',async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const source=`<!doctype html><html><head><title>动态时间引用</title></head><body>
      <p id="range">[27:56–28:27](vcamp-time:1676.23)</p>
      <a id="existing" href="vcamp-time:1676.23"><strong>[27:56](vcamp-time:1676.23)</strong></a>
      <button id="time-button"><span>[28:27](vcamp-time:1707.51)</span></button>
      <pre id="code">[27:56](vcamp-time:1676.23)<a href="vcamp-time:2">[00:02](vcamp-time:2)</a></pre>
      <textarea>[27:56](vcamp-time:1676.23)</textarea><div contenteditable="true">[27:56](vcamp-time:1676.23)</div>
      <p id="invalid">[27:56](vcamp-time:-1)</p><p id="clock">会议时间 12:30–13:30</p>
      <a id="local" href="#range">页内位置</a><p id="dynamic">等待内容</p><button id="update">切换说法</button>
      <script>document.querySelector('#update').onclick=()=>{document.querySelector('#dynamic').firstChild.data='稍后补充 [33:38](vcamp-time:2018.25)。';};</script></body></html>`;
    await page.setContent('<iframe sandbox="allow-scripts"></iframe>');
    await page.evaluate(({source,script})=>{
      (window as any).actions=[];window.addEventListener('message',event=>(window as any).actions.push(event.data));
      document.querySelector('iframe')!.srcdoc=source.replace('</head>',`<script>${script}</script></head>`);
    },{source,script:navigationScript('dynamic-times')});
    const frame=page.frameLocator('iframe');
    await expect(frame.locator('#range')).toHaveText('27:56–28:27');await expect(frame.locator('#range a')).toHaveAttribute('href','vcamp-time:1676.23');
    await expect(frame.locator('#existing strong')).toHaveText('27:56');await expect(frame.locator('#time-button span')).toHaveText('28:27');
    await expect(frame.locator('#time-button a')).toHaveCount(0);
    await frame.locator('#time-button').click();await expect.poll(()=>page.evaluate(()=>(window as any).actions.at(-1))).toMatchObject({kind:'seek',time:1707.51});
    await frame.locator('#update').click();await expect(frame.locator('#dynamic')).toHaveText('稍后补充 33:38。');
    await expect(frame.locator('#dynamic a')).toHaveAttribute('href','vcamp-time:2018.25');
    await expect(frame.locator('#code')).toContainText('[27:56](vcamp-time:1676.23)');await expect(frame.locator('#code a')).toHaveText('[00:02](vcamp-time:2)');
    await expect(frame.locator('textarea')).toHaveValue('[27:56](vcamp-time:1676.23)');await expect(frame.locator('[contenteditable]')).toHaveText('[27:56](vcamp-time:1676.23)');
    await expect(frame.locator('#invalid')).toHaveText('[27:56](vcamp-time:-1)');await expect(frame.locator('#invalid a,#clock a')).toHaveCount(0);
    const bundle=await build({entryPoints:['src/library/document-download.ts'],bundle:true,write:false,format:'iife',globalName:'TimeExport'});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const exported=await page.evaluate(source=>(window as any).TimeExport.portableHtml({type:'html',name:'times.html',content:source,source:{videoId:'BVtest',pageNumber:2}}),source);
    await writeFile(test.info().outputPath('portable-time-reference.html'),exported);await page.setContent(exported);
    const portable=page.frameLocator('iframe');await expect(portable.locator('#range')).toHaveText('27:56–28:27');
    await expect(portable.locator('#time-button span')).toHaveText('28:27');await portable.locator('#update').click();await expect(portable.locator('#dynamic')).toHaveText('稍后补充 33:38。');
    await expect(portable.locator('#code a')).toHaveText('[00:02](vcamp-time:2)');expect(errors).toEqual([]);
  }finally{await browser.close();}
});
