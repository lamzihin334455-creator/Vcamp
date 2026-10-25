import {startNewChat} from './workbench-actions';
import {expect,test,type Locator,type Page} from '@playwright/test';
import {setup} from './interaction-fixture';

const lines=(count:number)=>Array.from({length:count},(_,i)=>`第 ${i+1} 行：输入框随内容向上伸展，保留清楚可见的发送按钮。`).join('\n');
const geometry=(input:Locator)=>input.evaluate(element=>{
  const field=element as HTMLTextAreaElement,box=field.getBoundingClientRect(),composer=field.closest('.composer')!.getBoundingClientRect();
  return {height:box.height,client:field.clientHeight,content:field.scrollHeight,scroll:field.scrollTop,overflow:getComputedStyle(field).overflowY,panelHeight:composer.height,bottom:composer.bottom,screen:innerHeight};
});
async function blankChat(page:Page){
  await page.emulateMedia({reducedMotion:'reduce'});
  await startNewChat(page);
  await expect(page.getByLabel('输入草稿')).toHaveValue('');
}

test('multiline input grows upwards before scrolling, stays capped, and shrinks after deletion',async()=>{
  const {context,page,forbidden}=await setup();
  try{
    await blankChat(page);const input=page.getByLabel('输入草稿'),initial=await geometry(input);
    await input.fill(lines(3));let box=await geometry(input);
    expect(box.height).toBeGreaterThan(initial.height+20);expect(box.content).toBeLessThanOrEqual(box.client+1);expect(box.overflow).toBe('hidden');expect(Math.abs(box.bottom-initial.bottom)).toBeLessThan(1);
    await expect(page.getByTestId('startup')).toHaveCount(0);await page.screenshot({path:test.info().outputPath('three-lines.png')});
    await input.fill(lines(60));box=await geometry(input);
    expect(box.panelHeight).toBeCloseTo(box.screen/3,0);expect(box.content).toBeGreaterThan(box.client);expect(box.overflow).toBe('auto');expect(Math.abs(box.bottom-initial.bottom)).toBeLessThan(1);
    await input.press('Control+End');await input.press('End');await page.keyboard.insertText('末尾继续输入');
    await expect.poll(async()=>{const current=await geometry(input);return current.scroll+current.client>=current.content-2;}).toBe(true);
    await page.screenshot({path:test.info().outputPath('long-text-capped.png')});
    await input.fill('短内容');box=await geometry(input);expect(box.height).toBe(initial.height);expect(box.overflow).toBe('hidden');expect(box.scroll).toBe(0);
    expect(forbidden).toEqual([]);
  }finally{await context.close();}
});

test('wrapping responds to width and screen height, restored drafts resize, and blank chats reset',async()=>{
  const {context,page,forbidden}=await setup();
  try{
    await blankChat(page);const input=page.getByLabel('输入草稿'),minimum=(await geometry(input)).height,paragraph='连续输入文字时无需手动拖动输入框，宽度改变也应重新排版。'.repeat(12);
    await page.setViewportSize({width:720,height:1000});await input.fill(paragraph);const wide=await geometry(input);
    await page.setViewportSize({width:280,height:1000});await expect.poll(async()=>(await geometry(input)).height).toBeGreaterThan(wide.height);
    await page.setViewportSize({width:280,height:600});await expect.poll(async()=>(await geometry(input)).panelHeight).toBeCloseTo(200,0);
    const send=(await page.getByRole('button',{name:'发送',exact:true}).boundingBox())!;expect(send.y+send.height).toBeLessThanOrEqual(600);expect(send.y).toBeGreaterThan(0);
    await expect.poll(()=>page.evaluate(async()=>{const result=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'workspace.query'}});return result.view.draft.text;})).toBe(paragraph);
    await page.reload();await expect(input).toHaveValue(paragraph);await expect.poll(async()=>(await geometry(input)).panelHeight).toBeCloseTo(200,0);
    await expect(page.getByTestId('startup')).toHaveCount(0);await page.screenshot({path:test.info().outputPath('narrow-restored.png')});
    await blankChat(page);expect((await geometry(input)).height).toBe(minimum);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(forbidden).toEqual([]);
  }finally{await context.close();}
});

test('scribbles share automatic height and save normally with Enter',async()=>{
  const {context,page,forbidden}=await setup();
  try{
    await blankChat(page);const input=page.getByLabel('输入草稿'),minimum=(await geometry(input)).height;await input.fill('!');await page.locator('#mention-menu').getByRole('button',{name:/^写随笔/}).click();
    await input.fill(lines(30));const box=await geometry(input);expect(box.panelHeight).toBeCloseTo(box.screen/3,0);expect(box.overflow).toBe('auto');
    await page.getByRole('button',{name:'移除随笔时间点',exact:true}).click();await expect.poll(async()=>(await geometry(input)).panelHeight).toBeCloseTo(box.screen/3,0);
    await input.press('Enter');await expect(page.getByRole('button',{name:'取消随笔',exact:true})).toHaveCount(0);await expect(input).toHaveValue('');expect((await geometry(input)).height).toBe(minimum);
    await expect(page.getByText('已创建随笔',{exact:true})).toBeVisible();expect(forbidden).toEqual([]);
  }finally{await context.close();}
});
