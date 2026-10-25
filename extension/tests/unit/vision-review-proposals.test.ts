import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {parseReview,reviewRequest} from '../../src/generation/vision-review';
import {reviewVisualEvidence} from '../../src/generation/vision-reviewing';
import {allocateVisualPlan} from '../../src/generation/visual-selection';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import type {EvidencePlan} from '../../src/contracts/vision';
import type {Attachment} from '../../src/contracts/attachment';
import {png} from '../fixtures/png';
import {validateVisionReview,visionReviewSchema} from '../../src/contracts/vision';

const captured=JSON.parse(readFileSync(new URL('../fixtures/review-excess-proposals.json',import.meta.url),'utf8'));
const corrected=JSON.parse(readFileSync(new URL('../fixtures/review-excess-proposals-corrected.json',import.meta.url),'utf8'));
const snapshot={snapshotId:'review-replay',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'快速总结',outputType:'chat',modelId:'fixture',webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[],visionReview:2} as unknown as ChatRequestSnapshot;
function fixture(){
  const cues=Array.from({length:Math.max(...captured.nearbySubtitles.map((c:any)=>c.cueId))+1},()=>({from:0,to:.001,content:'未提供的字幕，不参与核验'}));
  for(const {cueId,...cue} of captured.nearbySubtitles)cues[cueId]=cue;
  const plan:EvidencePlan={version:2,scope:'focused',needsNewFrames:true,unresolved:[],evidence:captured.targets.map((t:any)=>({id:t.evidenceId,need:t.need,priority:t.evidenceId==='e6'?'optional':'required',mode:t.mode,detailNeed:t.detailNeed,readTargets:t.readTargets,checkTargets:t.checks.map((c:any)=>c.need),reason:'自制合成回归记录',reuseAttachmentIds:[],windows:t.slots.map((s:any)=>({...s.window,cueIds:captured.nearbySubtitles.filter((c:any)=>c.from<=s.window.to&&c.to>=s.window.from).slice(0,8).map((c:any)=>c.cueId),basis:'subtitle'}))}))};
  const audit=allocateVisualPlan(plan,snapshot,[],'字幕','快速总结');
  const images:Attachment[]=captured.images.map((i:any,index:number)=>({id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,time:i.time,dataUrl:png(),width:2,height:2,bytes:100}));
  audit.frames=captured.images.map((i:any,index:number)=>({slotKey:i.slotKey,attachmentId:images[index].id,time:i.time,detail:audit.slots.find(s=>s.key===i.slotKey)!.detail}));
  const request=reviewRequest(snapshot,plan,audit,images,cues,captured.duration,{});
  const parse=(wire:any)=>parseReview(JSON.stringify(wire),request,plan,audit,captured.duration,cues,[]);
  return {plan,audit,request,cues,parse,wire:structuredClone(captured.initial)};
}

test('synthetic review retains checked findings when three suggestions include an optional and an identical original frame',()=>{
  const f=fixture();expect(f.request.targets).toEqual(captured.targets);
  const out=f.parse(f.wire);
  expect(out.status).toBe('complete');
  expect(out.results).toHaveLength(5);
  expect(out.results.find(r=>r.evidenceId==='e1')?.checks?.map(c=>c.status)).toEqual(['confirmed','confirmed','uncertain']);
  expect(out.repairs.map(r=>r.slotKey)).toEqual(['e1_0']);
});

test.each(['e1','e2','e6'])('synthetic review is otherwise valid when only %s suggestion is removed',id=>{
  const f=fixture();f.wire.results.find((r:any)=>r.evidenceId===id).refinements=[];
  expect(f.parse(f.wire).status).toBe('complete');
});

test('the synthetic second response also retains all 13 checks and the original gaps',()=>{
  const f=fixture(),out=f.parse(corrected);
  expect(out.status).toBe('complete');expect(out.results.flatMap(r=>r.checks??[])).toHaveLength(13);
  expect(out.repairs.map(r=>r.slotKey)).toEqual(['e1_0']);
  expect(out.results.find(r=>r.evidenceId==='e6')).toMatchObject({status:'partial',checks:[{status:'not-visible'},{status:'not-visible'},{status:'confirmed'}]});
  expect(out.refinementNotes).toEqual(expect.arrayContaining([expect.stringContaining('原图已保留清晰细节'),expect.stringContaining('补充项缺口')]));
  expect(()=>visionReviewSchema.parse(out)).not.toThrow();
  expect(()=>validateVisionReview(out,f.plan,f.audit,captured.duration,[],f.cues.length)).not.toThrow();
});

test('three useful proposals are capped locally in plan order, not model response order',()=>{
  const f=fixture();f.plan.evidence.find(e=>e.id==='e6')!.priority='required';
  f.audit.slots.find(s=>s.key==='e2_0')!.detail='low';f.audit.frames.find(s=>s.slotKey==='e2_0')!.detail='low';
  f.wire.results.reverse();const out=f.parse(f.wire);
  expect(out.status).toBe('complete');expect(out.repairs.map(r=>r.slotKey)).toEqual(['e1_0','e2_0']);
  expect(out.results.find(r=>r.evidenceId==='e6')?.checks?.[0].status).toBe('unreadable');
  expect(out.refinementNotes?.join('')).toContain('最多2个');
});

test.each(['subtitle','check','image','duplicate-slot'])('an invalid %s is rejected even in a proposal that would be skipped',kind=>{
  const f=fixture(),r=f.wire.results.find((r:any)=>r.evidenceId==='e6');
  if(kind==='subtitle')r.refinements[0].cueIds=[0];
  if(kind==='check')r.refinements[0].checkIds=['c2'];
  if(kind==='image')r.checks[0].imageRefs=['i0'];
  if(kind==='duplicate-slot')r.refinements[0].slotKey='e1_0';
  expect(f.parse(f.wire)).toMatchObject({status:'failed',failure:'references',results:[],repairs:[]});
  expect(f.request.review).toMatchObject({status:'checking',results:[],repairs:[]});
});

test('replaying the synthetic provider response needs no correction request and does not consume paid calls',async()=>{
  const f=fixture();let calls=0;const invalid:string[]=[];
  const result=await reviewVisualEvidence({provider:{async stream(_model,_messages,_signal,delta){calls++;if(calls>1)throw Error('unexpected correction');await delta(JSON.stringify(f.wire));}},modelId:'offline-replay',request:f.request,plan:f.plan,audit:f.audit,duration:captured.duration,cues:f.cues,imageIds:[],signal:new AbortController().signal,tokenAllowance:200000,onInvalid:async output=>{invalid.push(output);}});
  expect(calls).toBe(1);expect(invalid).toEqual([]);
  expect(result.review).toMatchObject({status:'complete',repairs:[{slotKey:'e1_0',state:'pending'}]});
  expect(result.review.correction).toBeUndefined();
});
