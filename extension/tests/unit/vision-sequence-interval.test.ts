import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseEvidenceProposal} from '../../src/generation/vision-plan';
import {allocateVisualPlan} from '../../src/generation/visual-selection';
import {validateEvidencePlan,type EvidencePlan} from '../../src/contracts/vision';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
const reply=JSON.parse(readFileSync(new URL('../fixtures/vision-sequence-reply.json',import.meta.url),'utf8')) as EvidencePlan;

// Self-authored synthetic plan and cues retain the interval regression shape.
// This checks group sampling, without an external video or provider response.
const cues=Array.from({length:213},()=>({from:0,to:618,content:'synthetic cue'}));
const snapshot:ChatRequestSnapshot={snapshotId:'fixture',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'快速总结',modelId:'fixture',outputType:'chat',templateRevisionId:null,webEnabled:false,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[],mediaDuration:618,visionReview:1};

test('synthetic one-interval process proposal becomes two auditable state samples within the same source range',()=>{
  const result=parseEvidenceProposal(JSON.stringify(reply),618,cues,[]);
  expect(()=>validateEvidencePlan(reply,618,cues,[])).toThrow(); // canonical store stays strict
  expect(result).toHaveProperty('plan');
  if(!('plan' in result))throw Error(result.failure.code);
  const sequence=result.plan.evidence[2];
  expect(sequence.mode).toBe('sequence');
  expect(sequence.windows.map(w=>w.anchor)).toEqual([192.5,199.5]);
  for(const w of sequence.windows)expect(w).toMatchObject({from:189,to:203,cueIds:[83,84,85,86,87,88],basis:'subtitle'});
  expect(validateEvidencePlan(result.plan,618,cues,[])).toEqual(result.plan);
  expect(parseEvidenceProposal(JSON.stringify(result.plan),618,cues,[])).toEqual({plan:result.plan});
  expect(result.samplingNotes).toHaveLength(1);
  expect(result.samplingNotes?.[0]).toMatch(/189.*203.*192\.5.*199\.5/);
  const audit=allocateVisualPlan(result.plan,snapshot,[],'plan','answer');
  expect(audit.slots.length).toBeLessThanOrEqual(6);
  for(const e of result.plan.evidence){const count=audit.slots.filter(s=>s.evidenceIds.includes(e.id)).length;expect([0,e.windows.length]).toContain(count);}
  expect(audit.unresolved.some(note=>note.includes('整组证据超出'))).toBe(true);
});

test('interval expansion does not invent comparison sides or launder bad cues, ranges, anchors and frame flags',()=>{
  const base=()=>({...reply,evidence:[structuredClone(reply.evidence[2])]} as EvidencePlan);
  const run=(p:EvidencePlan)=>parseEvidenceProposal(JSON.stringify(p),618,cues,[]);
  for(const mode of ['pair','single'] as const){const p=base();p.evidence[0].mode=mode;if(mode==='pair')expect(run(p)).toMatchObject({failure:{code:'invalid-group'}});else expect(run(p)).toMatchObject({plan:p});}
  const variants:[(p:EvidencePlan)=>void,string][]=[
    [p=>{p.evidence[0].windows[0].anchor=999;},'invalid-window'],
    [p=>{p.evidence[0].windows[0].cueIds=[999];},'invalid-cue'],
    [p=>{p.evidence[0].windows[0].to=618;},'invalid-window'],
    [p=>{p.needsNewFrames=false;},'inconsistent-flags'],
    [p=>{p.evidence[0].windows[0].from=196;p.evidence[0].windows[0].to=196;},'invalid-group'],
    [p=>{p.evidence[0].reuseAttachmentIds=[crypto.randomUUID()];},'invalid-reuse']
  ];
  for(const [change,code] of variants){const p=base();change(p);expect(run(p)).toMatchObject({failure:{code}});}
  const nonIntersecting=base();
  expect(parseEvidenceProposal(JSON.stringify(nonIntersecting),618,cues.map(c=>({...c,from:500,to:501})),[])).toMatchObject({failure:{code:'invalid-cue'}});
});
