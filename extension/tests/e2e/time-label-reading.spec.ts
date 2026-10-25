import {expect,test,chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {navigationScript} from '../../src/html/navigation';

test('HTML preview and export preserve labelled intervals and emphasis, and seek to the original fractional start',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  const source='<a id="range" href="vcamp-time:60.25"><strong>关键演示</strong> 01:00–02:00</a><a id="point" href="vcamp-time:60.25">1:00</a>';
  await page.setContent('<iframe sandbox="allow-scripts"></iframe>');
  await page.evaluate(({script,source})=>{
   (window as any).actions=[];
   window.addEventListener('message',e=>(window as any).actions.push(e.data));
   document.querySelector('iframe')!.srcdoc=`<!doctype html><html><head><script>${script}</script></head><body>${source}</body></html>`;
  },{script:navigationScript('reading'),source});
  const frame=page.frameLocator('iframe');
  await expect(frame.locator('#range')).toHaveText('关键演示 01:00–02:00');
  await expect(frame.locator('#range strong')).toHaveCount(1);
  await expect(frame.locator('#point')).toHaveText('01:00');
  await frame.locator('#range').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).actions.at(-1))).toMatchObject({kind:'seek',time:60.25});
  const bundle=await build({entryPoints:['src/library/document-download.ts'],bundle:true,write:false,format:'iife',globalName:'ExportTest'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const exported=await page.evaluate(source=>{
   const html=(window as any).ExportTest.portableHtml({type:'html',name:'test.html',content:source,source:{videoId:'BVtest',pageNumber:1}});
   const host=new DOMParser().parseFromString(html,'text/html');
   const doc=new DOMParser().parseFromString(host.querySelector('iframe')!.srcdoc,'text/html');
   return {text:doc.querySelector('#range')!.textContent,strong:!!doc.querySelector('#range strong'),href:doc.querySelector('#range')!.getAttribute('href')};
  },source);
  expect(exported).toMatchObject({text:'关键演示 01:00–02:00',strong:true});
  expect(exported.href).toContain('&t=60&');
 }finally{await browser.close();}
});

test('chat and note titles keep a readable hierarchy at narrow and wide sizes',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent(`<style>${readFileSync('src/app/styles.css','utf8')}</style><article class="chat-turn"><div class="answer-content"><h1>一级标题</h1><h2>二级标题</h2><h3>三级标题</h3><p>正文</p></div></article><article class="markdown-body"><h1>一级标题</h1><h2>二级标题</h2><h3>三级标题</h3></article>`);
  for(const width of [280,400,960]){
   await page.setViewportSize({width,height:700});
   for(const selector of ['.answer-content','.markdown-body']){
    const sizes=await page.locator(selector).evaluate(el=>['h1','h2','h3'].map(tag=>parseFloat(getComputedStyle(el.querySelector(tag)!).fontSize)));
    expect(sizes[0]).toBeGreaterThan(sizes[1]);expect(sizes[1]).toBeGreaterThan(sizes[2]);
   }
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
 }finally{await browser.close();}
});
