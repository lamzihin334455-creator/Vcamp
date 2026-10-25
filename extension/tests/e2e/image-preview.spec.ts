import {expect,test,type Page} from '@playwright/test';
import {setup} from './interaction-fixture';

async function addImage(page:Page,name:string,width:number,height:number){
  const encoded=await page.evaluate(({width,height})=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#203649';ctx.fillRect(0,0,width,height);
    ctx.strokeStyle='#a7c6dc';ctx.lineWidth=4;ctx.strokeRect(4,4,width-8,height-8);
    ctx.fillStyle='#f7f9fc';ctx.font='48px sans-serif';ctx.fillText('Image preview / complete frame',40,80);
    ctx.fillStyle='#6abbad';ctx.fillRect(width-100,height-100,80,80);
    return canvas.toDataURL('image/png').split(',')[1];
  },{width,height});
  await page.getByRole('button',{name:'更多输入操作'}).click();
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'添加图片',exact:true}).click();
  await (await chooser).setFiles({name,mimeType:'image/png',buffer:Buffer.from(encoded,'base64')});
  await expect(page.getByLabel('草稿图片')).toContainText(name);
}

async function expectFits(page:Page){
  const dialog=page.getByRole('dialog',{name:'图片预览',exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'关闭预览'})).toBeInViewport({ratio:1});
  const geometry=await dialog.evaluate(element=>{
    const stage=element.querySelector('.image-preview-stage')!;
    const img=element.querySelector('img')!;
    const r=element.getBoundingClientRect(),s=stage.getBoundingClientRect();
    const scale=Math.min(s.width/img.naturalWidth,s.height/img.naturalHeight);
    return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,
      stageWidth:s.width,stageHeight:s.height,fit:getComputedStyle(img).objectFit,
      renderedWidth:img.naturalWidth*scale,renderedHeight:img.naturalHeight*scale,
      scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight};
  });
  expect(geometry.x).toBeGreaterThanOrEqual(0);expect(geometry.y).toBeGreaterThanOrEqual(0);
  expect(geometry.x+geometry.width).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.y+geometry.height).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.width).toBeGreaterThan(geometry.viewportWidth-32);
  expect(geometry.fit).toBe('contain');
  expect(geometry.renderedWidth).toBeLessThanOrEqual(geometry.stageWidth+1);
  expect(geometry.renderedHeight).toBeLessThanOrEqual(geometry.stageHeight+1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  return geometry;
}

test('preview expands landscape images and adapts while open in narrow and short windows',async({},testInfo)=>{
  const {context,page,site,forbidden}=await setup();
  try{
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();
    await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    await addImage(page,'landscape.png',1920,1080);
    await page.setViewportSize({width:993,height:861});
    const opener=page.getByRole('button',{name:'预览图片 landscape.png',exact:true});
    await opener.click();
    const wide=await expectFits(page);
    expect(wide.renderedWidth).toBeGreaterThan(900);
    await page.screenshot({path:testInfo.outputPath('preview-wide.png')});
    for(const [width,height,name] of [[280,700,'narrow'],[900,400,'short']] as const){
      await page.setViewportSize({width,height});await expectFits(page);
      await page.screenshot({path:testInfo.outputPath(`preview-${name}.png`)});
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog',{name:'图片预览',exact:true})).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();await expectFits(page);
    await page.getByRole('button',{name:'关闭预览',exact:true}).click();
    await expect(opener).toBeFocused();
    expect(forbidden).toEqual([]);
  }finally{await context.close();}
});

test('portrait image and long filename leave the full frame and close control reachable',async({},testInfo)=>{
  const {context,page,site}=await setup();
  try{
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();
    await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    const name='portrait-with-a-long-filename-for-reading-image-metadata.png';
    await addImage(page,name,900,1600);
    await page.setViewportSize({width:280,height:700});
    await page.getByRole('button',{name:`预览图片 ${name}`,exact:true}).click();
    const portrait=await expectFits(page);
    expect(portrait.renderedHeight).toBeGreaterThan(portrait.renderedWidth);
    await page.screenshot({path:testInfo.outputPath('preview-portrait.png')});
    await page.getByRole('button',{name:'关闭预览',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'图片预览',exact:true})).toHaveCount(0);
  }finally{await context.close();}
});
