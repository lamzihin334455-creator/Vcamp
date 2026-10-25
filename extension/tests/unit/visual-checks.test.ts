import {expect,test} from 'vitest';
import {reviewRequest,parseReview,captureRefinements} from '../../src/generation/vision-review';
import {allocateVisualPlan,evidenceDetail} from '../../src/generation/visual-selection';
import {parseEvidenceProposal} from '../../src/generation/vision-plan';
import {validateVisionReview,evidenceChecks,type EvidencePlan} from '../../src/contracts/vision';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import type {Attachment} from '../../src/contracts/attachment';
import {visualEvidenceNote} from '../../src/generation/visual-evidence-note';
import {png} from '../fixtures/png';

const cues=[{from:1,to:4,content:'主题设置后的高度、复选框和边框仍有差异'}];
const snapshot={snapshotId:'test',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'快速总结',outputType:'chat',modelId:'fixture',webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[],visionReview:2} as unknown as ChatRequestSnapshot;
function fixture(priority='required',original=true){
  const item={id:'e1',need:'统一填入design token后的细节差异（标签栏高低、复选框大小、边框粗细）',checkTargets:['标签栏高度','复选框大小','边框粗细'],priority,mode:'single',reuseAttachmentIds:[],detailNeed:'overview',reason:'核心中间状态',windows:[{from:1,to:4,anchor:2,cueIds:[0],basis:'subtitle'}]};
  const plan={version:2,scope:'focused',needsNewFrames:true,evidence:[item],unresolved:[]} as unknown as EvidencePlan;
  const audit=allocateVisualPlan(plan,snapshot,[],'字幕','总结');
  if(!original)audit.slots[0].detail='low';
  const image={id:crypto.randomUUID(),time:2,dataUrl:png(),width:2,height:2,bytes:100} as Attachment;
  audit.frames=[{slotKey:'e1_0',attachmentId:image.id,time:2,detail:audit.slots[0].detail}];
  const request=reviewRequest(snapshot,plan,audit,[image],cues,10,{});
  const wire={version:3,results:[{evidenceId:'e1',checks:['confirmed','unreadable','not-visible'].map((status,i)=>({checkId:`c${i}`,status,imageRefs:['i0'],observation:i===0?'高度有差异':'无法核实'})),refinements:[] as any[]}]};
  const parse=(value:any)=>parseReview(JSON.stringify(value),request,plan,audit,10,cues,[]);
  return {item,plan,audit,request,wire,parse};
}
test('fine geometry needs original pixels even when a proposal labels it overview',()=>{
  const f=fixture();expect(evidenceDetail(f.plan.evidence[0]).detail).toBe('original');
});
test('planning preserves separate check targets without turning appearance targets into OCR',()=>{
  const f=fixture(),{id,reuseAttachmentIds,...item}=f.item;
  const out=parseEvidenceProposal(JSON.stringify({version:3,scope:'focused',evidence:[{...item,windows:[{cueIds:[0]}]}],unresolved:[]}),10,cues,[]);
  expect(out).toHaveProperty('plan.evidence.0.checkTargets',['标签栏高度','复选框大小','边框粗细']);
  expect(evidenceDetail({...f.plan.evidence[0],need:'查看整体配色',checkTargets:['整体配色','左右布局']}).detail).toBe('low');
});

test('real proposal uses one authoritative check list; read hints do not create duplicate checks',()=>{
  const f=fixture(),{id,reuseAttachmentIds,...item}=f.item;
  const proposal={version:3,scope:'whole-video',evidence:[{...item,checkTargets:['标签栏高度差异','复选框大小差异','输入框边框粗细差异'],readTargets:['标签栏高度','复选框大小','输入框边框粗细'],windows:[{cueIds:[0]}]}],unresolved:[]};
  const out=parseEvidenceProposal(JSON.stringify(proposal),10,cues,[]);expect(out).toHaveProperty('plan');
  if(!('plan' in out))throw Error('real proposal rejected');
  expect(evidenceChecks(out.plan.evidence[0]).map(c=>c.need)).toEqual(proposal.evidence[0].checkTargets);
  expect(out.plan.evidence[0].readTargets).toEqual(proposal.evidence[0].readTargets);
  expect(evidenceChecks({...f.plan.evidence[0],checkTargets:undefined,readTargets:['旧版读字目标']}).map(c=>c.need)).toEqual(['旧版读字目标']);
});

test('a check-only menu or selected-state target keeps detail without duplicated read targets',()=>{
  const f=fixture();expect(evidenceDetail({...f.plan.evidence[0],need:'查看设置页面',checkTargets:['菜单选项文字','当前勾选状态'],readTargets:[]}).detail).toBe('original');
});
test('one confirmed subtarget cannot mark the whole evidence sufficient',()=>{
  const f=fixture();expect((f.request.targets[0] as any).checks.map((c:any)=>c.need)).toEqual(f.item.checkTargets);
  const out=f.parse(f.wire);expect(out.status).toBe('complete');expect(out.results[0]).toMatchObject({status:'partial',checks:[{status:'confirmed'},{status:'unreadable'},{status:'not-visible'}]});
  expect(out.results[0].missing).toContain('复选框大小');expect(out.results[0].missing).toContain('边框粗细');
  expect(()=>validateVisionReview(out,f.plan,f.audit,10,[],cues.length)).not.toThrow();
  const tampered=structuredClone(out);tampered.results[0].status='sufficient';tampered.results[0].missing='';
  expect(()=>validateVisionReview(tampered,f.plan,f.audit,10,[],cues.length)).toThrow();
  const note=visualEvidenceNote({phase:'answering',resolution:'images',attachmentIds:[],audit:f.audit,evidencePlan:f.plan,review:out});
  expect(note).toContain('复选框大小');expect(note).toContain('unreadable');expect(note).not.toContain('高度有差异');
});

