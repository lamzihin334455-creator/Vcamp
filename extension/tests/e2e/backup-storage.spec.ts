import {expect,test,type BrowserContext,type Page} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {setup} from './interaction-fixture';

// Local replay is opt-in; never add the user's backup contents to fixtures or traces.
test.use({trace:'off'});
const cover=(context:BrowserContext)=>context.route('https://i0.hdslb.com/bfs/archive/fixture.png',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#687fc1"/></svg>'}));
async function storage(page:Page){await page.getByRole('navigation').getByRole('button',{name:'资料库',exact:true}).click();await page.getByRole('button',{name:'存储管理',exact:true}).click();}
const counts=(page:Page)=>page.evaluate(async()=>new Promise<Record<string,number>>((resolve,reject)=>{const open=indexedDB.open('vcamp',10);open.onerror=()=>reject(new Error('count-open'));open.onsuccess=()=>{const db=open.result,tables=Array.from(db.objectStoreNames),tx=db.transaction(tables,'readonly'),result:Record<string,number>={};for(const table of tables){const get=tx.objectStore(table).count();get.onsuccess=()=>{result[table]=get.result;};}tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(new Error('count-abort'));};};}));
async function expectedCounts(path:string){
  if(!path.endsWith('.vcamp')){const payload=JSON.parse(await readFile(path,'utf8')).payload;return Object.fromEntries(Object.entries(payload).map(([key,value])=>[key,(value as unknown[]).length]));}
  const result:Record<string,number>={},lines=createInterface({input:createReadStream(path),crlfDelay:Infinity});let first=true;
  try{for await(const line of lines){if(first){const manifest=JSON.parse(line);for(const table of manifest.types)result[table]=0;first=false;continue;}const entry=JSON.parse(line);if(!Object.hasOwn(result,entry[0]))throw new Error();result[entry[0]]++;}}
  catch{throw new Error('Private backup record-count check failed');}return result;
}
test('a locally exported backup opens a restore preview in a separate browser profile',async()=>{
  test.skip(!process.env.VCAMP_BACKUP_FILE,'Set VCAMP_BACKUP_FILE for a private local replay');
  test.setTimeout(120000);
  const {context,page,forbidden}=await setup();
  try{
    await cover(context);await storage(page);const before=await counts(page);
    await page.getByLabel('选择备份文件',{exact:true}).setInputFiles(process.env.VCAMP_BACKUP_FILE!);
    await page.locator('[aria-label="导入概览"], [role="alert"]').first().waitFor({state:'visible',timeout:90000});
    await expect(page.getByLabel('导入概览')).toBeVisible({timeout:1000});
    await page.getByRole('button',{name:'确认恢复备份',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'备份恢复完成'})).toBeVisible({timeout:60000});
    const expected=await expectedCounts(process.env.VCAMP_BACKUP_FILE!),after=await counts(page);
    for(const table of ['attachments','workspaces','jobs','artifacts','noteRevisions','subtitleVersions','scribbles','folders','favorites'])expect(after[table],table).toBeGreaterThanOrEqual(Math.max(expected[table],before[table]));
    expect(forbidden.length).toBe(0);
  }finally{await context.close();}
});

