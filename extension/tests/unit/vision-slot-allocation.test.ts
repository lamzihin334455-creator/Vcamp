import {expect,test} from 'vitest';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import type {ProviderPort} from '../../src/generation/provider-port';
import {planVisualEvidence} from '../../src/generation/vision-planning';
import {allocateVisualPlan} from '../../src/generation/visual-selection';

const cues=Array.from({length:8},(_,i)=>({from:i*5+1,to:i*5+4,content:`证据 ${i}`}));
const snapshot:ChatRequestSnapshot={snapshotId:'fixture',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'整理知识笔记',modelId:'fixture',outputType:'markdown',templateRevisionId:null,webEnabled:false,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[],mediaDuration:45,visionReview:2};
const item=(i:number,cueId=i)=>({need:`画面需求 ${i}`,priority:i===7?'optional':'required',mode:'single',windows:[{cueIds:[cueId]}],detailNeed:'overview',checkTargets:[`主体 ${i}`],reason:'字幕定位'});
const proposal=(evidence:unknown[])=>({version:3,scope:'whole-video',evidence,unresolved:[]});
async function plan(value:unknown){
 const calls:string[]=[],invalid:string[]=[];
 const provider:ProviderPort={async stream(_model,_messages,_signal,delta,purpose){calls.push(purpose!);await delta(JSON.stringify(value));}};
 const result=await planVisualEvidence({provider,modelId:'fixture',messages:[{role:'system',content:'规划最多6个新帧槽位'}],signal:new AbortController().signal,duration:45,cues,imageIds:[],tokenAllowance:524288,maxNewFrames:6,requireCheckTargets:true,onInvalid:async(_output,failure)=>{invalid.push(failure.code);}});
 return {...result,calls,invalid};
}

test('a valid oversized proposal reaches whole-group allocation instead of repeating the screenshot plan failure',async()=>{
 const result=await plan(proposal(Array.from({length:8},(_,i)=>item(i))));
 expect(result.result).toHaveProperty('plan');
 expect(result.calls).toEqual(['vision-plan']);expect(result.invalid).toEqual([]);expect(result.correction).toBeUndefined();
 if(!('plan' in result.result))throw Error(result.result.failure.code);
 const evidencePlan=result.result.plan;
 const audit=allocateVisualPlan(evidencePlan,snapshot,[],'plan','final');
 expect(audit.slots).toHaveLength(6);expect(audit.unresolved).toHaveLength(2);
 expect(audit.unresolved.every(text=>text.includes('整组证据超出'))).toBe(true);
 expect(audit.slots.every(slot=>evidencePlan.evidence.find(e=>e.id===slot.group)?.priority==='required')).toBe(true);
});

test('eight independent checks of the same window share one slot before enforcing capacity',async()=>{
 const result=await plan(proposal(Array.from({length:8},(_,i)=>item(i,0))));
 expect(result.result).toHaveProperty('plan');expect(result.calls).toHaveLength(1);
 if(!('plan' in result.result))throw Error(result.result.failure.code);
 const audit=allocateVisualPlan(result.result.plan,snapshot,[],'plan','final');
 expect(audit.slots).toHaveLength(1);expect(audit.slots[0].evidenceIds).toHaveLength(8);expect(audit.unresolved).toEqual([]);
});

test('expanded sequences remain whole when a valid proposal exceeds capture capacity',async()=>{
 const result=await plan(proposal([...Array.from({length:3},(_,i)=>({...item(i),mode:'sequence'})),...Array.from({length:2},(_,i)=>item(i+3))]));
 expect(result.result).toHaveProperty('plan');expect(result.calls).toHaveLength(1);
 if(!('plan' in result.result))throw Error(result.result.failure.code);
 const audit=allocateVisualPlan(result.result.plan,snapshot,[],'plan','final');
 expect(audit.slots.length).toBeLessThanOrEqual(6);expect(audit.unresolved.length).toBeGreaterThan(0);
 for(const e of result.result.plan.evidence)expect([0,e.windows.length]).toContain(audit.slots.filter(s=>s.evidenceIds.includes(e.id)).length);
});
