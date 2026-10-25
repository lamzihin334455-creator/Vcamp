import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseEvidenceProposal} from '../../src/generation/vision-plan';
import {validateEvidencePlan} from '../../src/contracts/vision';

const {duration,cues}=JSON.parse(readFileSync(new URL('../fixtures/vision-missing-unresolved-context.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const proposal=()=>({version:3,scope:'focused',evidence:[{need:'核对默认登录框的外观差异',priority:'required',mode:'single',windows:[{cueIds:[27,28,29],anchorCueId:28}],detailNeed:'overview',reason:'字幕定位'}],unresolved:[]});
const parse=(p:unknown)=>parseEvidenceProposal(JSON.stringify(p),duration,cues,[]);

test('cue decisions map to the exact original timeline and a strict v2 canonical plan',()=>{
  const result=parse(proposal());if(!('plan' in result))throw Error(JSON.stringify(result));
  expect(result.cueGrounded).toBe(true);
  expect(result.plan.evidence[0]).toMatchObject({id:'e1',reuseAttachmentIds:[],windows:[{from:cues[27].from,to:cues[29].to,anchor:(cues[28].from+cues[28].to)/2,basis:'subtitle',cueIds:[27,28,29]}]});
  expect(validateEvidencePlan(result.plan,duration,cues,[])).toEqual(result.plan);
  expect(parseEvidenceProposal(JSON.stringify(result.plan),duration,cues,[])).toEqual({plan:result.plan});
  const automatic=proposal();delete (automatic.evidence[0].windows[0] as any).anchorCueId;
  expect(parse(automatic)).toEqual(result);
});

test('unknown, duplicate, and unselected anchor cues are rejected rather than guessed',()=>{
  for(const window of [{cueIds:[999]},{cueIds:[27,27]},{cueIds:[27],anchorCueId:28}]){
    const p=proposal();p.evidence[0].windows=[window as any];
    expect(parse(p)).toMatchObject({failure:{code:'invalid-cue',fields:['evidence.0.windows.0.cueIds']}});
  }
});

test('missing fields, mixed cue/time windows and incomplete pairs remain invalid',()=>{
  for(const field of ['need','priority','mode','windows','detailNeed','reason']){const p=proposal();delete (p.evidence[0] as any)[field];expect(parse(p)).toHaveProperty('failure');}
  const mixed=proposal();Object.assign(mixed.evidence[0].windows[0],{from:64,to:72});expect(parse(mixed)).toHaveProperty('failure');
  const pair=proposal();pair.evidence[0].mode='pair';expect(parse(pair)).toMatchObject({failure:{code:'invalid-group'}});
  const foreign=proposal();Object.assign(foreign.evidence[0],{reuseAttachmentIds:[crypto.randomUUID()]});expect(parse(foreign)).toMatchObject({failure:{code:'invalid-reuse'}});
  const many=proposal();many.evidence[0].windows=[{cueIds:Array.from({length:65},(_,i)=>68+i),anchorCueId:73}];expect(parse(many)).toMatchObject({failure:{code:'invalid-schema',fields:['evidence.0.windows.0.cueIds']}});
});

test('cue intervals retain two-state sampling, explicit gaps, and no-frame decisions',()=>{
  const p=proposal();p.evidence[0].mode='sequence';delete (p as any).unresolved;
  const result=parse(p);if(!('plan' in result))throw Error(JSON.stringify(result));
  expect(result.plan.evidence[0].windows).toHaveLength(2);expect(result.samplingNotes).toHaveLength(1);
  expect(result.plan.unresolved).toEqual([expect.stringContaining('不表示所有视觉需求已覆盖')]);
  expect(parse({version:3,scope:'focused',evidence:[],unresolved:[]})).toEqual({cueGrounded:true,plan:{version:2,scope:'focused',needsNewFrames:false,evidence:[],unresolved:[]}});
});

test('non-subtitle windows keep explicit geometry checks and cannot masquerade as subtitle windows',()=>{
  const p=proposal();p.evidence[0].windows=[{from:1,to:2,anchor:1.5,basis:'user-time'} as any];
  expect(parse(p)).toMatchObject({plan:{evidence:[{windows:[{from:1,to:2,anchor:1.5,cueIds:[],basis:'user-time'}]}]}});
  (p.evidence[0].windows[0] as any).to=duration;expect(parse(p)).toMatchObject({failure:{code:'invalid-window'}});
  (p.evidence[0].windows[0] as any).basis='subtitle';expect(parse(p)).toHaveProperty('failure');
});

test('a final cue ending at media duration stays strictly inside the playable interval',()=>{
  const p=proposal();p.evidence[0].windows=[{cueIds:[0],anchorCueId:0}];
  const r=parseEvidenceProposal(JSON.stringify(p),10,[{from:9,to:10,content:'结束'}],[]);
  expect(r).toMatchObject({plan:{evidence:[{windows:[{from:9,to:9.999,anchor:9.5}]}]}});
});