test('a self-reported inability to prove a check cannot be confirmed',()=>{
  const f=fixture();f.wire.results[0].checks.forEach(c=>{c.status='confirmed';});
  f.wire.results[0].checks[1].observation='两图不能证明按键后的动态切换';
  f.wire.results[0].checks[2].observation='两图未展示输入前状态，出现时机需结合字幕';
  const out=f.parse(f.wire);expect(out.status).toBe('complete');
  expect(out.results[0]).toMatchObject({status:'partial',checks:[{status:'confirmed'},{status:'uncertain'},{status:'uncertain'}]});
  expect(out.results[0].checks?.[1].observation).toContain('本地降为无法确定');
  expect(out.results[0].missing).toContain('复选框大小');
});

test('an identical original-detail replacement is not adopted as a useful repair',async()=>{
  const f=fixture(),images=[{id:f.audit.frames[0].attachmentId,time:2,dataUrl:png(),width:2,height:2,bytes:100} as Attachment];
  f.wire.results[0].refinements=[{slotKey:'e1_0',cueIds:[0],checkIds:['c1'],reason:'在相关时间寻找更清晰画面'}];
  const review=f.parse(f.wire);expect(review.repairs).toHaveLength(1);
  const result=await captureRefinements(f.plan,f.audit,review,images,async()=>({time:2,dataUrl:png(),width:2,height:2}),new AbortController().signal);
  expect(result.frames).toEqual([]);expect(result.audit.budget.captures).toBeGreaterThan(0);
});
test('all checks and references must be accounted for, and legacy sufficiency cannot bypass new review',()=>{
  const f=fixture();
  for(const mutate of [(w:any)=>w.results[0].checks.pop(),(w:any)=>w.results[0].checks[1].checkId='c0',(w:any)=>w.results[0].checks[0].imageRefs=['unknown'],(w:any)=>w.results[0].checks[0].status='probably']){
    const w=structuredClone(f.wire);mutate(w);expect(f.parse(w).status).toBe('failed');
  }
  expect(f.parse({version:2,results:[{evidenceId:'e1',status:'sufficient',imageRefs:['i0'],observations:['足够'],missing:'',refinements:[]}]}).status).toBe('failed');
  const all=structuredClone(f.wire);all.results[0].checks.forEach(c=>{c.status='confirmed';c.observation='清晰可见';});
  expect(f.parse(all).results[0].status).toBe('sufficient');
});
test('repair is justified by an unresolved check and useful detail or time change',()=>{
  for(const [priority,original,expected] of [['required',false,1],['required',true,0],['optional',false,0]] as const){
    const f=fixture(priority,original);f.wire.results[0].refinements=[{slotKey:'e1_0',cueIds:[0],checkIds:['c1'],reason:'原帧过小，改取清晰细节'}];
    // Cue midpoint is 2.5: use 1..3 so a same-source-frame request is explicit.
    const timeline=[{from:1,to:3,content:cues[0].content}];
    const req=reviewRequest(snapshot,f.plan,f.audit,[{id:f.audit.frames[0].attachmentId,time:2,dataUrl:png(),width:2,height:2,bytes:100} as Attachment],timeline,10,{});
    const out=parseReview(JSON.stringify(f.wire),req,f.plan,f.audit,10,timeline,[]);
    expect(out.status).toBe('complete');expect(out.repairs).toHaveLength(expected);
    if(!expected)expect((out as any).refinementNotes.join('')).toBeTruthy();
  }
});

test('a new request cannot accept old aggregate sufficiency even when the legacy plan is otherwise valid',()=>{
  const f=fixture();delete f.plan.evidence[0].checkTargets;f.plan.evidence[0].readTargets=['标签栏高度','复选框大小','边框粗细'];
  const req=reviewRequest(snapshot,f.plan,f.audit,[{id:f.audit.frames[0].attachmentId,time:2,dataUrl:png(),width:2,height:2,bytes:100} as Attachment],cues,10,{});
  const old={version:1,results:[{evidenceId:'e1',status:'sufficient',imageRefs:['i0'],observations:['只看到标签栏高低不一'],missing:'',refinements:[]}]};
  expect(parseReview(JSON.stringify(old),req,f.plan,f.audit,10,cues,[])).toMatchObject({status:'failed',failure:'schema',results:[]});
});

test('a comparison check needs both actual states, even when other checks cite the other image',()=>{
  const f=fixture(),e=f.plan.evidence[0];e.mode='pair';e.windows=[{...e.windows[0],anchor:1.5},{...e.windows[0],anchor:3}];
  const audit=allocateVisualPlan(f.plan,snapshot,[],'字幕','总结');
  const images=[1.5,3].map(time=>({id:crypto.randomUUID(),time,dataUrl:png(),width:2,height:2,bytes:100} as Attachment));
  audit.frames=audit.slots.map((s,i)=>({slotKey:s.key,attachmentId:images[i].id,time:images[i].time,detail:s.detail}));
  const request=reviewRequest(snapshot,f.plan,audit,images,cues,10,{});
  const wire=structuredClone(f.wire);wire.results[0].checks.forEach((c,i)=>{c.status='confirmed';c.observation='两张实际画面可以对照目标状态';c.imageRefs=[`i${i%2}`];});
  expect(parseReview(JSON.stringify(wire),request,f.plan,audit,10,cues,[])).toMatchObject({status:'failed',failure:'references'});
  wire.results[0].checks.forEach(c=>{c.imageRefs=['i0','i1'];});
  expect(parseReview(JSON.stringify(wire),request,f.plan,audit,10,cues,[]).results[0].status).toBe('sufficient');
});
