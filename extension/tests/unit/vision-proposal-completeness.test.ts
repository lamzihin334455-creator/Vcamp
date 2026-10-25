import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseEvidenceProposal} from '../../src/generation/vision-plan';
import {validateEvidencePlan} from '../../src/contracts/vision';

const response=readFileSync(new URL('../fixtures/vision-missing-unresolved-reply.json',import.meta.url),'utf8');
// Synthetic text with regression timing boundaries; no external video transcript.
const context=JSON.parse(readFileSync(new URL('../fixtures/vision-missing-unresolved-context.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const {cues,duration}=context;

test('diagnostic probe: supplying only the omitted list removes the schema failure, but cannot bypass cue checks',()=>{
  const original=JSON.parse(response);
  expect(()=>validateEvidencePlan(original,duration,cues,[])).toThrow();
  const complete={...original,unresolved:[]};
  expect(parseEvidenceProposal(JSON.stringify(complete),duration,cues,[])).toEqual({plan:complete});
  expect(parseEvidenceProposal(JSON.stringify(complete),duration,cues.slice(0,10),[])).toMatchObject({failure:{code:'invalid-cue'}});
});

test('synthetic complete JSON with omitted unresolved reaches a strict canonical plan with an explicit gap',()=>{
  const original=JSON.parse(response);
  expect(()=>validateEvidencePlan(original,duration,cues,[])).toThrow();
  const result=parseEvidenceProposal(response,duration,cues,[]);
  expect(result).toHaveProperty('plan');
  if(!('plan' in result))throw Error(JSON.stringify(result.failure));
  expect(result.plan.evidence).toEqual(original.evidence);
  expect(result.plan.unresolved).toHaveLength(1);
  expect(result.plan.unresolved[0]).toContain('未提供未解决项清单');
  expect(result.plan.unresolved[0]).toContain('不表示');
  expect(validateEvidencePlan(result.plan,duration,cues,[])).toEqual(result.plan);
  expect(parseEvidenceProposal(JSON.stringify(result.plan),duration,cues,[])).toEqual({plan:result.plan});
});

test('minimal omission is accepted without claiming that all visual requirements were covered',()=>{
  const result=parseEvidenceProposal('{"version":2,"scope":"focused","needsNewFrames":false,"evidence":[]}',10,[],[]);
  expect(result).toHaveProperty('plan');
  if(!('plan' in result))throw Error(JSON.stringify(result.failure));
  expect(result.plan).toMatchObject({needsNewFrames:false,evidence:[],unresolved:[expect.stringContaining('未提供未解决项清单')]});
});

test.each([null,'',{},12,Array(9).fill('gap'),['x'.repeat(181)]].map(unresolved=>({unresolved})))('explicit malformed unresolved is rejected: $unresolved',({unresolved})=>{
  const raw={...JSON.parse(response),unresolved};
  expect(parseEvidenceProposal(JSON.stringify(raw),duration,cues,[])).toMatchObject({failure:{code:'invalid-schema',fields:[expect.stringMatching(/^unresolved/)]}});
});

test.each([[],['必须核对前后状态']].map(unresolved=>({unresolved})))('explicit valid unresolved is preserved: $unresolved',({unresolved})=>{
  const raw={...JSON.parse(response),unresolved};
  expect(parseEvidenceProposal(JSON.stringify(raw),duration,cues,[])).toEqual({plan:raw});
});

test.each(['version','scope','needsNewFrames','evidence'] as const)('missing essential field %s remains invalid',field=>{
  const raw=JSON.parse(response);delete raw[field];
  expect(parseEvidenceProposal(JSON.stringify(raw),duration,cues,[])).toHaveProperty('failure');
});

test('omitted list does not repair an invalid group, time, cue, reuse, flag, or unknown field',()=>{
  const mutate=(change:(raw:any)=>void)=>{const raw=JSON.parse(response);change(raw);return parseEvidenceProposal(JSON.stringify(raw),duration,cues,[]);};
  expect(mutate(raw=>raw.evidence[0].mode='pair')).toMatchObject({failure:{code:'invalid-group'}});
  expect(mutate(raw=>raw.evidence[0].windows[0].anchor=401)).toMatchObject({failure:{code:'invalid-window'}});
  expect(mutate(raw=>raw.evidence[0].windows[0].cueIds=[999])).toMatchObject({failure:{code:'invalid-cue'}});
  expect(mutate(raw=>raw.evidence[0].reuseAttachmentIds=['00000000-0000-4000-8000-000000000000'])).toMatchObject({failure:{code:'invalid-reuse'}});
  expect(mutate(raw=>raw.needsNewFrames=false)).toMatchObject({failure:{code:'inconsistent-flags'}});
  expect(mutate(raw=>raw.extra=true)).toMatchObject({failure:{code:'invalid-schema'}});
  expect(parseEvidenceProposal(response,NaN,cues,[])).toMatchObject({failure:{code:'invalid-duration'}});
});

test('omitted explanatory list composes with continuous-interval sampling without claiming coverage',()=>{
  const raw=JSON.parse(response);raw.evidence=[raw.evidence[0]];raw.evidence[0].mode='sequence';
  const result=parseEvidenceProposal(JSON.stringify(raw),duration,cues,[]);
  if(!('plan' in result))throw Error(JSON.stringify(result.failure));
  expect(result.plan.evidence[0].windows).toHaveLength(2);
  expect(result.samplingNotes).toHaveLength(1);
  expect(result.plan.unresolved).toEqual([expect.stringContaining('不表示所有视觉需求已覆盖')]);
  expect(validateEvidencePlan(result.plan,duration,cues,[])).toEqual(result.plan);
});

test('synthetic response with rounded windows is rejected until the out-of-window references are actually corrected',()=>{
  const live=JSON.parse(readFileSync(new URL('../fixtures/vision-rounded-cues-reply.json',import.meta.url),'utf8'));
  expect(parseEvidenceProposal(JSON.stringify(live),duration,cues,[])).toEqual({failure:{code:'invalid-cue',fields:['evidence.0.windows.0.cueIds']}});
  // A controlled diagnostic change, not a host repair: remove only the known
  // nonintersecting references and demonstrate the separate failure cause.
  live.evidence[0].windows[0].cueIds=live.evidence[0].windows[0].cueIds.filter((id:number)=>id!==31);
  expect(parseEvidenceProposal(JSON.stringify(live),duration,cues,[])).toEqual({failure:{code:'invalid-cue',fields:['evidence.4.windows.0.cueIds']}});
  live.evidence[4].windows[0].cueIds=live.evidence[4].windows[0].cueIds.filter((id:number)=>id!==237&&id!==238);
  expect(parseEvidenceProposal(JSON.stringify(live),duration,cues,[])).toHaveProperty('plan');
});
