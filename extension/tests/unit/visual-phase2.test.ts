import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import type {Attachment} from '../../src/contracts/attachment';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import {validateVisionReview,visionStageSchema,type EvidencePlan,type VisionReview,type VisionStage} from '../../src/contracts/vision';
import {reviewRequest,parseReview,captureRefinements,canRefine} from '../../src/generation/vision-review';
import {captureEvidence} from '../../src/generation/capture-evidence';
import {allocateVisualPlan,frameBytes} from '../../src/generation/visual-selection';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedAttachmentStore} from '../../src/data/attachment-store';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {failureFeedback} from '../../src/workbench/failure-feedback';
import {jobView} from '../../src/contracts/generation';
import {png} from '../fixtures/png';
import {readFileSync} from 'node:fs';

const cues=[{from:1,to:10,content:'相关设置发生切换'}];
const snapshot:ChatRequestSnapshot={snapshotId:'fixture',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'核对设置文字',outputType:'chat',modelId:'fixture',mediaDuration:100,webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[],visionReview:1};
const window=(anchor:number)=>({from:anchor-1,to:anchor+1,anchor,cueIds:[0],basis:'subtitle' as const});
const plan=(pair=false):EvidencePlan=>({version:2,scope:'focused',needsNewFrames:true,evidence:[{id:'settings',need:'读取菜单和勾选状态',priority:'required',mode:pair?'pair':'single',reuseAttachmentIds:[],detailNeed:'read-text',readTargets:['菜单文字'],reason:'字幕只用于定位',windows:pair?[window(4),window(6)]:[window(4)]}],unresolved:[]});
const frame=(time:number)=>({time,dataUrl:png(),width:2,height:2});
function sample(p=plan(),s=snapshot){
  const audit=allocateVisualPlan(p,s,[],'字幕','字幕');
  const images:Attachment[]=audit.slots.map(slot=>({...frame(slot.anchor),id:crypto.randomUUID(),bytes:frameBytes(frame(slot.anchor)),mimeType:'image/png',sha256:'0'.repeat(64),createdAt:1,workspaceId:s.target.workspaceId,chatId:s.target.chatId,source:{platform:'bilibili',videoId:'BVtest',partId:'1'}}));
  audit.frames=images.map((i,index)=>({slotKey:audit.slots[index].key,attachmentId:i.id,time:i.time,detail:audit.slots[index].detail}));
  audit.budget.imageBytes=images.reduce((n,i)=>n+i.bytes,0);
  const request=reviewRequest(s,p,audit,images,cues,100,{request:s.input});
  const reply={version:1 as const,results:request.targets.map(t=>({evidenceId:t.evidenceId,status:'sufficient' as const,imageRefs:t.imageRefs,observations:['画面可见菜单与选中标记'],missing:'',refinements:[] as {slotKey:string;window:ReturnType<typeof window>}[]}))};
  return {p,s,audit,images,request,reply};
}
function partial(f:ReturnType<typeof sample>,anchor=5){
  const result={...f.reply.results[0],status:'unreadable' as const,observations:[],missing:'目标文字仍然模糊',refinements:[{slotKey:f.audit.slots[0].key,window:window(anchor)}]};
  return {version:1,results:[result]};
}
test('review sends deduplicated actual images and keeps subtitle hints separate from observations',()=>{
  const f=sample(),parts=f.request.messages[1].content as any[];
  expect(parts.filter(p=>p.type==='image_url')).toEqual([{type:'image_url',image_url:{url:png(),detail:'original'}}]);
  expect(f.request.review.images[0]).toMatchObject({ref:'i0',slotKey:'settings_0',time:4});
  expect(f.request.review.images[0]).not.toHaveProperty('attachmentId');
  expect(JSON.parse(parts[0].text)).toMatchObject({subtitlesAreExcerpt:true,nearbySubtitles:[{cueId:0}]});
  expect(parseReview(JSON.stringify(f.reply),f.request,f.p,f.audit,100,cues,[]).status).toBe('complete');
});
test('review rejects invented references, incomplete comparisons, unsupported statuses and ambiguous facts',()=>{
  const f=sample(plan(true));
  const mutations=[(r:any)=>r.results[0].imageRefs=['unknown'],(r:any)=>r.results[0].imageRefs=['i0'],(r:any)=>r.results[0].observations=[],(r:any)=>r.results[0].status='probably',
    (r:any)=>r.results[0].missing='仍未读清', (r:any)=>r.results.push(r.results[0]),(r:any)=>r.results[0].extra='no'];
  for(const change of mutations){const reply=structuredClone(f.reply);change(reply);const out=parseReview(JSON.stringify(reply),f.request,f.p,f.audit,100,cues,[]);expect(out.status).toBe('failed');expect(out.results).toEqual([]);}
  expect(parseReview('PRIVATE_BAD_PAYLOAD',f.request,f.p,f.audit,100,cues,[])).toMatchObject({status:'failed',failure:'json',results:[]});
});

