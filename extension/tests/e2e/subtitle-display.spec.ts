import {chromium,expect,test,type Page} from '@playwright/test';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';

async function mount(page:Page){
 const built=await build({configFile:false,plugins:[react()],logLevel:'silent',build:{write:false,rollupOptions:{input:resolve('tests/e2e/subtitle-display-harness.tsx'),output:{format:'iife',inlineDynamicImports:true}}}});
 if(Array.isArray(built)||!('output' in built))throw new Error('Unexpected harness build');
 await page.setContent('<div id="root"></div><style>.native-subtitles{height:550px;display:flex;flex-direction:column}.subtitle-list{flex:1;overflow:auto;min-height:0}</style>');
 for(const output of built.output)if(output.type==='asset'&&output.fileName.endsWith('.css'))await page.addStyleTag({content:String(output.source)});
 for(const output of built.output)if(output.type==='chunk')await page.addScriptTag({content:output.code});
 await page.getByRole('button',{name:'字幕设置',exact:true}).click();
}
test('bilingual primary and auxiliary font sizes can be changed independently',async()=>{
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:420,height:700}});
 try{
  await mount(page);await page.getByRole('checkbox',{name:'双语显示',exact:true}).check();
  const primary=page.getByRole('slider',{name:'主字幕字号',exact:true}),secondary=page.getByRole('slider',{name:'辅助字幕字号',exact:true});
  await expect(primary).toBeVisible();await expect(secondary).toBeVisible();
  await primary.focus();await primary.press('End');await secondary.focus();await secondary.press('Home');await secondary.press('ArrowRight');
  const row=page.locator('.subtitle-row').first();await expect(row.locator('.subtitle-text>span').first()).toHaveCSS('font-size','24px');await expect(row.locator('.subtitle-secondary')).toHaveCSS('font-size','16px');
  expect(await page.evaluate(()=>(window as any).displayFixture.sizes)).toMatchObject({primary:24,auxiliaryFontSize:16});
 }finally{await browser.close();}
});
test('automatic return is enabled by default, waits after scrolling, and can be disabled',async()=>{
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:420,height:700}});
 try{
  await page.clock.install();await mount(page);const auto=page.getByRole('checkbox',{name:'自动归位',exact:true});await expect(auto).toBeChecked();
  await page.getByRole('button',{name:'关闭字幕设置'}).click();const list=page.getByLabel('字幕时间轴');await list.hover();await page.mouse.wheel(0,-400);await expect(page.locator('.subtitle-position')).toContainText('已暂停跟随');
  await page.clock.fastForward(4500);await expect(page.locator('.subtitle-position')).toContainText('已暂停跟随');
  await page.evaluate(()=>(window as any).displayFixture.setTime(120));await page.clock.fastForward(600);await expect(page.locator('.subtitle-position')).not.toContainText('已暂停跟随');await expect(page.locator('.subtitle-row.current')).toBeInViewport();
  await page.getByRole('button',{name:'字幕设置',exact:true}).click();await auto.uncheck();await page.getByRole('button',{name:'关闭字幕设置'}).click();await list.hover();await page.mouse.wheel(0,-400);await page.clock.fastForward(6000);await expect(page.locator('.subtitle-position')).toContainText('已暂停跟随');
 }finally{await browser.close();}
});
