import {afterEach,expect,test,vi} from 'vitest';
import {inspectMedia} from '../../src/video/page';

afterEach(()=>vi.unstubAllGlobals());

function fixture(){
  // Playback identity minimized from BV1Vtnn6TEd2 after an idle -> navigation.
  // Bilibili can keep assigning this peer CDN across page refreshes.
  const bvid='BV1Vtnn6TEd2',cid=42867427437;
  const path=`/upgcxcode/37/74/${cid}/${cid}-1-100026.m4s`;
  const model={decodedHost:'mv0bw83m.edge.mountaintoys.cn:4483',path,proofPath:path,proofHost:'upos-sz-mirrorcos.bilivideo.com',proof:true,audioOnly:false};
  const video={readyState:4,currentSrc:'blob:synthetic-decoder',currentTime:0,duration:30,paused:true};
  const location={href:`https://www.bilibili.com/video/${bvid}/`};
  const data=()=>({code:0,data:{dash:model.audioOnly?{audio:[{baseUrl:`https://${model.proofHost}${model.proofPath}`}]}:{video:[{baseUrl:`https://${model.proofHost}${model.proofPath}`}]}}});
  vi.stubGlobal('location',location);
  vi.stubGlobal('document',{querySelector:()=>video,get scripts(){return model.proof?[{textContent:'window.__playinfo__='+JSON.stringify(data())}]:[];}});
  vi.stubGlobal('window',{__INITIAL_STATE__:{videoData:{bvid,title:'peer delivery fixture',pages:[{page:1,cid,part:'P1'}]}},player:{getManifest:()=>({bvid,cid}),mediaElement:()=>video,getMediaInfo:()=>({playUrl:`https://${model.decodedHost}${model.path}`})}});
  vi.stubGlobal('performance',{getEntriesByType:(type:string)=>type==='navigation'?[{name:location.href}]:[]});
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  return {model,video,fetch,bvid,cid};
}

test('a verified Bilibili video delivered through the observed peer CDN can bind across refreshes',async()=>{
  const f=fixture();
  expect(await inspectMedia()).toMatchObject({status:'supported',source:{videoId:f.bvid,partId:String(f.cid)}});
  delete (window as unknown as {__vcampMediaPaths?:unknown}).__vcampMediaPaths;
  expect(await inspectMedia()).toMatchObject({status:'supported',source:{videoId:f.bvid,partId:String(f.cid)}});
  expect(f.fetch).not.toHaveBeenCalled();
});

test('the peer URL advertised in inline video responses also supports mcdn delivery',async()=>{
  const f=fixture();
  f.model.decodedHost='xy42x101x58x183xy.mcdn.bilivideo.cn:4483';
  f.model.proofHost=f.model.decodedHost;
  f.model.path='/v1/resource'+f.model.path;f.model.proofPath=f.model.path;
  expect(await inspectMedia()).toMatchObject({status:'supported',source:{videoId:f.bvid,partId:String(f.cid)}});
});

test.each(['missing-proof','wrong-file','audio-only','lookalike-host','untrusted-host'])('peer delivery still rejects %s',async kind=>{
  const f=fixture();
  if(kind==='missing-proof')f.model.proof=false;
  if(kind==='wrong-file')f.model.proofPath='/another-video.m4s';
  if(kind==='audio-only')f.model.audioOnly=true;
  if(kind==='lookalike-host')f.model.decodedHost='peer.edge.mountaintoys.cn.evil.test';
  if(kind==='untrusted-host')f.model.decodedHost='peer.evil.test';
  expect(await inspectMedia()).toMatchObject({status:'loading'});
});
