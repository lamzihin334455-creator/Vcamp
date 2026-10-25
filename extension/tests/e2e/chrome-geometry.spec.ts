import {expect,test} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setup} from './interaction-fixture';

test('header width is stable across rail hover and pinning, and the persistent toggle is circular',async()=>{
  test.setTimeout(60_000);
  const {context,page}=await setup();
  const output=resolve('../.tmp/chrome-geometry');
  await mkdir(output,{recursive:true});
  try{
    await page.bringToFront();
    await page.setViewportSize({width:490,height:873});
    await page.getByRole('navigation',{name:'模块导航'}).getByRole('button',{name:'字幕',exact:true}).click();
    const measure=()=>page.evaluate(()=>{
      const header=document.querySelector('.titlebar')!.getBoundingClientRect();
      const toggle=document.querySelector('.sidebar-toggle')!.getBoundingClientRect();
      return {headerWidth:header.width,headerHeight:header.height,headerRight:header.right,toggleLeft:toggle.left,toggleWidth:toggle.width,toggleHeight:toggle.height};
    });
    const pinned=await measure();
    await page.getByRole('button',{name:'收起侧栏',exact:true}).click();
    await page.mouse.move(100,400);
    await expect(page.locator('.app-shell')).not.toHaveClass(/rail-peek/);
    // Wait for the existing workspace padding transition to settle.
    await page.waitForTimeout(350);
    const hidden=await measure();
    await page.screenshot({path:resolve(output,'header-hidden.png')});
    await page.mouse.move(488,400);
    await expect(page.locator('.app-shell')).toHaveClass(/rail-peek/);
    await expect(page.locator('.rail')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
    const peek=await measure();
    await page.screenshot({path:resolve(output,'header-peek.png')});
    console.log('header geometry',JSON.stringify({pinned,hidden,peek}));
    expect(Math.abs(peek.headerWidth-hidden.headerWidth),'hover must not stretch the header').toBeLessThanOrEqual(1);
    expect(Math.abs(pinned.headerWidth-hidden.headerWidth),'pinning must not stretch the header').toBeLessThanOrEqual(1);
    for(const state of [pinned,hidden,peek]){
      expect(state.headerRight,'header must leave a gap before the persistent toggle').toBeLessThanOrEqual(state.toggleLeft-4);
      expect(Math.abs(state.toggleWidth-state.toggleHeight),'persistent toggle must be circular').toBeLessThanOrEqual(1);
      expect(state.toggleWidth,'toggle diameter must equal the header height').toBe(state.headerHeight);
    }
    await page.getByRole('button',{name:'固定侧栏',exact:true}).click();
    const collapse = page.getByRole('button',{name:'收起顶部工具栏',exact:true});
    const toggleBox = await collapse.boundingBox();
    await collapse.click();
    await expect(page.locator('.titlebar')).toBeHidden();
    const restore = page.getByRole('button',{name:'展开顶部工具栏',exact:true});
    expect(await restore.boundingBox()).toEqual(toggleBox);
    await expect(restore).toBeFocused();
    await restore.click();
    expect(await collapse.boundingBox()).toEqual(toggleBox);
    expect((await measure()).headerWidth).toBe(pinned.headerWidth);
    const originalTitle=await page.locator('.context-current-button strong').textContent();
    await page.locator('.context-current-button strong').evaluate(element=>{element.textContent='一个很长的视频标题，用于确认内容变化只截断文字，不会改变工具栏的固定宽度。'.repeat(5);});
    for(const [width,height] of [[280,850],[320,850],[420,850],[490,360],[760,850],[960,850]]){
      await page.setViewportSize({width,height});
      const state=await measure();
      expect(state.headerWidth).toBeLessThan(width);
      expect(state.headerRight).toBeLessThanOrEqual(state.toggleLeft-4);
      expect(state.toggleWidth).toBe(state.toggleHeight);
      expect(state.toggleWidth).toBe(state.headerHeight);
      const overflow=await page.locator('.titlebar').evaluate(element=>{
        const rect=element.getBoundingClientRect();
        return [...element.children].some(child=>{const box=child.getBoundingClientRect();return box.right>rect.right+1||box.bottom>rect.bottom+1;});
      });
      expect(overflow,`header children must fit at ${width}×${height}`).toBe(false);
    }
    await page.setViewportSize({width:490,height:873});
    await page.locator('.context-current-button strong').evaluate((element,title)=>{element.textContent=title;},originalTitle);
    await page.evaluate(()=>document.documentElement.style.setProperty('--accent','#d96f91'));
    await page.screenshot({path:resolve(output,'header-pinned-final.png')});
  }finally{await context.close();}
});

test('library search and view controls stay compact and aligned in a narrow panel',async()=>{
  const {context,page}=await setup();
  try{
    await page.bringToFront();
    await page.setViewportSize({width:420,height:873});
    await page.getByRole('button',{name:'资料库',exact:true}).click();
    await expect(page.getByRole('heading',{name:'资料库',exact:true})).toBeVisible();
    const boxes=await page.locator('.library-search, .library-mode-tabs button').evaluateAll(elements=>elements.map(element=>{
      const rect=element.getBoundingClientRect();
      return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
    }));
    console.log('library controls',JSON.stringify(boxes));
    for(const box of boxes)expect(box.height,'compact command bar height').toBeLessThanOrEqual(36);
    for(const box of boxes.slice(1)){
      expect(box.width,'compact view control width').toBeLessThanOrEqual(36);
      expect(box.y).toBe(boxes[0].y);
    }
    expect(boxes.at(-1)!.x+boxes.at(-1)!.width).toBeLessThanOrEqual(420);
    await page.getByRole('button',{name:'收藏夹',exact:true}).click();
    await expect(page.getByRole('heading',{name:'收藏夹',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'最近',exact:true}).click();
    await expect(page.getByRole('heading',{name:'最近',exact:true})).toBeVisible();
    await page.evaluate(()=>document.documentElement.style.setProperty('--accent','#d96f91'));
    await page.screenshot({path:resolve('../.tmp/chrome-geometry/library-compact.png')});
    await page.screenshot({path:resolve('../.tmp/chrome-geometry/layout-preview.png'),clip:{x:0,y:0,width:420,height:200}});
  }finally{await context.close();}
});
