import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import {createEvidencePreparation,fallbackEvidencePreparation} from '../../src/generation/evidence-preparation';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {segmentSubtitles,subtitleBasis} from '../../src/generation/subtitle-context';
import {createWebEvidencePort} from '../../src/generation/web-evidence-port';
import {webOptions} from '../../src/contracts/web';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {searchReply,webTransport} from '../fixtures/web';

const source={platform:'bilibili' as const,videoId:'BVpermission',partId:'1',title:'四分钟视频'};
const binding={...source,tabId:1,documentId:'doc',epoch:1};
const plan={version:1 as const,interpretedIntent:'用户要求核实',additionalSources:[{source:'web' as const,reason:'模型选择网页'}],outputRequirements:[]};
const context={request:'是真的吗',modelId:'fixture',outputType:'chat' as const,hasFullSubtitles:true,hasConversationHistory:false,canUseWeb:true,requiredSources:['web' as const],explicitSources:[]};
test('model and template cannot enable web while the conversation permission is off, including fallback',async()=>{
  const transport:typeof fetch=async input=>String(input).includes('api.bilibili.com')?Response.json({code:0,data:{aid:1,desc:''}}):new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{content:JSON.stringify(plan)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  for(const preparation of [createEvidencePreparation({read:async()=>({key:'SYNTHETIC_PERMISSION_KEY'}),write:async()=>{}},transport),fallbackEvidencePreparation]){
    const off=await preparation.prepare({source,context});
    expect(off.includedSources).not.toContain('web');
    expect(off.unavailableSources).toContain('web');
    const on=await preparation.prepare({source,context:{...context,explicitSources:['web']}});
    expect(on.includedSources).toContain('web');
  }
});
test('freezing cannot promote a model source selection into conversation web consent',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),jobs=new IndexedGenerationStore(name),space=await spaces.open(source);
  await spaces.save(space.id,0,{...space.draft,text:'核实',modelId:'fixture',webEnabled:false},space.chatId);
  const evidence={version:1 as const,planningMode:'planned' as const,plan,includedSources:['web' as const],unavailableSources:[]};
  const job=await jobs.freezeChat({kind:'chat',workspaceId:space.id,chatId:space.chatId},1,await subtitleBasis(binding,'zh',[{from:67.8,to:69.5,content:'视频原话'}],{mediaDuration:252}),false,false,evidence);
  expect(job.snapshot).toMatchObject({webEnabled:false});
  expect('web' in job.snapshot).toBe(false);
  expect((job.snapshot as any).evidence.includedSources).not.toContain('web');
  expect(job.snapshot).toMatchObject({mediaDuration:252});
  const file=await new IndexedBackupStore(name).export(),restored=crypto.randomUUID(),backup=new IndexedBackupStore(restored),preview=await backup.preview(file);
  await backup.execute(preview.planId,preview.checksum);
  expect((await new IndexedGenerationStore(restored).get(job.jobId))?.snapshot).toMatchObject({webEnabled:false,mediaDuration:252});
});
test('subtitle context makes decimal seconds unambiguous and retains the actual media bound',async()=>{
  const cues=[{from:67.8,to:69.5,content:'视频原话'}];
  const text=segmentSubtitles(cues)[0].text;
  expect(text).toContain('startSeconds=67.8');
  expect(text).toContain('[01:07–01:09](vcamp-time:67.8)');
  expect(text).toContain('endSeconds=69.5');
  expect(await subtitleBasis(binding,'zh',cues,{mediaDuration:252})).toMatchObject({mediaDuration:252});
  await expect(subtitleBasis(binding,'zh',[{from:4068,to:4074,content:'错误时间'}],{mediaDuration:252})).rejects.toMatchObject({code:'source-changed'});
});
test('direct search accepts nullable optional metadata and needs no post-search model summary',async()=>{
  const reply={results:[{url:'https://example.test/source',title:null,summary:null,snippet:'已完成搜索的网页摘录'}]};
  let calls=0;
  const result=await createWebEvidencePort('SYNTHETIC_NATIVE_KEY',webTransport(()=>{calls++;return Response.json(reply);})).retrieve({options:webOptions(),question:'核实版权'},new AbortController().signal);
  expect(calls).toBe(1);expect(result.evidence.sources).toHaveLength(1);
  expect(result.material).toContain('已完成搜索');expect(result.material).not.toContain('internal');
});

test('search diagnostics identify structural failure without leaking response text, and reporting cannot discard success',async()=>{
  const diagnostics:any[]=[];
  const malformed={results:[{url:42,summary:'PRIVATE_RESPONSE'}]};
  await expect(createWebEvidencePort('SYNTHETIC_NATIVE_KEY',webTransport(()=>Response.json(malformed)),async d=>{diagnostics.push(d);}).retrieve({options:webOptions(),question:'核实'},new AbortController().signal)).rejects.toMatchObject({code:'web-protocol'});
  expect(diagnostics).toEqual([expect.objectContaining({webStage:'envelope',webInvalidFields:['results','url']})]);
  expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_RESPONSE|SYNTHETIC_NATIVE_KEY/);
  const complete=searchReply();
  const input={options:webOptions(),question:'核实'};
  await expect(createWebEvidencePort('SYNTHETIC_NATIVE_KEY',webTransport(()=>Response.json(complete)),async()=>{throw new Error('storage unavailable');}).retrieve(input,new AbortController().signal)).resolves.toMatchObject({evidence:{executionLinked:true}});
  await expect(createWebEvidencePort('SYNTHETIC_NATIVE_KEY',webTransport(()=>Response.json({results:[]}))).retrieve(input,new AbortController().signal)).rejects.toMatchObject({code:'web-no-sources'});
});
