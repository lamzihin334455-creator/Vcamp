import {expect,test,chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {navigationScript} from '../../src/html/navigation';

const sample=readFileSync('tests/fixtures/inline-video-ranges.md','utf8');
const expected=['00:00','07:15','04:40','04:55','05:17','05:20','01:34','01:47'];

test('real Markdown renderer handles the reported assessment, click targets, narrow layout and streaming completion',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:400,height:850}});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {TimedMarkdown} from './src/workbench/TimedMarkdown';const root=createRoot(document.getElementById('root'));window.seekTimes=[];window.renderSample=(text)=>root.render(<article className="chat-turn"><div className="answer-content"><TimedMarkdown content={text} duration={435} seek={time=>window.seekTimes.push(time)}/></div></article>);`},bundle:true,write:false,format:'iife'});
  await page.setContent(`<style>${readFileSync('src/app/styles.css','utf8')}</style><main id="root" style="padding:12px"></main>`);
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(text=>(window as any).renderSample(text),sample);
  await expect(page.locator('.answer-time')).toHaveText(expected);
  await page.getByRole('button',{name:'04:55',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).seekTimes)).toEqual([295]);
  await expect(page.locator('strong').first()).toContainText('综合评分：88 / 100');
  for(const width of [280,400,960]){
   await page.setViewportSize({width,height:850});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  for(const text of ['依据（04:40–','依据（04:40–04:','依据（04:40–04:55）']){
   await page.evaluate(text=>(window as any).renderSample(text),text);
   await expect(page.locator('.answer-content')).toContainText('依据');
  }
  await expect(page.locator('.answer-time')).toHaveText(['04:40','04:55']);
  await page.evaluate(text=>(window as any).renderSample(text),sample);
  await expect(page.locator('.answer-time')).toHaveCount(8);
  await page.setViewportSize({width:400,height:850});
  await page.screenshot({path:test.info().outputPath('reported-assessment-fixed.png'),fullPage:true});
  expect(errors).toEqual([]);
 }finally{await browser.close();}
});

test('HTML and portable export use the same inline range recognition without nested anchors or code changes',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  const body='<p>完整字幕覆盖全片 0:00–7:15；论据（04:40–04:55），页面（05:17–05:20）；历史（01:34–01:47）。</p><p><strong>强调（04:40至04:55）</strong></p><pre>04:40–04:55</pre><p>会议时间 12:30–13:00</p><a id="explicit" href="vcamp-time:280"><strong>片段</strong> 04:40–04:55</a>';
  await page.setContent('<iframe sandbox="allow-scripts"></iframe>');
  await page.evaluate(({body,script})=>{
   (window as any).actions=[];window.addEventListener('message',e=>(window as any).actions.push(e.data));
   document.querySelector('iframe')!.srcdoc=`<!doctype html><head><script>${script}</script></head><body>${body}</body>`;
  },{body,script:navigationScript('inline')});
  const frame=page.frameLocator('iframe');
  await expect(frame.locator('a')).toHaveCount(11);
  await expect(frame.locator('p').first().locator('a')).toHaveText(expected);
  await expect(frame.locator('pre')).toHaveText('04:40–04:55');
  await expect(frame.locator('a a')).toHaveCount(0);
  await frame.getByRole('link',{name:'05:20',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).actions.at(-1))).toMatchObject({kind:'seek',time:320});
  const bundle=await build({entryPoints:['src/library/document-download.ts'],bundle:true,write:false,format:'iife',globalName:'ExportRangeTest'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const exported=await page.evaluate(body=>(window as any).ExportRangeTest.portableHtml({type:'html',name:'test.html',content:body,source:{videoId:'BVtest',pageNumber:1}}),body);
  await page.setContent(exported);
  const exportedFrame=page.frameLocator('iframe');
  await expect(exportedFrame.locator('a')).toHaveCount(11);
  await expect(exportedFrame.locator('p').first().locator('a')).toHaveText(expected);
  expect(await exportedFrame.getByRole('link',{name:'05:20',exact:true}).getAttribute('href')).toBe('vcamp-time:320');
  await expect(exportedFrame.locator('#explicit strong')).toHaveText('片段');
 }finally{await browser.close();}
});
