import {expect,test} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setup} from './interaction-fixture';

test('module headers give space to content/actions; subtitle tracks and settings use bounded menus',async()=>{
  const {context,page,fixture,forbidden}=await setup();
  const output=resolve('../.tmp/subtitle-overhaul-ui');await mkdir(output,{recursive:true});
  try{
    for(const [width,height] of [[280,650],[360,800],[490,360],[960,850]]){
      await page.setViewportSize({width,height});
      for(const name of ['笔记','HTML','随笔','字幕']){
        await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
        await expect(page.locator('.module-content')).toHaveAttribute('data-module',({笔记:'markdown',HTML:'html',随笔:'scribble',字幕:'subtitle'} as Record<string,string>)[name]);
        await expect(page.locator('.titlebar').getByRole('button',{name:'导出',exact:true})).toHaveCount(0);
        await expect.poll(()=>page.locator('.titlebar').evaluate(header=>{
          const bounds=header.getBoundingClientRect();
          return [...header.querySelectorAll('button')].every(button=>{const rect=button.getBoundingClientRect();return rect.right<=bounds.right+1&&rect.bottom<=bounds.bottom+1;});
        }),{message:`header controls fit at ${width}×${height}`}).toBe(true);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      }
      const timeline=page.getByLabel('字幕时间轴');
      await expect(timeline).toBeVisible();
      const before=await timeline.boundingBox();
      await page.getByRole('button',{name:'字幕设置',exact:true}).click();
      const popover=page.getByRole('dialog',{name:'字幕设置'});
      await expect(popover).toBeVisible();
      const after=await timeline.boundingBox();
      for(const key of ['x','y','width','height'] as const)expect(Math.abs(after![key]-before![key]),'settings do not displace the timeline; allow subpixel module animation').toBeLessThan(1);
      expect(await popover.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth+1;})).toBe(true);
      await expect(popover.getByLabel('跟随播放',{exact:true})).toBeChecked();
      await expect(page.locator('.titlebar').getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
      if(width===360)await page.screenshot({path:resolve(output,'settings-360.png')});
      if(height===360)await page.screenshot({path:resolve(output,'settings-short.png')});
      await page.keyboard.press('Escape');await expect(popover).toHaveCount(0);
      await expect(page.getByRole('button',{name:'字幕设置',exact:true})).toBeFocused();
    }
    await page.setViewportSize({width:400,height:850});
    await page.getByRole('button',{name:'切换字幕轨道'}).click();
    await page.getByRole('menu',{name:'字幕轨道'}).getByRole('menuitem',{name:/原始字幕 · English/}).click();
    await expect(page.getByRole('button',{name:'切换字幕轨道'})).toContainText('English');
    await expect(page.getByLabel('字幕时间轴')).toContainText('native ai-en');
    // Hold the actual write acknowledgement while background invalidations still run.
    await page.evaluate(()=>{
      const original=chrome.runtime.sendMessage.bind(chrome.runtime);
      (window as any).sourceSelectCalls=0;
      chrome.runtime.sendMessage=(async(message:any)=>{
        const result=await original(message);
        if(message.operation?.type==='subtitles.source.select'){
          (window as any).sourceSelectCalls++;
          await new Promise<void>(resolve=>{(window as any).releaseSourceSelect=resolve;});
        }
        return result;
      }) as any;
    });
    await page.getByRole('button',{name:'切换字幕轨道'}).click();
    await page.getByRole('menu',{name:'字幕轨道'}).getByRole('menuitem',{name:/AI 翻译 · en/}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).sourceSelectCalls)).toBe(1);
    await page.getByRole('button',{name:'切换字幕轨道'}).click();
    for(const item of await page.getByRole('menu',{name:'字幕轨道'}).getByRole('menuitem').all())await expect(item).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'字幕设置',exact:true}).click();
    await expect(page.getByLabel('主字幕',{exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'AI 字幕修正',exact:true})).toBeDisabled();
    await page.evaluate(()=>(window as any).releaseSourceSelect());
    await expect(page.getByLabel('主字幕',{exact:true})).toBeEnabled();
    await expect(page.getByLabel('主字幕',{exact:true})).toHaveValue('saved:'+fixture.translated);
    await expect(page.getByLabel('字幕时间轴')).toContainText('翻译内容');
    const popupBox=(await page.getByRole('dialog',{name:'字幕设置'}).boundingBox())!;
    await page.mouse.click(popupBox.x-3,popupBox.y+20);await expect(page.getByRole('dialog',{name:'字幕设置'})).toHaveCount(0);
    await page.getByRole('navigation').getByRole('button',{name:'问答',exact:true}).click();
    await expect(page.locator('.titlebar').getByRole('button',{name:'导出',exact:true})).toBeVisible();
    expect(forbidden).toEqual([]);
  }finally{await context.close();}
});

test('a source revision conflict retains the newer source instead of restoring an obsolete selection',async()=>{
  const {context,page,fixture}=await setup();
  try{
    await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(page.getByRole('button',{name:'切换字幕轨道'})).toContainText(/AI (?:翻译|字幕修正)/);
    await page.evaluate(workspaceId=>{
      const original=chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage=(async(message:any)=>{
        if(message.operation?.type==='subtitles.source.select'&&message.operation.source.language==='ai-en')await new Promise<void>(resolve=>{(window as any).releaseConflictingSelect=resolve;});
        return original(message);
      }) as any;
      (window as any).selectFromOtherPanel=async()=>{
        const read=await original({version:1,requestId:crypto.randomUUID(),operation:{type:'subtitles.query',workspaceId}});
        return original({version:1,requestId:crypto.randomUUID(),operation:{type:'subtitles.source.select',workspaceId,expectedRevision:read.view.subtitles.sourceRevision,source:{kind:'native',language:'ai-ja'}}});
      };
    },fixture.workspaceId);
    await page.getByRole('button',{name:'切换字幕轨道'}).click();
    await page.getByRole('menuitem',{name:/原始字幕 · English/}).click();
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseConflictingSelect)).toBe('function');
    await page.evaluate(()=>(window as any).selectFromOtherPanel());
    await expect(page.getByRole('button',{name:'切换字幕轨道'})).toContainText('日本語');
    await page.evaluate(()=>(window as any).releaseConflictingSelect());
    await expect(page.getByRole('alert')).toContainText('主字幕已变化或不可用');
    await expect(page.getByRole('button',{name:'切换字幕轨道'})).toContainText('日本語');
    await expect(page.getByLabel('字幕时间轴')).toContainText('native ai-ja');
  }finally{await context.close();}
});
