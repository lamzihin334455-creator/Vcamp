import {fixedPromptRules} from '../prompts/fixed-rules';
import {ProviderError,type ProviderMessage,type ProviderPort} from './provider-port';
import {ZodError} from 'zod';

function validationFeedback(error:unknown){
 if(error instanceof SyntaxError)return '具体失败：JSON 语法不完整或无效。';
 if(error instanceof ZodError){
  const fields=new Set(['terms','canonical','variants','target','changes','cues','index','from','to','content','approved']);
  return '具体失败：'+error.issues.slice(0,6).map(issue=>`${issue.path.map(part=>typeof part==='number'?part:fields.has(String(part))?part:'?').join('.')||'根对象'} (${issue.code})`).join('；')+'。';
 }
 if(error instanceof Error&&error.message==='invalid changes')return '具体失败：changes 中出现了重复或不属于本批的 index。';
 if(error instanceof Error&&error.message==='invalid translation')return '具体失败：cues 的条数、顺序、index 或 from/to 与本批输入不一致。';
 if(error instanceof Error&&error.message==='invalid correction review')return '具体失败：approved 包含重复或不属于本次 edits 的 id。只选择现有 id，不生成内容。';
 return '具体失败：术语的候选来源或归属关系无效，请核对原始候选，删除无关或冲突变体。';
}

// Only a complete outer JSON fence is decoration. Never extract a partial
// object from prose or manufacture missing rows, indexes or timestamps.
export async function subtitleResponse<T>(provider:ProviderPort,modelId:string,messages:readonly ProviderMessage[],signal:AbortSignal,validate:(value:unknown)=>T,recover=true):Promise<T>{
 let request=messages;
 for(let attempt=0;attempt<(recover?2:1);attempt++){
  let output='';
  await provider.stream(modelId,request,signal,async delta=>{output+=delta;if(output.length>100000)throw new ProviderError('output-limit');},'subtitle');
  signal.throwIfAborted();
  const text=output.trim(),fenced=recover?/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text):null;
  try{return validate(JSON.parse(fenced?fenced[1]:text));}
  catch(error){
   if(!recover||attempt===1)throw new ProviderError('protocol');
   // Retry just this stage/batch, once. Transport/auth/size errors above are
   // never retried and no partial result is published.
   request=[...messages,{role:'assistant',content:output},{role:'user',content:fixedPromptRules['subtitle-repair'].text+'\n'+validationFeedback(error)}];
  }
 }
 throw new ProviderError('protocol');
}
