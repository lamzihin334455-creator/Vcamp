import {expect,test} from '@playwright/test';
import {setup} from './interaction-fixture';

test('background history updates during the same video do not restart completed subtitles',async()=>{
  const {context,page,site}=await setup();
  try{
    const query=()=>page.evaluate(async()=> (await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'workspace.query'}})).view.video);
    await expect.poll(async()=>(await query()).status).toBe('ready');
    const initial=await query();
    let metadataRequests=0;
    site.on('request',request=>{if(new URL(request.url()).pathname==='/x/player/wbi/v2')metadataRequests++;});
    // Sites may replace their history state without any user navigation.
    await site.evaluate(()=>history.replaceState({playerHeartbeat:1},'',location.href));
    await expect.poll(async()=>(await query()).status).toBe('ready');
    const after=await query();
    console.log('same-video background update',JSON.stringify({initial:initial.binding,after:after.binding,metadataRequests}));
    expect(after.binding,'a history-state heartbeat must not create a new video binding').toEqual(initial.binding);
    expect(metadataRequests,'completed subtitles must not be downloaded again').toBe(0);
    for(let index=0;index<40;index++){
      await site.evaluate(index=>history.replaceState({playerHeartbeat:index},'',`?p=1&t=${index}#reply`),index);
      expect(await query()).toMatchObject({status:'ready',binding:initial.binding,cues:initial.cues});
    }
    expect(metadataRequests).toBe(0);
    await site.evaluate(()=>history.replaceState({},'','?p=2'));
    await expect.poll(async()=>(await query()).binding?.partId).toBe('12');
    expect((await query()).binding.epoch).toBeGreaterThan(initial.binding.epoch);
  }finally{await context.close();}
});

test('a background preload does not displace an already verified blob decoder without legacy player APIs',async()=>{
  const {context,page,site}=await setup();
  try{
    await context.route('https://api.bilibili.com/x/player/wbi/playurl*',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{dash:{video:[{baseUrl:'https://upos-synthetic.bilivideo.com/current.m4s'}]}}})}));
    const query=()=>page.evaluate(async()=> {
      const response=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'workspace.query'}});
      return response.ok?response.view.video:{status:'query-error',code:response.code};
    });
    await site.evaluate(async()=>{
      const media=document.querySelector('video')!;
      const blob=await fetch(media.currentSrc).then(response=>response.blob());
      await new Promise<void>(resolve=>{media.addEventListener('loadedmetadata',()=>resolve(),{once:true});media.src=URL.createObjectURL(blob);});
      (window as any).player={};
      await fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BVexperience&cid=11');
    });
    await expect.poll(async()=>(await query()).status).toBe('ready');
    const initial=await query();
    let metadataRequests=0,proofRequests=0;
    site.on('request',request=>{const path=new URL(request.url()).pathname;if(path==='/x/player/wbi/v2')metadataRequests++;if(path==='/x/player/wbi/playurl')proofRequests++;});
    await site.evaluate(()=>fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BVpreload&cid=99'));
    for(let sample=0;sample<12;sample++)expect(await query()).toMatchObject({status:'ready',binding:initial.binding,cues:initial.cues});
    expect(metadataRequests).toBe(0);
    expect(proofRequests,'the preload itself is the only new playurl request').toBe(1);
    // A changed native decoder must not inherit the old decoder's proof, even
    // with the same selected URL and a background request for another video.
    await site.evaluate(async()=>{
      const media=document.querySelector('video')!;
      const blob=await fetch(media.currentSrc).then(response=>response.blob());
      await new Promise<void>(resolve=>{media.addEventListener('loadedmetadata',()=>resolve(),{once:true});media.src=URL.createObjectURL(blob);});
    });
    // A decoder change may occur between the router's two source checks. Retry
    // that rejected snapshot, as the panel does, before asserting the safe gap.
    await expect.poll(query).toMatchObject({status:'loading',binding:null,cues:[]});
    await site.evaluate(()=>fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BVexperience&cid=11'));
    await expect.poll(async()=>(await query()).status).toBe('ready');
    const recovered=await query();
    expect(recovered.binding.epoch).toBeGreaterThan(initial.binding.epoch);
    expect(recovered.cues).toEqual(initial.cues);
    expect(metadataRequests,'reverified same-video subtitles restore without downloading again').toBe(0);
  }finally{await context.close();}
});
