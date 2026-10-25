import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

test('HTML styles open to the left without moving the output anchor and remain global',async()=>{
 const {context,page,site,forbidden}=await setup();
 try{
  const output=page.getByRole('button',{name:/^产物类型：/}),anchor=(await output.boundingBox())!;
  await output.click();await page.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();
  const styles=page.getByRole('menu',{name:'HTML 页面风格'});await expect(styles).toHaveCount(0);await page.getByRole('button',{name:'HTML 风格：默认',exact:true}).click();await expect(styles.getByRole('menuitemradio',{name:'拟物风',exact:true})).toHaveCount(0);await styles.getByRole('menuitemradio',{name:'新拟态',exact:true}).click();
  const selected=page.getByRole('button',{name:'HTML 风格：新拟态',exact:true});await expect(selected).toBeVisible();
  const html=(await output.boundingBox())!;expect(Math.abs(html.x+html.width-anchor.x-anchor.width)).toBeLessThan(1);
  expect(await page.evaluate(()=>getComputedStyle(document.querySelector('.html-style-control')!).animationName)).toBe('styleReveal');
  for(const width of [280,400,720]){
   await page.setViewportSize({width,height:850});const styleBox=(await selected.boundingBox())!,outputBox=(await output.boundingBox())!,plus=(await page.getByRole('button',{name:'更多输入操作'}).boundingBox())!;
   expect(styleBox.x).toBeGreaterThanOrEqual(plus.x+plus.width);expect(styleBox.x+styleBox.width).toBeLessThanOrEqual(outputBox.x);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.setViewportSize({width:400,height:850});await page.screenshot({path:test.info().outputPath('style-left.png'),animations:'disabled'});
  await page.getByRole('button',{name:'切换当前内容'}).click();await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
  await output.click();await page.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();await expect(selected).toBeVisible();await expect(styles).toHaveCount(0);await selected.click();await expect(styles.getByRole('menuitemradio',{name:'新拟态',exact:true})).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('Escape');await page.reload();await expect(output).toBeVisible();await expect(selected).toBeVisible();
  await site.goto('https://www.bilibili.com/video/BVsingle/');await site.bringToFront();await expect(page.locator('.context-current-button strong')).toHaveText('单视频样本');
  await output.click();await page.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();await expect(selected).toBeVisible();
  await expect(styles).toHaveCount(0);await selected.click();await styles.getByRole('menuitemradio',{name:'默认',exact:true}).click();await expect(page.getByRole('button',{name:'HTML 风格：默认',exact:true})).toBeVisible();
  await output.click();const closing=await page.getByRole('menuitemradio',{name:'Chat 问答',exact:true}).evaluate(async element=>{(element as HTMLButtonElement).click();await new Promise(requestAnimationFrame);const control=document.querySelector('.html-style-control');return {closing:control?.getAttribute('data-closing'),inert:control?.hasAttribute('inert'),animation:control?getComputedStyle(control).animationName:''};});expect(closing).toEqual({closing:'true',inert:true,animation:'styleDismiss'});await expect(page.locator('.html-style-control')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});await output.click();await page.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();expect(await page.locator('.html-style-control').evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
  expect(await page.evaluate(()=>chrome.storage.local.get('vcamp.htmlStyle'))).toEqual({'vcamp.htmlStyle':null});expect(forbidden).toEqual([]);
 }finally{await context.close();}
});

test('scribbles use the same composer with separately removable mode and time tags',async()=>{
 const {context,page,fixture,forbidden}=await setup();
 try{
  const input=page.getByLabel('输入草稿'),composer=page.getByLabel('输入区');await expect(input).toHaveAttribute('placeholder','');
  const original=await input.evaluate(el=>({radius:getComputedStyle(el.parentElement!).borderRadius,font:getComputedStyle(el).fontSize,height:el.getBoundingClientRect().height}));
  await input.fill('!');await page.locator('#mention-menu').getByRole('button',{name:/^写随笔/}).click();
  await expect(page.getByRole('button',{name:'取消随笔',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'移除随笔时间点',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible();
  await expect(composer.getByRole('alert')).toHaveCount(0);
  expect(await input.evaluate(el=>({radius:getComputedStyle(el.parentElement!).borderRadius,font:getComputedStyle(el).fontSize,height:el.getBoundingClientRect().height}))).toEqual(original);
  await expect(composer).not.toContainText('Enter 保存');await expect(composer.getByRole('button',{name:'保存随笔',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'移除随笔时间点',exact:true}).click();await expect(page.getByRole('button',{name:'取消随笔',exact:true})).toBeVisible();await input.fill('没有时间的独立随笔');await input.press('Enter');
  await expect(page.getByRole('button',{name:'取消随笔',exact:true})).toHaveCount(0);
  const stored=()=>page.evaluate(workspaceId=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'scribble.query',workspaceId}}),fixture.workspaceId);
  await expect.poll(async()=>((await stored()).view.scribbles.scribbles as any[]).some(item=>item.text==='没有时间的独立随笔'&&item.time===null)).toBe(true);
  await input.fill('!');await page.locator('#mention-menu').getByRole('button',{name:/^写随笔/}).click();await input.fill('保留输入内容');await page.screenshot({path:test.info().outputPath('scribble-tags.png'),animations:'disabled'});await page.getByRole('button',{name:'取消随笔',exact:true}).click();await expect(input).toHaveValue('保留输入内容');await expect(composer.getByRole('alert')).toContainText('请选择 DeepSeek 已声明支持视觉的模型');await expect(composer.getByRole('button',{name:'发送',exact:true})).toBeDisabled();
  expect(forbidden).toEqual([]);
 }finally{await context.close();}
});

test('subtitle settings retain both font sizes and automatic return, with refresh beside settings',async()=>{
 const {context,page,fixture}=await setup();
 try{
  await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
  const refresh=page.locator('.header-actions').getByRole('button',{name:'刷新',exact:true});await expect(refresh).toBeVisible();await expect(refresh).toHaveAttribute('title','重新读取字幕并回到当前播放位置');await expect(refresh).toHaveText('');
  await page.getByRole('button',{name:'字幕设置',exact:true}).click();const settings=page.getByRole('dialog',{name:'字幕设置'});
  await expect(settings).not.toContainText('按主字幕分批处理');await expect(settings).not.toContainText('当前主字幕同时用于');await expect(settings.getByRole('button',{name:'刷新并跟随',exact:true})).toHaveCount(0);
  await settings.getByLabel('主字幕',{exact:true}).selectOption(`saved:${fixture.enhanced}`);await settings.getByRole('checkbox',{name:'双语显示',exact:true}).check();
  const primary=settings.getByRole('slider',{name:'主字幕字号',exact:true}),aux=settings.getByRole('slider',{name:'辅助字幕字号',exact:true});await primary.focus();await primary.press('End');await aux.focus();await aux.press('Home');await aux.press('ArrowRight');
  await expect(settings.getByRole('checkbox',{name:'自动归位',exact:true})).toBeChecked();await settings.getByRole('checkbox',{name:'自动归位',exact:true}).uncheck();
  await page.getByRole('button',{name:'关闭字幕设置'}).click();await refresh.click();await expect(refresh).toBeEnabled();
  await page.getByRole('navigation').getByRole('button',{name:'问答',exact:true}).click();await expect(page.locator('body')).not.toContainText('问答将直接使用字幕模块中选择的主字幕');
  await page.reload();await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();await page.getByRole('button',{name:'字幕设置',exact:true}).click();await settings.getByRole('checkbox',{name:'双语显示',exact:true}).check();await expect(primary).toHaveValue('24');await expect(aux).toHaveValue('16');await expect(settings.getByRole('checkbox',{name:'自动归位',exact:true})).not.toBeChecked();
  await expect(page.getByTestId('startup')).toHaveCount(0);await expect(settings).toBeVisible();await page.screenshot({path:test.info().outputPath('subtitle-settings.png'),animations:'disabled'});
 }finally{await context.close();}
});
