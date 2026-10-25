import {test,expect,chromium} from '@playwright/test';
import {navigationScript} from '../../src/html/navigation';

test('HTML visible video times and time buttons request navigation; code, clocks and anchors stay local',async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<iframe title="generated" sandbox="allow-scripts"></iframe>');
    await page.evaluate(script=>{
      (window as any).actions=[];
      window.addEventListener('message',e=>(window as any).actions.push(e.data));
      document.querySelector('iframe')!.srcdoc=`<!doctype html><html><head><script>${script}</script></head><body><p>视频 00:02</p><button data-time="3.25"><span>00:03</span></button><span class="timestamp">00:04</span><p>[00:05]</p><pre>[00:06]</pre><p>钟点 12:30，比率 4:3</p><a href="#section">00:07</a><h2 id="section">页内位置</h2><script>document.addEventListener('click',e=>e.stopImmediatePropagation());</script></body></html>`;
    },navigationScript('test-token'));
    const content=page.frameLocator('iframe');
    await content.getByRole('link',{name:'00:02',exact:true}).click({timeout:3000});
    await expect.poll(()=>page.evaluate(()=>(window as any).actions.at(-1))).toMatchObject({kind:'seek',time:2});
    await content.getByRole('button',{name:'00:03',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).actions.at(-1))).toMatchObject({kind:'seek',time:3.25});
    await content.getByRole('link',{name:'00:04',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).actions.at(-1))).toMatchObject({kind:'seek',time:4});
    await content.getByRole('link',{name:'00:05',exact:true}).evaluate((a:HTMLAnchorElement)=>a.click());
    expect(await page.evaluate(()=>(window as any).actions.length)).toBe(3);
    await content.getByRole('link',{name:'00:07',exact:true}).click();
    expect(await page.evaluate(()=>(window as any).actions.length)).toBe(3);
    await expect(content.locator('pre')).toHaveText('[00:06]');
    await expect(content.getByRole('link',{name:'12:30'})).toHaveCount(0);
  }finally{await browser.close();}
});
