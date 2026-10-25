import {expect,test} from 'vitest';
import {planVisualEvidence,visionPlanningInput} from '../../src/generation/vision-planning';
import {ProviderError,type ProviderMessage,type ProviderPort} from '../../src/generation/provider-port';
import {requestTokenBound} from '../../src/generation/visual-selection';
import {purposePolicy} from '../../src/generation/purpose-policy';

const valid=JSON.stringify({version:3,scope:'focused',evidence:[],unresolved:[]});
const messages:ProviderMessage[]=[{role:'system',content:'[P1:vision-plan] 原协议'},{role:'user',content:'原始任务与字幕'}];
const bound=(m:readonly ProviderMessage[])=>requestTokenBound(m)+purposePolicy['vision-plan'].maxTokens;
function sample(outputs:(string|Error)[]){
  const calls:{messages:readonly ProviderMessage[];purpose?:string}[]=[];
  const provider:ProviderPort={async stream(_model,m,signal,delta,purpose){calls.push({messages:structuredClone(m),purpose});signal.throwIfAborted();const output=outputs[calls.length-1];if(output instanceof Error)throw output;if(output===undefined)throw Error('unexpected third call');await delta(output);}};
  const run=(extra:Partial<Parameters<typeof planVisualEvidence>[0]>={})=>planVisualEvidence({provider,modelId:'fixture',messages,signal:new AbortController().signal,duration:10,cues:[],imageIds:[],tokenAllowance:100000,...extra});
  return {calls,run};
}

test('valid first proposal spends exactly one call and no correction reserve',async()=>{
  const f=sample([valid]);const r=await f.run();expect(r.result).toHaveProperty('plan');expect(r.correction).toBeUndefined();expect(f.calls).toHaveLength(1);expect(r.tokenBound).toBe(bound(messages));
});

test('one protocol correction preserves original task, traces the failure, and accounts for both full requests',async()=>{
  const f=sample(['{',valid]),invalid:string[]=[];
  const r=await f.run({onInvalid:async text=>{invalid.push(text);}});
  expect(f.calls).toHaveLength(2);expect(invalid).toEqual(['{']);expect(r.correction).toMatchObject({outcome:'succeeded',firstFailure:{code:'invalid-json'}});
  expect(f.calls[1].purpose).toBe('vision-plan');expect(f.calls[1].messages[1]).toEqual(messages[1]);
  expect(f.calls[1].messages[0].content).toContain('[P1:vision-plan-correction]');expect(JSON.parse(f.calls[1].messages[2].content as string)).toMatchObject({kind:'local-validation-feedback',rejectedProposal:'{'});
  expect(r.tokenBound).toBe(bound(messages)+bound(f.calls[1].messages));expect(messages[0].content).not.toContain('校正');
});

test('a second invalid proposal is reported without any third call',async()=>{
  const f=sample(['{','{}']),failures:string[]=[];
  const r=await f.run({onInvalid:async output=>{failures.push(output);}});
  expect(f.calls).toHaveLength(2);expect(failures).toEqual(['{','{}']);expect(r.result).toMatchObject({failure:{code:'invalid-schema'}});expect(r.correction?.outcome).toBe('failed');
});

test('new requests require explicit check targets, correct once, and retain legacy compatibility',async()=>{
  const proposal={version:3,scope:'focused',evidence:[{need:'高度、复选框和边框差异',priority:'required',mode:'single',windows:[{cueIds:[0]}],detailNeed:'overview',reason:'分别核实细节'}],unresolved:[]};
  const fixed={...proposal,evidence:proposal.evidence.map(e=>({...e,checkTargets:['高度','复选框','边框']}))};
  const extra={requireCheckTargets:true,cues:[{from:1,to:4,content:'主题设置差异'}]};
  const f=sample([JSON.stringify(proposal),JSON.stringify(fixed)]),r=await f.run(extra);
  expect(r.correction).toMatchObject({firstFailure:{code:'invalid-schema',fields:['evidence.0.checkTargets']},outcome:'succeeded'});
  expect(r.result).toHaveProperty('plan.evidence.0.checkTargets',['高度','复选框','边框']);expect(f.calls).toHaveLength(2);
  const rejected=sample([JSON.stringify(proposal),JSON.stringify(proposal)]);
  expect((await rejected.run(extra)).result).toHaveProperty('failure');expect(rejected.calls).toHaveLength(2);
  expect((await sample([JSON.stringify(proposal)]).run({cues:extra.cues})).result).toHaveProperty('plan');
});

test('valid expanded state groups reach bounded allocation without a protocol correction',async()=>{
  const proposal={version:3,scope:'focused',evidence:[{need:'观察过程',priority:'required',mode:'sequence',windows:[{cueIds:[0]}],detailNeed:'overview',reason:'过程变化'}],unresolved:[]};
  const f=sample([JSON.stringify(proposal),valid]);
  const r=await f.run({maxNewFrames:1,cues:[{from:1,to:4,content:'过程'}]});
  expect(r.result).toHaveProperty('plan.evidence.0.windows');expect(r.correction).toBeUndefined();expect(f.calls).toHaveLength(1);
});

test('budget stops before the initial request or before the correction',async()=>{
  const f=sample(['{']);await expect(f.run({tokenAllowance:bound(messages)-1})).rejects.toMatchObject({code:'context-limit'});expect(f.calls).toHaveLength(0);
  const r=await f.run({tokenAllowance:bound(messages)});expect(f.calls).toHaveLength(1);expect(r.correction?.outcome).toBe('budget');expect(r.tokenBound).toBe(bound(messages));expect(r.result).toHaveProperty('failure');
  for(const tokenAllowance of [NaN,Infinity,-1,2.5])await expect(f.run({tokenAllowance})).rejects.toMatchObject({code:'context-limit'});expect(f.calls).toHaveLength(1);
});

test('planning task boundary keeps the final template and transcript separate from the current output stage',()=>{
  const text=visionPlanningInput({template:{name:'快速总结',requirements:'总结五点'}},[{from:1,to:3,content:'实际字幕'}]);
  expect(text).toContain('总结五点');expect(text).toContain('实际字幕');expect(text).toContain('不生成总结或最终回答');expect(text.indexOf('以上为资料')).toBeGreaterThan(text.indexOf('实际字幕'));
});

test('future protocol versions, invalid duration and first transport errors are never retried',async()=>{
  for(const [output,extra] of [[JSON.stringify({version:4}),{}],[valid,{duration:NaN}]] as const){const f=sample([output]);expect((await f.run(extra)).result).toHaveProperty('failure');expect(f.calls).toHaveLength(1);}
  const f=sample([new ProviderError('network')]);await expect(f.run()).rejects.toMatchObject({code:'network'});expect(f.calls).toHaveLength(1);
});

test('correction transport failure keeps the original failure and abort is propagated',async()=>{
  const f=sample(['{',new ProviderError('network')]);const r=await f.run();expect(r.result).toMatchObject({failure:{code:'invalid-json'}});expect(r.correction?.outcome).toBe('failed');expect(f.calls).toHaveLength(2);
  const controller=new AbortController(),g=sample(['{',valid]);await expect(g.run({signal:controller.signal,onInvalid:async()=>controller.abort()})).rejects.toMatchObject({name:'AbortError'});expect(g.calls).toHaveLength(2);
});
