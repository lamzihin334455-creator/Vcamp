import type {EvidencePlan,VisionAudit,VisionReview} from '../contracts/vision';
import type {Cue} from '../contracts/video';
import {fixedPromptRules} from '../prompts/fixed-rules';
import {ProviderError,type ProviderMessage,type ProviderPort} from './provider-port';
import {purposePolicy} from './purpose-policy';
import {parseReview,reviewRequest} from './vision-review';
import {requestTokenBound} from './visual-selection';

/** A malformed review gets one budgeted correction, with the same actual
 * images. Transport failures never cause an automatic paid retry. */
export async function reviewVisualEvidence(input:{provider:ProviderPort;modelId:string;request:ReturnType<typeof reviewRequest>;plan:EvidencePlan;audit:VisionAudit;duration:number;cues:readonly Cue[];imageIds:readonly string[];signal:AbortSignal;tokenAllowance:number;onInvalid?:(output:string)=>Promise<void>}){
  const bound=(messages:readonly ProviderMessage[])=>requestTokenBound(messages)+purposePolicy['vision-review'].maxTokens;
  let tokenBound=0,output='',messages=input.request.messages;
  let review:VisionReview=input.request.review;
  if(!Number.isSafeInteger(input.tokenAllowance)||input.tokenAllowance<0||bound(messages)>input.tokenAllowance)return {review:{...review,status:'skipped' as const,failure:'budget' as const},tokenBound};
  let correction:VisionReview['correction'];
  for(let turn=0;turn<2;turn++){
    input.signal.throwIfAborted();output='';tokenBound+=bound(messages);
    try{
      await input.provider.stream(input.modelId,messages,input.signal,async delta=>{output+=delta;},'vision-review');
      review=parseReview(output,input.request,input.plan,input.audit,input.duration,input.cues,input.imageIds);
    }catch(error){
      input.signal.throwIfAborted();
      review={...input.request.review,status:'failed',failure:error instanceof ProviderError&&error.code==='output-limit'?'limit':'transport'};
      if(correction)correction.outcome='failed';
      break;
    }
    if(review.status==='complete'){if(correction)correction.outcome='succeeded';break;}
    await input.onInvalid?.(output);
    if(turn===1){correction!.outcome='failed';break;}
    correction={firstFailure:review.failure as 'json'|'schema'|'references',outcome:'budget'};
    const rule=fixedPromptRules['vision-review-correction'];
    messages=input.request.messages.map((m,i)=>i===0&&m.role==='system'&&typeof m.content==='string'?{...m,content:`${m.content}\n\n[${rule.priority}:${rule.id}] ${rule.title}\n${rule.text}`}:m);
    messages.push({role:'user',content:JSON.stringify({kind:'local-review-validation-feedback',failure:review.failure,rejectedReview:output})});
    if(tokenBound+bound(messages)>input.tokenAllowance)break;
  }
  return {review:{...review,...(correction?{correction}:{})},tokenBound};
}
