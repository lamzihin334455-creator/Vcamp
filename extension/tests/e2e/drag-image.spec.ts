import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';
import {png} from '../fixtures/png';

test('dropping a local image adds it to the current draft with its filename',async()=>{
  const {context,page,site}=await setup();
  try{
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();
    await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    const current=(await command({type:'workspace.query'})).view;
    const encoded=png().slice(png().indexOf(',')+1);
    await page.getByLabel('输入区').evaluate((element,encoded)=>{
      const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
      const transfer=new DataTransfer();transfer.items.add(new File([bytes],'diagram.png',{type:'image/png'}));
      element.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:transfer}));
      element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    },encoded);
    await expect(page.getByLabel('草稿图片')).toContainText('diagram.png');
    const saved=(await command({type:'workspace.query'})).view;
    expect(saved.draft.attachmentIds).toHaveLength(1);
    expect(saved.draft.attachments[0]).toMatchObject({name:'diagram.png',mimeType:'image/png',workspaceId:current.workspaceId,chatId:current.chatId});
    const attachments=await command({type:'attachment.read',target:{workspaceId:current.workspaceId,chatId:current.chatId},ids:saved.draft.attachmentIds});
    expect(attachments.view.attachment.images[0]).toMatchObject({uploadName:'diagram.png',width:2,height:2});
  }finally{await context.close();}
});

test('the plus menu adds local images and pasted images as removable thumbnails',async()=>{
  const {context,page,site}=await setup();
  try{
    await page.reload();await site.bringToFront();
    await page.getByRole('button',{name:'切换当前内容'}).click();
    await page.getByRole('menuitem',{name:'新对话',exact:true}).click();
    const encoded=png().slice(png().indexOf(',')+1);
    await page.getByRole('button',{name:'更多输入操作'}).click();
    const chooser=page.waitForEvent('filechooser');
    await page.getByRole('button',{name:'添加图片',exact:true}).click();
    await (await chooser).setFiles({name:'local-image.png',mimeType:'image/png',buffer:Buffer.from(encoded,'base64')});
    await expect(page.getByLabel('草稿图片')).toContainText('local-image.png');

    await page.getByLabel('输入草稿').evaluate((element,encoded)=>{
      const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
      const transfer=new DataTransfer();transfer.items.add(new File([bytes],'pasted-image.png',{type:'image/png'}));
      element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));
    },encoded);
    await expect(page.getByLabel('草稿图片')).toContainText('pasted-image.png');
    await expect(page.getByRole('button',{name:'移除图片 pasted-image.png'})).toBeVisible();
    await page.getByRole('button',{name:'移除图片 pasted-image.png'}).click();
    await expect(page.getByRole('button',{name:'移除图片 pasted-image.png'})).toHaveCount(0);
    await page.getByRole('button',{name:'移除图片 local-image.png'}).click();
    await expect(page.getByLabel('草稿图片')).toHaveCount(0);
    await page.getByRole('button',{name:'更多输入操作'}).click();
    await page.getByRole('button',{name:'截取当前画面',exact:true}).click();
    await expect(page.getByLabel('草稿图片')).toBeVisible();
    await expect(page.getByLabel('输入区')).not.toContainText('图片未添加');
    await expect(page.getByLabel('输入区')).not.toContainText('图片超限');
  }finally{await context.close();}
});
