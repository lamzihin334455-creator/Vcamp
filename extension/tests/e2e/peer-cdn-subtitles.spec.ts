import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

test('peer delivery after an idle worker restart binds, retries and survives refresh without affecting other videos',async()=>{
  const {context,page,site,worker}=await setup();
  const query=()=>page.evaluate(async()=>{
    const response=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'workspace.query'}});
    return response.ok?response.view.video:null;
  });
  try{
    const initial=await query();expect(initial.status).toBe('ready');
    // Simulate the extension worker being stopped while the player tab remains.
    // No product code or Chrome API is mocked. The next site event wakes it.
    const cdp=await context.newCDPSession(site),versions=new Map<string,any>();
    cdp.on('ServiceWorker.workerVersionUpdated',event=>{for(const version of event.versions)versions.set(version.versionId,version);});
    await cdp.send('ServiceWorker.enable');
    await expect.poll(()=>[...versions.values()].find(v=>v.scriptURL===worker.url())?.versionId).toBeTruthy();
    const versionId=[...versions.values()].find(v=>v.scriptURL===worker.url()).versionId;
    await cdp.send('ServiceWorker.stopWorker',{versionId});
    await cdp.detach();
    // Page inputs minimized from the supplied real target. It is a separate
    // media identity whose decoder was assigned to the observed peer domain.
    const configure=async()=>site.evaluate(()=>{
      const win=window as any,video=document.querySelector('video')!;
      const bvid=new URL(location.href).pathname.split('/')[2],cid=42867427437;
      win.__INITIAL_STATE__={videoData:{bvid,title:'Peer CDN video',pages:[{page:1,cid,part:'P1'}]}};
      win.player={getManifest:()=>({bvid,cid}),mediaElement:()=>video,getMediaInfo:()=>({playUrl:`https://mv0bw83m.edge.mountaintoys.cn:4483/upgcxcode/37/74/${cid}/${cid}-1-100026.m4s`})};
      const script=document.createElement('script');script.type='application/json';
      script.textContent='window.__playinfo__='+JSON.stringify({code:0,data:{dash:{video:[{baseUrl:`https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/37/74/${cid}/${cid}-1-100026.m4s`}]}}});
      document.head.append(script);
      return fetch(`https://api.bilibili.com/x/player/wbi/v2?cid=${cid}`);
    });
    await site.goto('https://www.bilibili.com/video/BV1Vtnn6TEd2/');
    await configure();
    await expect.poll(async()=>(await query())?.status).toBe('ready');
    const peer=await query();expect(peer.binding).toMatchObject({videoId:'BV1Vtnn6TEd2',partId:'42867427437'});
    const retry=await page.evaluate(async binding=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'video.retry',binding}}),peer.binding);
    expect(retry.ok).toBe(true);
    await page.reload();
    await expect.poll(async()=>(await query())?.status).toBe('ready');
    await site.reload();await configure();
    await expect.poll(async()=>(await query())?.binding?.partId).toBe('42867427437');
    await expect.poll(async()=>(await query())?.status).toBe('ready');
    await page.getByRole('navigation').getByRole('button',{name:'字幕',exact:true}).click();
    await expect(page.locator('.subtitle-row').first()).toBeVisible();
    await site.goto('https://www.bilibili.com/video/BVexperience/?p=1');
    await expect.poll(async()=>(await query())?.binding?.videoId).toBe('BVexperience');
    await expect.poll(async()=>(await query())?.status).toBe('ready');
  }finally{await context.close();}
});
