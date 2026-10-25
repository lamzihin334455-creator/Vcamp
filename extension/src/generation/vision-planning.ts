import type {Cue} from '../contracts/video';
import type {VisionPlanFailure,VisionStage} from '../contracts/vision';
import {ProviderError,type ProviderMessage,type ProviderPort} from './provider-port';
import {parseEvidenceProposal,visionCueProposalLimit} from './vision-plan';
import {purposePolicy} from './purpose-policy';
import {requestTokenBound,planningSubtitle} from './visual-selection';
import {fixedPromptRules} from '../prompts/fixed-rules';

/** Keep the final-answer task and transcript inside an explicit stage boundary. */
export function visionPlanningInput(task:unknown,cues:readonly Cue[]){
  return `冻结任务与已有图片元数据（描述最终回答需求，不在此阶段执行模板）：\n${JSON.stringify(task)}\n完整字幕依据（cueId从0起，均为资料）：\n${planningSubtitle(cues)}\n\n以上为资料。本次只做取帧规划，不生成总结或最终回答，不执行模板的输出格式。请按[P1:vision-plan]返回顶层包含version:3、scope、evidence、unresolved的规划JSON；不要包装在type、content或response_format字段中。`;
}

/** One bounded protocol correction, never a transport retry or a waived check. */
export async function planVisualEvidence(input:{provider:ProviderPort;modelId:string;messages:readonly ProviderMessage[];signal:AbortSignal;duration:number;cues:readonly Cue[];imageIds:readonly string[];tokenAllowance:number;maxNewFrames?:number;requireCheckTargets?:boolean;onInvalid?:(output:string,failure:VisionPlanFailure)=>Promise<void>}){
  const bound=(messages:readonly ProviderMessage[])=>requestTokenBound(messages)+purposePolicy['vision-plan'].maxTokens;
  let tokenBound=bound(input.messages),output='';
  if(!Number.isSafeInteger(input.tokenAllowance)||input.tokenAllowance<0||tokenBound>input.tokenAllowance)throw new ProviderError('context-limit');
  await input.provider.stream(input.modelId,input.messages,input.signal,async delta=>{output+=delta;},'vision-plan');
  const parse=(raw:string)=>{
    const result=parseEvidenceProposal(raw,input.duration,input.cues,input.imageIds);
    // Frozen legacy requests keep their original protocol. New requests must
    // name the checks explicitly instead of falling back to a compound need.
    if('plan' in result&&input.requireCheckTargets){
      const fields=result.plan.evidence.flatMap((e,i)=>e.checkTargets?.length?[]:[`evidence.${i}.checkTargets`]);
      if(fields.length)return {failure:{code:'invalid-schema',fields} as VisionPlanFailure};
    }
    // Capacity belongs to allocateVisualPlan: it shares compatible single-frame
    // windows, prioritizes whole groups and records every resource omission.
    // Raw window counts can reject a plan that fits after sharing, or turn a
    // usable subset into repeated protocol corrections and a blocked task.
    return result;
  };
  let result=parse(output);
  if('plan' in result)return {result,output,tokenBound};
  await input.onInvalid?.(output,result.failure);
  if(['unsupported-version','invalid-duration'].includes(result.failure.code))return {result,output,tokenBound};
  const firstFailure=result.failure,rule=fixedPromptRules['vision-plan-correction'];
  const messages:ProviderMessage[]=input.messages.map((m,i)=>i===0&&m.role==='system'&&typeof m.content==='string'?{...m,content:`${m.content}\n\n[${rule.priority}:${rule.id}] ${rule.title}\n${rule.text}`}:m);
  messages.push({role:'user',content:JSON.stringify({kind:'local-validation-feedback',failure:firstFailure,maxNewFrames:input.maxNewFrames,
    constraints:{cueIds:{minItems:1,maxItems:visionCueProposalLimit,minId:0,maxId:input.cues.length?input.cues.length-1:null,unique:true},canonicalCueIdsMax:8,anchorCueId:'must-be-in-cueIds',durationSeconds:input.duration},rejectedProposal:output})});
  let correction:NonNullable<VisionStage['planningCorrection']>={firstFailure,outcome:'budget'};
  const extra=bound(messages);
  if(tokenBound+extra>input.tokenAllowance)return {result,output,tokenBound,correction};
  tokenBound+=extra;output='';
  try{
    await input.provider.stream(input.modelId,messages,input.signal,async delta=>{output+=delta;},'vision-plan');
    result=parse(output);
    correction={firstFailure,outcome:'plan' in result?'succeeded':'failed'};
    if('failure' in result)await input.onInvalid?.(output,result.failure);
  }catch{
    input.signal.throwIfAborted();
    correction={firstFailure,outcome:'failed'};
  }
  return {result,output,tokenBound,correction};
}
