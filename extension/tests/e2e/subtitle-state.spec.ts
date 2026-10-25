import {chromium,expect,test} from '@playwright/test';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';

test('subtitle source acknowledgements and fresh reads survive late success and late failure',async()=>{
  const built=await build({configFile:false,resolve:{alias:{'@provider-endpoint':resolve('src/generation/provider-endpoint.ts')}},plugins:[react()],logLevel:'silent',build:{write:false,minify:false,rollupOptions:{input:resolve('tests/e2e/subtitle-state-harness.tsx'),output:{format:'iife',inlineDynamicImports:true}}}});
  if(Array.isArray(built)||!('output' in built))throw new Error('Unexpected harness build');
  const browser=await chromium.launch(),page=await browser.newPage();
  try{
    await page.setContent('<div id="root"></div>');
    for(const output of built.output)if(output.type==='chunk')await page.addScriptTag({content:output.code});
    await expect.poll(()=>page.evaluate(()=>(window as any).subtitleTest.count())).toBe(1);
    await page.getByRole('button',{name:'选择新轨道'}).click();
    await expect(page.locator('#revision')).toHaveText('2');
    await page.evaluate(()=>(window as any).subtitleTest.resolve(0,0));
    await page.waitForTimeout(30);
    await expect(page.locator('#revision')).toHaveText('2');
    await page.evaluate(()=>{(window as any).subtitleTest.invalidate();(window as any).subtitleTest.invalidate();});
    await expect.poll(()=>page.evaluate(()=>(window as any).subtitleTest.count())).toBe(3);
    await page.evaluate(()=>(window as any).subtitleTest.resolve(2,3));
    await expect(page.locator('#revision')).toHaveText('3');
    await page.evaluate(()=>(window as any).subtitleTest.reject(1));
    await page.waitForTimeout(30);
    await expect(page.locator('#revision')).toHaveText('3');
    await expect(page.locator('#error')).toBeEmpty();
    await page.evaluate(()=>{(window as any).subtitleTest.invalidate();});
    await page.evaluate(()=>(window as any).subtitleTest.resolve(3,1));
    await page.waitForTimeout(30);
    await expect(page.locator('#revision')).toHaveText('3');
  }finally{await browser.close();}
});
