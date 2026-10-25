import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

test('module switching has one scroll owner and textarea focus does not draw an accent outline',async({page})=>{
  await page.setContent('<main class="module-content" data-module="markdown"><div class="note-module"><section class="markdown-workbench"><textarea>光标</textarea><div style="height:1600px">正文</div></section></div></main>');
  await page.addStyleTag({content:await readFile(resolve('src/app/styles.css'),'utf8')});
  await page.locator('main').evaluate(element=>{(element as HTMLElement).style.cssText='height:320px;display:flex;flex-direction:column';});
  await page.getByRole('textbox').focus();
  const state=await page.evaluate(()=>{
    const outer=document.querySelector<HTMLElement>('.module-content')!,inner=document.querySelector<HTMLElement>('.note-module')!,textarea=document.querySelector<HTMLTextAreaElement>('textarea')!;
    return {outerOverflow:getComputedStyle(outer).overflowY,innerOverflow:getComputedStyle(inner).overflowY,outline:getComputedStyle(textarea).outlineStyle};
  });
  expect(state).toEqual({outerOverflow:'hidden',innerOverflow:'auto',outline:'none'});
});