test('storage separates cleanup above backup and a downloaded builtin-style backup restores in a second profile',async()=>{
  test.setTimeout(90000);
  const first=await setup();let second:Awaited<ReturnType<typeof setup>>|undefined;
  try{
    await cover(first.context);const page=first.page;
    await page.getByRole('button',{name:/^产物类型：/}).click();await page.getByRole('menuitemradio',{name:'HTML 页面',exact:true}).click();await page.getByRole('button',{name:'HTML 风格：默认',exact:true}).click();await page.getByRole('menuitemradio',{name:'新拟态',exact:true}).click();
    await storage(page);const panel=page.getByRole('region',{name:'存储管理',exact:true}),cleanup=page.getByRole('region',{name:'清理缓存',exact:true}),backup=page.getByRole('region',{name:'备份与恢复',exact:true});
    expect((await cleanup.boundingBox())!.y).toBeLessThan((await backup.boundingBox())!.y);
    await expect(panel).not.toContainText('导出已保存的对话');await expect(panel).not.toContainText('仅手动清理可重建缓存');await expect(panel).not.toContainText('目前没有可清理的临时缓存');
    for(const width of [280,400,720]){await page.setViewportSize({width,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    await page.setViewportSize({width:400,height:850});await expect(page.getByTestId('startup')).toHaveCount(0);await page.screenshot({path:test.info().outputPath('storage-clean.png')});
    await page.getByRole('button',{name:'计算清理预览',exact:true}).click();await expect(cleanup.getByRole('status')).toContainText('预计释放');
    const downloadDir=test.info().outputPath('downloads');await mkdir(downloadDir,{recursive:true});const downloadSession=await first.context.newCDPSession(page);await downloadSession.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir,eventsEnabled:true});
    const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'下载资料备份',exact:true}).click();const download=await downloading,filepath=join(downloadDir,download.suggestedFilename());await expect.poll(()=>readFile(filepath,'utf8').then(()=>true,()=>false)).toBe(true);
    second=await setup();await cover(second.context);await storage(second.page);
    await second.page.getByLabel('选择备份文件',{exact:true}).setInputFiles(filepath);await expect(second.page.getByLabel('导入概览')).toBeVisible();await expect(second.page.getByRole('button',{name:'确认恢复备份',exact:true})).toBeVisible();
    await second.page.screenshot({path:test.info().outputPath('restore-preview.png')});await second.page.getByRole('button',{name:'确认恢复备份',exact:true}).click();await expect(second.page.getByRole('status').filter({hasText:'备份恢复完成'})).toContainText('偏好已恢复');
    const selected=await second.page.evaluate(async()=>{const prefs=await chrome.storage.local.get('vcamp.htmlStyle');const result=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'style.query',selected:prefs['vcamp.htmlStyle']}});return result.view.styles.revisions[0].name;});expect(selected).toBe('新拟态');
    expect(download.suggestedFilename()).toMatch(/\.vcamp$/);
    const text=await readFile(filepath,'utf8'),end=text.indexOf('\n'),packet=JSON.parse(text.slice(0,end));packet.checksum='0'.repeat(64);
    await second.page.getByLabel('选择备份文件',{exact:true}).setInputFiles({name:'damaged-backup.vcamp',mimeType:'application/octet-stream',buffer:Buffer.from(JSON.stringify(packet)+text.slice(end))});await expect(second.page.getByRole('alert')).toContainText('无法导入');await expect(second.page.getByRole('button',{name:'确认恢复备份',exact:true})).toHaveCount(0);
    expect(first.forbidden).toEqual([]);expect(second.forbidden).toEqual([]);
  }finally{await second?.context.close();await first.context.close();}
});

test('a real download larger than 64 MiB restores all Unicode records in another extension profile',async()=>{
  test.setTimeout(180000);
  const first=await setup();let second:Awaited<ReturnType<typeof setup>>|undefined;
  try{
    await cover(first.context);
    await first.page.evaluate(async()=>{
      const result=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'workspace.query'}}),workspaceId=result.view.workspaceId;
      if(!workspaceId)throw new Error('synthetic workspace missing');
      await new Promise<void>((resolve,reject)=>{const open=indexedDB.open('vcamp',10);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('scribbles','readwrite'),text='合成资料🌸'.repeat(16666);for(let i=0;i<330;i++)tx.objectStore('scribbles').put({id:`large-${i}`,workspaceId,text,time:i,revision:1});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
    });
    await storage(first.page);
    const directory=test.info().outputPath('large-download');await mkdir(directory,{recursive:true});
    const cdp=await first.context.newCDPSession(first.page);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory,eventsEnabled:true});
    const downloading=first.page.waitForEvent('download',{timeout:90000});await first.page.getByRole('button',{name:'下载资料备份',exact:true}).click();
    const download=await downloading,filepath=join(directory,download.suggestedFilename());await download.path();
    const {stat}=await import('node:fs/promises');expect((await stat(filepath)).size).toBeGreaterThan(64*1024*1024);
    second=await setup();await cover(second.context);await storage(second.page);
    await second.page.getByLabel('选择备份文件',{exact:true}).setInputFiles(filepath);await expect(second.page.getByLabel('导入概览')).toBeVisible({timeout:90000});
    const read=()=>second!.page.evaluate(async()=>new Promise<{count:number;intact:boolean}>((resolve,reject)=>{const open=indexedDB.open('vcamp',10);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('scribbles','readonly'),get=tx.objectStore('scribbles').getAll();tx.oncomplete=()=>{db.close();const rows=get.result.filter((row:{id:string})=>row.id.startsWith('large-'));resolve({count:rows.length,intact:rows.every((row:{text:string})=>row.text==='合成资料🌸'.repeat(16666))});};};}));
    expect((await read()).count).toBe(0);
    await second.page.getByRole('button',{name:'确认恢复备份',exact:true}).click();await expect(second.page.getByRole('status').filter({hasText:'备份恢复完成'})).toBeVisible({timeout:60000});
    expect(await read()).toEqual({count:330,intact:true});
    expect(first.forbidden).toEqual([]);expect(second.forbidden).toEqual([]);
  }finally{await second?.context.close();await first.context.close();}
});
