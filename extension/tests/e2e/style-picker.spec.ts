import {startNewChat} from './workbench-actions';
import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

test('entering HTML keeps the remembered style visible without opening its menu',async()=>{
 const {context,page,forbidden}=await setup();
 try{
  await page.bringToFront();
  const output=page.getByRole('button',{name:/^产物类型：/}),menu=page.getByRole('menu',{name:'HTML 页面风格'});
  await output.click();await page.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();
  await expect(page.getByRole('button',{name:'HTML 风格：默认',exact:true})).toHaveAttribute('aria-expanded','false');await expect(menu).toHaveCount(0);
  await page.getByRole('button',{name:'HTML 风格：默认',exact:true}).click();await menu.getByRole('menuitemradio',{name:'新拟态',exact:true}).click();
  await output.click();await page.getByRole('menuitemradio',{name:'Chat 问答',exact:true}).click();
  await output.click();await page.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();
  await expect(page.getByRole('button',{name:'HTML 风格：新拟态',exact:true})).toHaveAttribute('aria-expanded','false');await expect(menu).toHaveCount(0);
  await startNewChat(page);
  await output.click();await page.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();await expect(page.getByRole('button',{name:'HTML 风格：新拟态',exact:true})).toBeVisible();await expect(menu).toHaveCount(0);
  await page.reload();await expect(page.getByTestId('startup')).toHaveCount(0);await expect(page.getByRole('button',{name:'HTML 风格：新拟态',exact:true})).toBeVisible();await expect(menu).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('remembered-style-closed.png'),animations:'disabled'});expect(forbidden).toEqual([]);
 }finally{await context.close();}
});

test('style labels use the same outgoing and incoming animation as output labels',async()=>{
 const {context,page,forbidden}=await setup();
 try{
  await page.bringToFront();
  const output=page.getByRole('button',{name:/^产物类型：/}),menu=page.getByRole('menu',{name:'HTML 页面风格'});
  await page.evaluate(()=>{
   const original=Element.prototype.animate;(window as any).pickerLabelAnimations=[];
   Element.prototype.animate=function(frames,options){if(this.matches('.soft-text'))(window as any).pickerLabelAnimations.push({label:this.closest('button')?.getAttribute('aria-label'),frames,options});return original.call(this,frames,options);};
  });
  await output.click();await page.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();await expect(output.locator('.soft-text')).toHaveText('HTML');
  const trigger=page.getByRole('button',{name:/^HTML 风格：/});if(await menu.isVisible())await trigger.click();await expect(menu).toBeHidden();
  await trigger.click();await menu.getByRole('menuitemradio',{name:'新拟态',exact:true}).click();await expect(trigger.locator('.soft-text')).toHaveText('新拟态');
  const animations=await page.evaluate(()=>(window as any).pickerLabelAnimations),forLabel=(label:string)=>animations.filter((row:any)=>row.label===label).map(({frames,options}:any)=>({frames,options}));
  expect(forLabel('产物类型：HTML')).toHaveLength(2);expect(forLabel('HTML 风格：新拟态')).toEqual(forLabel('产物类型：HTML'));
  await page.emulateMedia({reducedMotion:'reduce'});await trigger.click();await menu.getByRole('menuitemradio',{name:'默认',exact:true}).click();await expect(trigger.locator('.soft-text')).toHaveText('默认');
  expect(await page.evaluate(()=>(window as any).pickerLabelAnimations.length)).toBe(4);expect(forbidden).toEqual([]);
 }finally{await context.close();}
});
