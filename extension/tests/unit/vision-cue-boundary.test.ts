import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {parseEvidenceProposal} from '../../src/generation/vision-plan';
import {validateEvidencePlan} from '../../src/contracts/vision';
import {planVisualEvidence} from '../../src/generation/vision-planning';
import type {ProviderMessage,ProviderPort} from '../../src/generation/provider-port';

const text=readFileSync(new URL('../fixtures/vision-plan-nine-cues.json',import.meta.url),'utf8');
// The proposal is the user's supplied response. Original subtitles were not
// supplied: these are clearly synthetic timings, never reconstructed transcript.
const cues=Array.from({length:200},(_,id)=>({from:id*2+.125,to:id*2+1.875,content:`合成字幕 ${id}`}));
const parse=(p:unknown)=>parseEvidenceProposal(JSON.stringify(p),407,cues,[]);

test('the actual nine-reference response preserves every evidence target and exact window without blocking planning',()=>{
  const result=parseEvidenceProposal(text,407,cues,[]);
  if(!('plan' in result))throw Error(JSON.stringify(result));
  const original=JSON.parse(text),window=result.plan.evidence[4].windows[0];
  expect(result.plan.evidence).toHaveLength(8);
  expect(result.plan.evidence.map(e=>e.checkTargets)).toEqual(original.evidence.map((e:any)=>e.checkTargets));
  expect(window).toMatchObject({from:cues[82].from,to:cues[91].to,anchor:(cues[85].from+cues[85].to)/2,basis:'subtitle'});
  expect(window.cueIds).toHaveLength(8);expect(window.cueIds).toEqual(expect.arrayContaining([82,85,91]));
  expect(result.plan.unresolved).toEqual(original.unresolved);expect(result.samplingNotes?.join('')).toContain('9');
  expect(validateEvidencePlan(result.plan,407,cues,[])).toEqual(result.plan);
  const invalidStoredPlan=structuredClone(result.plan);
  invalidStoredPlan.evidence[4].windows[0].cueIds=original.evidence[4].windows[0].cueIds;
  expect(()=>validateEvidencePlan(invalidStoredPlan,407,cues,[])).toThrow();
});

test('all original references are validated before reducing canonical provenance, including ones that would be omitted',()=>{
  for(const bad of [[82,83,84,85,999,88,89,90,91],[82,83,84,85,85,88,89,90,91]]){
    const p=JSON.parse(text);p.evidence[4].windows[0].cueIds=bad;
    expect(parse(p)).toMatchObject({failure:{code:'invalid-cue',fields:['evidence.4.windows.0.cueIds']}});
  }
  const p=JSON.parse(text);p.evidence[4].windows[0].anchorCueId=87;
  expect(parse(p)).toMatchObject({failure:{code:'invalid-cue'}});
});

test('bounded longer proposals preserve the implicit anchor, sequence expansion and strict canonical reference limit',()=>{
  const p=JSON.parse(text);p.evidence=[p.evidence[4]];
  p.evidence[0].mode='sequence';p.evidence[0].windows=[{cueIds:Array.from({length:64},(_,i)=>i)}];
  const r=parse(p);if(!('plan' in r))throw Error(JSON.stringify(r));
  expect(r.plan.evidence[0].windows).toHaveLength(2);
  expect(r.plan.evidence[0].windows.every(w=>w.cueIds.length===8)).toBe(true);
  expect(r.samplingNotes).toHaveLength(1);expect(r.samplingNotes![0].length).toBeLessThanOrEqual(220);
  const single=structuredClone(p);single.evidence[0].mode='single';
  expect(parse(single)).toMatchObject({plan:{evidence:[{windows:[{anchor:(cues[32].from+cues[32].to)/2}]}]}});
  p.evidence[0].windows[0].cueIds.push(64);expect(parse(p)).toHaveProperty('failure');
});

test('one correction receives concrete cue limits and input range, then validates a replacement without an extra call',async()=>{
  const calls:ProviderMessage[][]=[],invalid=JSON.parse(text);invalid.evidence[4].windows[0].cueIds=[];
  const provider:ProviderPort={async stream(_model,m,_signal,delta){calls.push(structuredClone([...m]));await delta(calls.length===1?JSON.stringify(invalid):text);}};
  const messages:ProviderMessage[]=[{role:'system',content:'规划协议'},{role:'user',content:'原始任务与字幕'}];
  const result=await planVisualEvidence({provider,modelId:'fixture',messages,signal:new AbortController().signal,duration:407,cues,imageIds:[],tokenAllowance:100000,requireCheckTargets:true});
  expect(calls).toHaveLength(2);expect(calls[1][1]).toEqual(messages[1]);
  expect(JSON.parse(calls[1].at(-1)!.content as string)).toMatchObject({constraints:{cueIds:{minItems:1,maxItems:64,minId:0,maxId:199,unique:true},canonicalCueIdsMax:8}});
  expect(result.result).toHaveProperty('plan');expect(result.correction?.outcome).toBe('succeeded');
});
