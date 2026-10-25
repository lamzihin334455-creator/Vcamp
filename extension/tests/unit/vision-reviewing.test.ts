import {expect,test} from 'vitest';
import {reviewVisualEvidence} from '../../src/generation/vision-reviewing';
import {reviewRequest} from '../../src/generation/vision-review';
import {allocateVisualPlan,requestTokenBound} from '../../src/generation/visual-selection';
import {ProviderError,type ProviderPort} from '../../src/generation/provider-port';
import {purposePolicy} from '../../src/generation/purpose-policy';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import type {EvidencePlan} from '../../src/contracts/vision';
import type {Attachment} from '../../src/contracts/attachment';
import {png} from '../fixtures/png';

const snapshot:ChatRequestSnapshot={snapshotId:'test',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'总结',outputType:'chat',modelId:'fixture',webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[]};
const cues=[{from:1.234,to:3.456,content:'展示结果'}];
const plan:EvidencePlan={version:2,scope:'focused',needsNewFrames:true,unresolved:[],evidence:[{id:'e1',need:'查看结果',priority:'required',mode:'single',reuseAttachmentIds:[],windows:[{from:1.234,to:3.456,anchor:2.345,cueIds:[0],basis:'subtitle'}],detailNeed:'overview',reason:'核心结果'}]};
const valid=JSON.stringify({version:2,results:[{evidenceId:'e1',status:'partial',imageRefs:['i0'],observations:['结果页可见'],missing:'小字无法确认',refinements:[]}]});
function fixture(outputs:(string|Error)[]){
  const audit=allocateVisualPlan(plan,snapshot,[],'字幕','总结'),id=crypto.randomUUID();
  const images=[{id,time:2.345,dataUrl:png(),width:2,height:2,bytes:100} as Attachment];
  audit.frames.push({slotKey:'e1_0',attachmentId:id,time:2.345,detail:'low'});
  const request=reviewRequest(snapshot,plan,audit,images,cues,10,{}),calls:any[]=[];
  const provider:ProviderPort={async stream(_model,m,signal,delta,purpose){calls.push({messages:structuredClone(m),purpose});signal.throwIfAborted();const output=outputs[calls.length-1];if(output instanceof Error)throw output;if(output===undefined)throw Error('third call');await delta(output);}};
  const run=(extra:Partial<Parameters<typeof reviewVisualEvidence>[0]>={})=>reviewVisualEvidence({provider,modelId:'fixture',request,plan,audit,cues,duration:10,imageIds:[],signal:new AbortController().signal,tokenAllowance:100000,...extra});
  return {run,calls,request,audit};
}

test('a valid review needs one call and preserves partial findings',async()=>{
  const f=fixture([valid]),r=await f.run();expect(r.review.status).toBe('complete');expect(r.review.results[0].status).toBe('partial');expect(f.calls).toHaveLength(1);expect(r.tokenBound).toBe(requestTokenBound(f.request.messages)+purposePolicy['vision-review'].maxTokens);
});
test('one correction resends actual images and retains the rejected review without waiving validation',async()=>{
  const invalid=JSON.parse(valid);invalid.results[0].status='sufficient';
  const f=fixture([JSON.stringify(invalid),valid]),traces:string[]=[];
  const r=await f.run({onInvalid:async output=>{traces.push(output);}});
  expect(f.calls).toHaveLength(2);expect(traces).toHaveLength(1);expect(r.review).toMatchObject({status:'complete',correction:{firstFailure:'references',outcome:'succeeded'}});
  expect(f.calls[1].messages[1]).toEqual(f.request.messages[1]);expect(f.calls[1].messages[0].content).toContain('[P1:vision-review-correction]');expect(r.tokenBound).toBeGreaterThan(2*(requestTokenBound(f.request.messages)+purposePolicy['vision-review'].maxTokens));
});
test('two invalid reviews leave no results or repairs and never make a third call',async()=>{
  const f=fixture(['{','{}']),r=await f.run();expect(f.calls).toHaveLength(2);expect(r.review).toMatchObject({status:'failed',failure:'schema',results:[],repairs:[],correction:{firstFailure:'json',outcome:'failed'}});
});
test('budget prevents correction and counts only sent requests',async()=>{
  const f=fixture(['{']),bound=requestTokenBound(f.request.messages)+purposePolicy['vision-review'].maxTokens;
  const r=await f.run({tokenAllowance:bound});expect(f.calls).toHaveLength(1);expect(r.tokenBound).toBe(bound);expect(r.review.correction?.outcome).toBe('budget');
  const skipped=await fixture([]).run({tokenAllowance:bound-1});expect(skipped.review).toMatchObject({status:'skipped',failure:'budget'});expect(skipped.tokenBound).toBe(0);
});
test('transport errors are not retried and correction abort propagates',async()=>{
  const f=fixture([new ProviderError('network')]);expect((await f.run()).review).toMatchObject({status:'failed',failure:'transport'});expect(f.calls).toHaveLength(1);
  const controller=new AbortController(),g=fixture(['{',valid]);await expect(g.run({signal:controller.signal,onInvalid:async()=>controller.abort()})).rejects.toMatchObject({name:'AbortError'});expect(g.calls).toHaveLength(1);
});
