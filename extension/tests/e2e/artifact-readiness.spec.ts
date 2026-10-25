import {chromium,expect,test} from '@playwright/test';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';

test('artifact links wait until notes/pages are readable, then open immediately with a meaningful template request',async()=>{
  const built=await build({configFile:false,resolve:{alias:{'@provider-endpoint':resolve('src/generation/provider-endpoint.ts')}},plugins:[react()],logLevel:'silent',build:{write:false,minify:false,rollupOptions:{input:resolve('tests/e2e/artifact-readiness-harness.tsx'),output:{format:'iife',inlineDynamicImports:true}}}});
  if(Array.isArray(built)||!('output' in built))throw new Error('Unexpected harness build');
  const browser=await chromium.launch(),page=await browser.newPage();
  try{
    await page.setContent('<div id="root"></div>');
    for(const output of built.output){if(output.type==='asset'&&output.fileName.endsWith('.css'))await page.addStyleTag({content:String(output.source)});if(output.type==='chunk')await page.addScriptTag({content:output.code});}
    await expect(page.getByRole('button',{name:/打开(笔记|页面)/})).toHaveCount(0);
    await expect(page.getByText('使用模板「交互学习页」生成 HTML 页面')).toBeVisible();
    await expect(page.getByRole('button',{name:'打开笔记'})).toBeVisible();
    await expect(page.getByRole('button',{name:'打开页面'})).toBeVisible();
    await expect(page.getByText('HTML / 旧知识已保存')).toHaveCount(0);
    await page.getByRole('button',{name:'打开页面'}).click();
    await expect(page.locator('#opened')).toHaveText('page-ready');
    await page.evaluate(()=>(window as any).startCommit());
    await expect(page.getByText('本次资料',{exact:true})).toHaveCount(0);
    await expect(page.getByText('正在保存产物…')).toBeVisible();
    await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible();
    await expect(page.getByRole('button',{name:'停止生成'})).toBeDisabled();
    await expect(page.getByRole('button',{name:'打开笔记'})).toHaveCount(1);
    await page.evaluate(()=>(window as any).completePending());
    await page.waitForTimeout(30);
    expect(await page.getByRole('button',{name:'打开笔记'}).count()).toBe(1);
    await expect(page.getByText('笔记已保存，正在准备打开…')).toBeVisible();
    await expect(page.getByText('本次资料',{exact:true})).toBeVisible();
    await page.evaluate(()=>(window as any).makePendingReady());
    await expect(page.getByRole('button',{name:'打开笔记'})).toHaveCount(2);
  }finally{await browser.close();}
});
