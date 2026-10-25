import {test,expect} from '@playwright/test';
import {setup} from './interaction-fixture';

test('compact export reserves space for a long list and keeps both download modes and actions reachable',async()=>{
 test.setTimeout(60000);
 const {context,page,fixture}=await setup();
 try{
  await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:15000});
  // Expand only this synthetic catalogue response; downloads use a separate
  // production-browser regression with the actual serializer and files.
  await page.evaluate(workspaceId=>{
   const original=chrome.runtime.sendMessage.bind(chrome.runtime);
   chrome.runtime.sendMessage=(async(message:any)=>{
    const reply=await original(message);
    if(message.operation?.type==='library.read'&&reply.ok){
     reply.view.library.entities.push(...Array.from({length:40},(_,i)=>({workspaceId,entityType:'markdown',id:`layout-${i}`,title:`第 ${i+1} 篇 · 字幕修正与视频工作流的长标题笔记`,summary:'视频资料与术语核对的完整记录。'})));
    }
    return reply;
   }) as any;
  },fixture.workspaceId);
  await page.setViewportSize({width:680,height:850});
  await page.getByRole('button',{name:'导出',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出资料'});
  await expect(dialog.locator('.export-row')).toHaveCount(42);
  await expect(dialog.getByRole('heading')).toHaveCount(0);await expect(dialog.getByRole('searchbox')).toHaveCount(0);
  await dialog.getByRole('button',{name:'全选',exact:true}).click();await expect(dialog.locator('.export-footer')).toContainText('已选 42 项');
  await page.screenshot({path:test.info().outputPath('export-many-notes.png'),animations:'disabled'});
  await dialog.getByRole('tab',{name:/^字幕/}).click();await dialog.getByRole('button',{name:'全选',exact:true}).click();
  await expect(dialog).not.toContainText('JSON 为 Vcamp');
  for(const [width,height] of [[680,850],[400,650],[320,480],[280,400]]){
   await page.setViewportSize({width,height});
   for(const name of ['笔记','随笔','问答','字幕','HTML'])await expect(dialog.getByRole('tab',{name:new RegExp('^'+name)})).toBeInViewport();
   await dialog.getByRole('checkbox',{name:'JSON',exact:true}).check();await dialog.getByRole('checkbox',{name:'JSON',exact:true}).uncheck();
   await expect(dialog.getByRole('radio',{name:'分别下载'})).toBeVisible();await expect(dialog.getByRole('radio',{name:'合并打包'})).toBeVisible();
   await dialog.getByRole('radio',{name:'分别下载'}).check();await dialog.getByRole('radio',{name:'合并打包'}).check();
   const geometry=await dialog.evaluate(element=>{
    const box=(selector:string)=>{const b=element.querySelector(selector)!.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,height:b.height};};
    return {panel:element.getBoundingClientRect().toJSON(),list:box('.export-list'),footer:box('.export-footer'),modes:box('.export-modes'),actions:box('.export-actions'),toolbar:box('.export-toolbar'),select:box('.export-selection'),overflow:element.scrollWidth>element.clientWidth+1};
   });
   await test.info().attach(`geometry-${width}`,{body:JSON.stringify(geometry,null,2),contentType:'application/json'});
   await page.screenshot({path:test.info().outputPath(`export-${width}x${height}.png`),animations:'disabled'});
   expect(geometry.overflow).toBe(false);expect(geometry.panel.x).toBeGreaterThanOrEqual(0);expect(geometry.footer.bottom).toBeLessThan(height-4);expect(geometry.list.bottom).toBeLessThanOrEqual(geometry.footer.y);expect(geometry.list.height).toBeGreaterThan(45);expect(geometry.modes.bottom).toBeLessThanOrEqual(geometry.actions.y);expect(geometry.select.y).toBeGreaterThanOrEqual(geometry.toolbar.y);expect(geometry.select.bottom).toBeLessThanOrEqual(geometry.toolbar.bottom);
   await dialog.locator('.export-list').evaluate(element=>element.scrollTop=element.scrollHeight);
   await page.screenshot({path:test.info().outputPath(`export-${width}x${height}.png`),animations:'disabled'});
  }
  await dialog.getByRole('button',{name:'清空',exact:true}).click();await expect(dialog.locator('.export-footer')).toContainText('已选 0 项');
  await dialog.getByRole('tab',{name:/^笔记/}).click();await expect(dialog.locator('.export-list input:checked')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'开始导出',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'关闭导出',exact:true}).click();await expect(dialog).toHaveCount(0);
 }finally{await context.close();}
});
