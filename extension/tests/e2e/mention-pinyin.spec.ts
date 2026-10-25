import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

test('pinyin mention search and Enter select the first matching module',async()=>{
  const {context,page,site}=await setup();
  try{
    await site.bringToFront();await page.bringToFront();
    const input=page.getByLabel('输入草稿');
    await input.fill('@zhishibiji');
    await expect(page.locator('#mention-menu').getByRole('button',{name:/知识笔记/})).toBeVisible();
    await input.press('Enter');
    await expect(page.getByRole('button',{name:'移除任务模板 知识笔记',exact:true})).toBeVisible();
    await expect(page.getByLabel('输入草稿')).toHaveAttribute('placeholder',/选择模板/);
    await expect(input).toBeEditable();
  }finally{await context.close();}
});
