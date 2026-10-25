import {expect,test} from 'vitest';
import type {Attachment} from '../../src/contracts/attachment';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import {validateEvidencePlan,type EvidencePlan} from '../../src/contracts/vision';
import {allocateVisualPlan,evidenceDetail,qualityScore} from '../../src/generation/visual-selection';
import {captureEvidence} from '../../src/generation/capture-evidence';
import {fixedPrompt} from '../../src/prompts/fixed-rules';
import {png} from '../fixtures/png';

const snapshot:ChatRequestSnapshot={snapshotId:'test',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'归纳演示内容',outputType:'chat',modelId:'fixture',mediaDuration:260,webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[]};
const item=(id:string,time:number):EvidencePlan['evidence'][number]=>({id,need:'查看这一页的总体外观',priority:'required',mode:'single',reuseAttachmentIds:[],detailNeed:'overview',reason:'字幕定位该设置页',windows:[{from:time-1,to:time+2,anchor:time,cueIds:[],basis:'user-time'}]});
const plan=(evidence:EvidencePlan['evidence']):EvidencePlan=>({version:2,scope:'focused',needsNewFrames:true,evidence,unresolved:[]});
const allocate=(p:EvidencePlan,s=snapshot,images:Attachment[]=[])=>allocateVisualPlan(p,s,images,'完整字幕','最终上下文');

test('background and layout pages retain separate original-detail slots despite an overview mislabel',()=>{
  const p=plan([{...item('background',155),readTargets:['背景选项名称']},{...item('layout',167),readTargets:['布局选项名称','当前勾选状态']}]);
  expect(validateEvidencePlan(p,260,[],[])).toEqual(p);
  const a=allocate(p);
  expect(a.slots.map(s=>[s.anchor,s.detail])).toEqual([[155,'original'],[167,'original']]);
  expect(a.slots.every(s=>s.detailReason?.includes('已校正'))).toBe(true);
  expect(p.evidence.every(e=>e.detailNeed==='overview')).toBe(true);
});

test('each window in a reading sequence inherits detail while appearance-only evidence stays low',()=>{
  const p=plan([{...item('pages',155),mode:'sequence',readTargets:['各页菜单文字'],windows:[item('a',155).windows[0],item('b',167).windows[0],item('c',177).windows[0]]},
    {...item('appearance',133),need:'仅看壁纸配色和整体布局，不需要读取文字',readTargets:[]}]);
  const a=allocate(p);
  expect(a.slots.filter(s=>s.group==='pages').map(s=>s.detail)).toEqual(['original','original','original']);
  expect(a.slots.find(s=>s.group==='appearance')?.detail).toBe('low');
});

test('legacy plans with explicit menu or checkbox needs are corrected without globally upgrading captions',()=>{
  for(const need of ['设置项：文字/图标、横向 Dock','核对菜单选项名称','确认当前勾选状态','read menu items']){
    expect(evidenceDetail({...item('legacy',1),need}).detail).toBe('original');
  }
  expect(evidenceDetail({...item('overview',1),need:'文字和图标在整体布局中的占比'}).detail).toBe('low');
});

test('resolved reading detail governs sharing and the byte budget rather than silently downgrading',()=>{
  const shared=allocate(plan([{...item('a',155),readTargets:['选项名称']},{...item('b',155),detailNeed:'read-text'}]));
  expect(shared.slots).toHaveLength(1);expect(shared.slots[0].evidenceIds).toEqual(['a','b']);
  const images=Array.from({length:5},()=>({id:crypto.randomUUID(),bytes:3.8*1024*1024} as Attachment));
  const s={...snapshot,attachmentIds:images.map(i=>i.id)};
  const reading=allocate(plan([{...item('read',155),readTargets:['具体文字']}]),s,images);
  expect(reading.slots).toHaveLength(0);expect(reading.unresolved.join('')).toContain('预算');
  expect(allocate(plan([item('overview',155)]),s,images).slots).toHaveLength(1);
});

test('formerly saturated measurements retain order, with no confidence assigned to missing metrics',()=>{
  const values=[{sharpness:30,contrast:70,luma:[]},{sharpness:60,contrast:90,luma:[]},{sharpness:100,contrast:110,luma:[]}];
  const scores=values.map(qualityScore);
  expect(scores[0]).toBeLessThan(scores[1]);expect(scores[1]).toBeLessThan(scores[2]);
  expect(new Set(scores.map(s=>s.toFixed(3))).size).toBe(3);expect(scores[2]).toBeLessThan(1);
  expect(qualityScore({sharpness:1,contrast:120,luma:[]})).toBeLessThan(qualityScore({sharpness:40,contrast:30,luma:[]}));
  expect(qualityScore()).toBe(0);expect(qualityScore({sharpness:NaN,contrast:10,luma:[]})).toBe(0);
});

test('a high first overview score no longer prevents a clearer later candidate from being selected',async()=>{
  const p=plan([item('overview',155)]),a=allocate(p),saved:any[]=[];
  const done=await captureEvidence(p,a,async time=>({dataUrl:png(),width:2,height:2,time,
    sample:{sharpness:time===156?100:time===155?30:10,contrast:time===156?110:70,luma:[1,2,3]}}),
    async(f,s,a)=>{saved.push(f);a.frames.push({slotKey:s.key,attachmentId:crypto.randomUUID(),time:f.time,detail:s.detail});return a;},async()=>{},new AbortController().signal,()=>0);
  expect(saved[0].time).toBe(156);expect(saved[0].sample).toBeUndefined();expect(done.budget.captures).toBe(3);
  expect(done.candidates.find(c=>c.decision==='selected')?.metrics?.sharpness).toBe(100);
});

test('only exact stable candidates can finish early and opaque low-texture frames remain valid',async()=>{
  const p=plan([item('overview',155)]);
  for(const sharpness of [30,0]){
    const a=allocate(p);
    const done=await captureEvidence(p,a,async time=>({dataUrl:png(),width:2,height:2,time,sample:{sharpness,contrast:sharpness,luma:[0,0]}}),
      async(f,s,a)=>{a.frames.push({slotKey:s.key,attachmentId:crypto.randomUUID(),time:f.time,detail:s.detail});return a;},async()=>{},new AbortController().signal,()=>0);
    expect(done.frames).toHaveLength(1);expect(done.budget.captures).toBe(sharpness?2:3);
    if(!sharpness)expect(done.unresolved.join('')).toContain('低纹理');
  }
});

test('planning and final reading rules bind targets without claiming their contents were verified',()=>{
  const planning=fixedPrompt({kind:'vision-plan',duration:260,maxFrames:6,preauthorized:true});
  expect(planning).toContain('readTargets');expect(planning).toContain('不同设置页和状态');expect(planning).toContain('勾选/选中/开关状态');
  const final=fixedPrompt({kind:'answer',output:'chat',visionOnly:false,hasImages:true,web:false});
  expect(final).toContain('不得用字幕提到的选项冒充已看清画面');
  expect(final).toContain('不把选项下方的小字描述列成新的同级选项');
  expect(fixedPrompt({kind:'vision-review'})).toContain('高亮仅能证明当前焦点或高亮');
});