test('synthetic inconsistent review cannot leave a repair behind after reference validation rejects it',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../fixtures/vision-real-review-context.json',import.meta.url),'utf8'));
  const context=JSON.parse(readFileSync(new URL('../fixtures/vision-missing-unresolved-context.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
  const raw=readFileSync(new URL('../fixtures/vision-real-review-reply.json',import.meta.url),'utf8');
  // Parser-only synthetic fixture preserves invalid references and time boundaries;
  // no external subtitle transcript, paid model call or PNG reading is used.
  const images=fixture.images.map((i:Attachment)=>({...i,dataUrl:png(),width:2,height:2}));
  const request=reviewRequest(snapshot,fixture.plan,fixture.audit,images,context.cues,context.duration,{}),before=structuredClone(request.review);
  const out=parseReview(raw,request,fixture.plan,fixture.audit,context.duration,context.cues,[]);
  expect(out).toMatchObject({status:'failed',failure:'references',results:[],repairs:[]});
  expect(request.review).toEqual(before);
  expect(()=>validateVisionReview(out,fixture.plan,fixture.audit,context.duration,[],context.cues.length)).not.toThrow();
});
test('refinement windows must remain related, use provided cues, and preserve comparison order',()=>{
  const f=sample(plan(true)),valid=partial(f,5);
  expect(parseReview(JSON.stringify(valid),f.request,f.p,f.audit,100,cues,[])).toMatchObject({status:'complete',repairs:[{state:'pending',originalTime:4,originalWindow:window(4)}]});
  for(const anchor of [9,20]){const reply=partial(f,anchor);expect(parseReview(JSON.stringify(reply),f.request,f.p,f.audit,100,cues,[]).status).toBe('failed');}
  const badCue=partial(f);badCue.results[0].refinements[0].window.cueIds=[99];
  expect(parseReview(JSON.stringify(badCue),f.request,f.p,f.audit,100,cues,[]).status).toBe('failed');
  const noGap=partial(f);noGap.results[0].missing='';expect(parseReview(JSON.stringify(noGap),f.request,f.p,f.audit,100,cues,[]).status).toBe('failed');
});

test('compact review grounds refinements in actual cues and retains strict durable checks',()=>{
  const f=sample(),wire={version:2,results:[{...f.reply.results[0],status:'unreadable',observations:[],missing:'目标小字读不清',refinements:[{slotKey:f.audit.slots[0].key,cueIds:[0],anchorCueId:0}]}]};
  const out=parseReview(JSON.stringify(wire),f.request,f.p,f.audit,100,cues,[]);
  expect(out.status).toBe('complete');expect(out.repairs[0].window).toEqual({from:1,to:8,anchor:5.5,cueIds:[0],basis:'subtitle'});
  expect(()=>validateVisionReview(out,f.p,f.audit,100,[],cues.length)).not.toThrow();
  for(const refinement of [{slotKey:'invented',cueIds:[0]},{slotKey:f.audit.slots[0].key,cueIds:[99]},{slotKey:f.audit.slots[0].key,cueIds:[0,0]},{slotKey:f.audit.slots[0].key,cueIds:[0],anchorCueId:1}]){
    const invalid=structuredClone(wire);invalid.results[0].refinements=[refinement as any];
    expect(parseReview(JSON.stringify(invalid),f.request,f.p,f.audit,100,cues,[])).toMatchObject({status:'failed',results:[],repairs:[]});
  }
  const inconsistent=structuredClone(wire);inconsistent.results[0].status='sufficient';
  expect(parseReview(JSON.stringify(inconsistent),f.request,f.p,f.audit,100,cues,[]).status).toBe('failed');
});
test('review ignores unrelated optional overview frames and stops refinements at remaining media/capture budget',()=>{
  const p=plan();p.evidence[0].priority='optional';p.evidence[0].detailNeed='overview';p.evidence[0].readTargets=[];p.evidence[0].need='查看整体布局';
  const f=sample(p);expect(f.request.targets).toEqual([]);expect(f.request.review.images).toEqual([]);
  expect(canRefine(f.audit)).toBe(true);f.audit.budget.mediaMs=24000;expect(canRefine(f.audit)).toBe(false);
  f.audit.budget.mediaMs=0;f.audit.budget.captures=18;expect(canRefine(f.audit)).toBe(false);
  expect(visionStageSchema.safeParse({phase:'checking',attachmentIds:[],review:f.request.review}).success).toBe(false);
});
test('bounded repair collects replacements in memory and retains spent work on capture failure or cancellation',async()=>{
  const f=sample(),review=parseReview(JSON.stringify(partial(f)),f.request,f.p,f.audit,100,cues,[]);
  f.audit.budget.captures=12;f.audit.budget.mediaMs=1000;
  const done=await captureRefinements(f.p,f.audit,review,f.images,async time=>({...frame(time),sample:{sharpness:10,contrast:20,luma:[0,20,30]}}),new AbortController().signal);
  expect(done.frames).toHaveLength(1);expect(done.audit.frames).toEqual(f.audit.frames);expect(done.audit.slots).toEqual(f.audit.slots);
  expect(done.audit.budget.captures).toBeLessThanOrEqual(15);expect(done.audit.budget.mediaMs).toBeGreaterThanOrEqual(1000);
  const failed=await captureRefinements(f.p,f.audit,review,f.images,async()=>{throw Error('seek-timeout');},new AbortController().signal);
  expect(failed.frames).toEqual([]);expect(failed.audit.budget.captures).toBe(13);
  const controller=new AbortController();await expect(captureRefinements(f.p,f.audit,review,f.images,async time=>{controller.abort();return frame(time);},controller.signal)).rejects.toThrow();
});
test('reserving repair work still gives every initial important slot a candidate before repeated local work',async()=>{
  const p=plan();p.evidence=Array.from({length:6},(_,index)=>({...p.evidence[0],id:`menu${index}`,windows:[{...window(index*10+4),cueIds:[],basis:'user-time'}]}));
  const a=allocateVisualPlan(p,snapshot,[],'字幕','字幕');a.budget.maxCaptures=12;
  const done=await captureEvidence(p,a,async time=>({...frame(time),dataUrl:png()+time,sample:{sharpness:time,contrast:20,luma:[time]}}),async(f,s,a)=>{a.frames.push({slotKey:s.key,attachmentId:crypto.randomUUID(),time:f.time,detail:s.detail});return a;},async()=>{},new AbortController().signal,()=>0);
  expect(done.frames).toHaveLength(6);expect(done.budget.captures).toBe(12);
  expect(done.stopReason).toBe('local-selection-complete');
  expect(done.unresolved).not.toContain('媒体总时间或候选预算已到边界，剩余窗口未检查。');
});

async function stored(pair=false){
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),jobs=new IndexedGenerationStore(name),attachments=new IndexedAttachmentStore(name);
  const ws=await spaces.open({platform:'bilibili',videoId:'BVtest',partId:'1',title:'test'}),target={kind:'chat' as const,workspaceId:ws.id,chatId:ws.chatId},draft=(await spaces.read(ws.id,ws.chatId))!.draft;
  await spaces.save(ws.id,0,{...draft,text:'核对设置文字',modelId:'fixture'},ws.chatId);
  const job=await jobs.freezeChat(target,1,{binding:{platform:'bilibili',videoId:'BVtest',partId:'1',tabId:1,documentId:'doc',epoch:1},locator:'original',fingerprint:'original',language:'zh',cueCount:1,mediaDuration:100},true,true),id=job.attempts[0].attemptId;
  await jobs.attach(job.jobId,id,5);await jobs.claim(job.jobId,id,5);
  const p=plan(pair),s=job.snapshot as ChatRequestSnapshot;let a=allocateVisualPlan(p,s,[],'字幕','字幕');
  let v:VisionStage={phase:'capturing',resolution:'images',attachmentIds:[],plan:{times:a.slots.map(s=>s.anchor),reason:'按需择帧'},evidencePlan:p,audit:a};
  await jobs.visual(job.jobId,id,v);
  for(const slot of a.slots){const j=await jobs.visual(job.jobId,id,v,frame(slot.anchor),slot.key);v=j.attempts[0].visual!;}
  a=v.audit!;const images=await attachments.read(target,v.attachmentIds,true),f=sample(p,s),request=reviewRequest(s,p,a,images,cues,100,{request:s.input});
  f.audit=a;f.request=request;
  const old=partial(f),proposal={version:3,results:old.results.map(r=>({evidenceId:r.evidenceId,checks:[{checkId:'c0',status:'unreadable',imageRefs:r.imageRefs,observation:r.missing}],refinements:[{slotKey:a.slots[0].key,cueIds:[0],checkIds:['c0'],reason:'相关设置状态可补取清晰画面'}]}))};
  const review=parseReview(JSON.stringify(proposal),request,p,a,100,cues,[]);
  expect(review.status).toBe('complete');review.repairDecision='pending';
  v={...v,phase:'permission',resolution:undefined,issue:'permission',review};await jobs.visual(job.jobId,id,v);
  return {name,spaces,jobs,attachments,target,job,id,v,a,p,images,review};
}
test('repair requires an explicit fresh decision; keeping evidence resumes without changing image IDs',async()=>{
  const f=await stored();expect((f.job.snapshot as ChatRequestSnapshot).visionReview).toBe(2);
  await expect(f.jobs.refineVisual(f.job.jobId,f.id,{...f.v,phase:'refining'},[{slotKey:'settings_0',frame:frame(5)}])).rejects.toThrow();
  const kept=await f.jobs.decideVisual(f.job.jobId,'keep');
  expect(kept.attempts[0].visual).toMatchObject({resolution:'images',review:{repairDecision:'keep'}});
  expect(kept.attempts[0].visual!.attachmentIds).toEqual(f.v.attachmentIds);
});
test('replacement atomically removes only old automatic images and survives frozen retry plus backup remapping',async()=>{
  const f=await stored();await f.jobs.decideVisual(f.job.jobId,'images');
  let v=(await f.jobs.get(f.job.jobId))!.attempts[0].visual!;v={...v,phase:'refining'};await f.jobs.visual(f.job.jobId,f.id,v);
  const changed=await f.jobs.refineVisual(f.job.jobId,f.id,v,[{slotKey:'settings_0',frame:frame(5)}]),ready=changed.attempts[0].visual!;
  expect(ready.attachmentIds).toHaveLength(1);expect(ready.attachmentIds).not.toEqual(v.attachmentIds);
  expect(ready.audit!.frames[0].time).toBe(5);expect(ready.plan!.times).toEqual([5.5]);
  expect(ready.review!.repairs[0]).toMatchObject({state:'captured-unverified',originalTime:4,actualTime:5});
  await expect(f.attachments.read(f.target,v.attachmentIds,true)).rejects.toThrow();
  expect((await f.attachments.read(f.target,ready.attachmentIds,true))[0].time).toBe(5);
  validateVisionReview(ready.review!,ready.evidencePlan!,ready.audit!,100,[],1);
  ready.audit!.samplingNotes=['连续区间 3—7 秒按前后状态取样；静帧不证明流畅度。'];
  const frozen={...ready,phase:'answering' as const,frozen:true};await f.jobs.visual(f.job.jobId,f.id,frozen);await f.jobs.finish(f.job.jobId,f.id,'failed','network');
  expect((await f.jobs.retry(f.job.jobId)).attempts[1].visual).toEqual(frozen);
  await expect(f.jobs.refineVisual(f.job.jobId,f.id,frozen,[{slotKey:'settings_0',frame:frame(5)}])).rejects.toThrow();
  const dest=crypto.randomUUID(),backup=new IndexedBackupStore(dest),file=await new IndexedBackupStore(f.name).export();
  const imported=await backup.preview(file);await backup.execute(imported.planId,imported.checksum);
  const local=new IndexedWorkspaceStore(dest),draft=(await local.read(f.target.workspaceId,f.target.chatId))!.draft;
  await local.save(f.target.workspaceId,draft.revision,{...draft,text:'冲突副本'},f.target.chatId);
  const conflict=await backup.preview(file);await backup.execute(conflict.planId,conflict.checksum);const mapped=(id:string)=>conflict.mapping.find(m=>m.from===id)!.to;
  const copy=(await new IndexedGenerationStore(dest).get(mapped(f.job.jobId)))!.attempts[1].visual!;
  expect(copy.audit!.frames[0].attachmentId).toBe(mapped(ready.attachmentIds[0]));expect(copy.review!.images).toEqual(ready.review!.images);
  expect(copy.audit!.samplingNotes).toEqual(ready.audit!.samplingNotes);
  const feedback=failureFeedback(jobView((await f.jobs.get(f.job.jobId))!),'test');
  expect(feedback).toContain('captured-unverified');expect(feedback).not.toContain('目标文字仍然模糊');expect(feedback).not.toContain('data:image');
});
test('a repair that reverses actual state order rolls back attachments and messages as one transaction',async()=>{
  const f=await stored(true);await f.jobs.decideVisual(f.job.jobId,'images');
  let v=(await f.jobs.get(f.job.jobId))!.attempts[0].visual!;v={...v,phase:'refining'};await f.jobs.visual(f.job.jobId,f.id,v);
  // Proposed first-state anchor is 5, but its window extends to 6. The actual
  // second-state image is at 6, so equality must reject the entire replacement.
  await expect(f.jobs.refineVisual(f.job.jobId,f.id,v,[{slotKey:'settings_0',frame:frame(6)}])).rejects.toThrow();
  const current=(await f.jobs.get(f.job.jobId))!.attempts[0].visual!;
  expect(current).toEqual(v);expect((await f.attachments.read(f.target,v.attachmentIds,true)).map(i=>i.time)).toEqual([4,6]);
});
test('review can use a frozen historical image without recapture and backup conflict remaps its reference',async()=>{
  const f=await stored(),kept=await f.jobs.decideVisual(f.job.jobId,'keep'),first=kept.attempts[0].visual!;
  first.review!.repairs.forEach(r=>{r.state='declined';});
  const ready=await f.jobs.visual(f.job.jobId,f.id,{...first,phase:'answering',frozen:true});
  await f.jobs.checkpoint(f.job.jobId,f.id,ready.seq+1,'先前画面',{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});
  await f.jobs.finish(f.job.jobId,f.id,'completed',null,crypto.randomUUID());
  const draft=(await f.spaces.read(f.target.workspaceId,f.target.chatId))!.draft;
  await f.spaces.save(f.target.workspaceId,draft.revision,{...draft,text:'核对刚才的画面',modelId:'fixture'},f.target.chatId);
  const next=await f.jobs.freezeChat(f.target,draft.revision+1,f.job.basis,true,true),id=next.attempts[0].attemptId,s=next.snapshot as ChatRequestSnapshot;
  await f.jobs.attach(next.jobId,id,5);await f.jobs.claim(next.jobId,id,5);
  const p=plan(),old=first.attachmentIds[0];p.needsNewFrames=false;p.evidence[0].windows=[];p.evidence[0].reuseAttachmentIds=[old];
  const images=await f.attachments.forSnapshot(s),a=allocateVisualPlan(p,s,images,'字幕','字幕'),request=reviewRequest(s,p,a,images,cues,100,{request:s.input});
  const review=parseReview(JSON.stringify({version:3,results:[{evidenceId:'settings',checks:[{checkId:'c0',status:'confirmed',imageRefs:['i0'],observation:'模拟历史图片中的设置页'}],refinements:[]}]}),request,p,a,100,cues,[old]);
  expect(review).toMatchObject({status:'complete',images:[{attachmentId:old}]});
  await f.jobs.visual(next.jobId,id,{phase:'answering',resolution:'images',attachmentIds:[],plan:{times:[],reason:'冻结历史复用'},evidencePlan:p,audit:a,review,frozen:true});
  await f.jobs.finish(next.jobId,id,'failed','network');
  const dest=crypto.randomUUID(),backup=new IndexedBackupStore(dest),file=await new IndexedBackupStore(f.name).export();
  const imported=await backup.preview(file);await backup.execute(imported.planId,imported.checksum);
  const other=new IndexedWorkspaceStore(dest),local=(await other.read(f.target.workspaceId,f.target.chatId))!.draft;
  await other.save(f.target.workspaceId,local.revision,{...local,text:'本机新内容'},f.target.chatId);
  const conflict=await backup.preview(file);await backup.execute(conflict.planId,conflict.checksum);const mapped=(id:string)=>conflict.mapping.find(m=>m.from===id)!.to;
  expect((await new IndexedGenerationStore(dest).get(mapped(next.jobId)))!.attempts[0].visual!.review!.images[0].attachmentId).toBe(mapped(old));
  expect((await f.attachments.read(f.target,[old],true))[0].time).toBe(4);
});
