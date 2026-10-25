import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {createProviderPort} from '../../src/generation/provider-port';
import {runChat,prepareChatContext} from '../../src/generation/run-chat';
import {planningSubtitle,allocateVisualPlan} from '../../src/generation/visual-selection';
import {subtitleBasis} from '../../src/generation/subtitle-context';
import {createWebEvidencePort} from '../../src/generation/web-evidence-port';
import {webOptions} from '../../src/contracts/web';

const source={platform:'bilibili' as const,videoId:'BVlong',partId:'1',title:'24小时字幕输入'};
const binding={...source,tabId:1,documentId:'long-doc',epoch:1};
const snapshot:ChatRequestSnapshot={snapshotId:'fixture',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'解释视频最后的结论',outputType:'chat',modelId:'fixture',webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[],mediaDuration:86400};
const cues=Array.from({length:20001},(_,i)=>({from:i*4+.125,to:i*4+3.5,content:`第${i}段。`}));
const reply=()=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'依据完整字幕回答'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});

test('a full 24-hour timeline reaches the actual chat POST, including every cue and precise tail timestamps',async()=>{
 let calls=0,delivered='';
 const transport:typeof fetch=async(_url,init)=>{
  calls++;const body=JSON.parse(init!.body as string),context=JSON.parse(body.messages[1].content.split('\n').slice(1).join('\n'));
  delivered=context.subtitle.content;
  expect(context.datasetManifest.sources.find((s:any)=>s.source==='full_subtitles')).toMatchObject({delivery:'complete'});
  return reply();
 };
 let coverage:any;
 await runChat(snapshot,cues,createProviderPort('SYNTHETIC_LONG_CONTEXT_KEY',transport),new AbortController().signal,async(_text,next)=>{coverage=structuredClone(next);});
 expect(calls).toBe(1);expect([...delivered.matchAll(/第(\d+)段。/g)].map(m=>Number(m[1]))).toEqual(cues.map((_,i)=>i));
 expect(delivered).toContain('80000.125');expect(delivered).toContain('80003.5');
 expect(coverage.total).toBeGreaterThan(16);expect(coverage.covered).toBe(coverage.total);expect(coverage.ranges.at(-1).lastCue).toBe(20000);
});

test('long-video basis, execution checkpoints and completion use the same expanded coverage contract',async()=>{
 const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),jobs=new IndexedGenerationStore(name),space=await spaces.open(source);
 await spaces.save(space.id,0,{...space.draft,text:snapshot.input,modelId:'fixture'},space.chatId);
 const basis=await subtitleBasis(binding,'zh',cues,{mediaDuration:86400});
 const job=await jobs.freezeChat({kind:'chat',workspaceId:space.id,chatId:space.chatId},1,basis,false);
 const attemptId=job.attempts[0].attemptId;await jobs.attach(job.jobId,attemptId,12);
 const claimed=(await jobs.claim(job.jobId,attemptId,12))!;let seq=claimed.seq;
 await runChat(job.snapshot as ChatRequestSnapshot,cues,createProviderPort('SYNTHETIC_LONG_CONTEXT_KEY',async()=>reply()),new AbortController().signal,async(text,coverage)=>{await jobs.checkpoint(job.jobId,attemptId,++seq,text,coverage);});
 await jobs.finish(job.jobId,attemptId,'completed',null,'long-context-receipt');
 const completed=(await jobs.get(job.jobId))!;
 expect(completed.attempts[0].state).toBe('completed');expect(completed.attempts[0].coverage.total).toBeGreaterThan(16);
 expect(JSON.stringify(completed)).not.toContain('第20000段');
 const restored=crypto.randomUUID(),backup=new IndexedBackupStore(restored),preview=await backup.preview(await new IndexedBackupStore(name).export());
 await backup.execute(preview.planId,preview.checksum);
 expect((await new IndexedGenerationStore(restored).get(job.jobId))?.basis.cueCount).toBe(20001);
});

test('long subtitles also fit planning and reserve the complete final context without losing cue IDs',async()=>{
 const prepared=await prepareChatContext(snapshot,cues,{async stream(){throw Error('no summaries');}},new AbortController().signal,async()=>{});
 const planning=planningSubtitle(cues);
 expect([...planning.matchAll(/第(\d+)段。/g)].map(m=>Number(m[1]))).toEqual(cues.map((_,i)=>i));
 expect(planning).toContain('80000.125');expect(planning).toContain('cueId');
 expect(()=>allocateVisualPlan({version:2,scope:'focused',needsNewFrames:false,evidence:[],unresolved:[]},snapshot,[],planning,prepared.context)).not.toThrow();
});

test('the larger request budget accepts its inclusive boundary and still refuses oversized input before POST',async()=>{
 let calls=0;const provider=createProviderPort('SYNTHETIC_LONG_CONTEXT_KEY',async()=>{calls++;return reply();});
 await provider.stream('fixture',[{role:'user',content:'x'.repeat(1000000)}],new AbortController().signal,async()=>{});
 expect(calls).toBe(1);
 await expect(provider.stream('fixture',[{role:'user',content:'x'.repeat(1000001)}],new AbortController().signal,async()=>{})).rejects.toMatchObject({code:'context-limit'});
 expect(calls).toBe(1);
});

test('web query preparation accepts every long-video segment and the original subtitle tail',async()=>{
 const prepared=await prepareChatContext(snapshot,cues,{async stream(){throw Error('no summaries');}},new AbortController().signal,async()=>{});
 let calls=0;
 const transport:typeof fetch=async(url,init)=>{
  calls++;
  if(String(url).endsWith('/v1/tools/search'))return Response.json({results:[{url:'https://example.test/long',title:'长视频相关资料',snippet:'受控检索结果'}]});
  const body=JSON.parse(init!.body as string);
  expect(body.messages[1].content).toContain('第20000段。');
  expect(body.messages[1].content).toContain(`"totalSegments":${prepared.coverage.total}`);
  return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:JSON.stringify({query:'视频末尾主题'})},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 };
 const result=await createWebEvidencePort('SYNTHETIC_LONG_CONTEXT_KEY',transport).retrieve({options:webOptions(),question:snapshot.input,videoContext:{kind:'full-subtitles',text:prepared.context,totalSegments:prepared.coverage.total,coveredSegments:prepared.coverage.total}},new AbortController().signal);
 expect(calls).toBe(2);expect(result.evidence.status).toBe('retrieved');
});
