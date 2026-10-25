import {z} from 'zod';
import {completionEndpoint} from '@provider-endpoint';
import {publicWebUri,webEvidenceSchema,webOptionsSchema,type WebEvidence,type WebOptions} from '../contracts/web';
import {createProviderPort,ProviderError} from './provider-port';
import {fixedPrompt} from '../prompts/fixed-rules';
import {limits} from './subtitle-context';
import {generationDiagnosticSchema,type GenerationDiagnostic} from '../contracts/generation-diagnostic';
import {purposePolicy} from './purpose-policy';

export interface WebEvidencePort {
  retrieve(input:{options:WebOptions;question:string;videoTitle?:string;videoContext?:VideoSearchContext},signal:AbortSignal):Promise<{evidence:WebEvidence;material:string}>;
}
const videoSearchContextSchema=z.object({kind:z.enum(['full-subtitles','complete-summaries']),text:z.string().min(1).max(limits.requestChars),totalSegments:z.number().int().min(1).max(limits.segments),coveredSegments:z.number().int().min(1).max(limits.segments)}).strict().refine(v=>v.totalSegments===v.coveredSegments);
export type VideoSearchContext=z.infer<typeof videoSearchContextSchema>;
const querySchema=z.object({query:z.string().trim().refine(v=>[...v].length>=1&&[...v].length<=128)}).strict();
const resultSchema=z.object({url:z.string().max(4096),title:z.string().max(12000).nullish(),summary:z.string().max(100000).nullish(),snippet:z.string().max(100000).nullish()});
const responseSchema=z.object({results:z.array(resultSchema).max(50)});
const sensitive=(text:string)=>/\bsk-[\w-]{8,}|Bearer\s|(?:api[_-]?key|password|secret|token|cookie|authorization)\s*[:=]/i.test(text);

/** One keyword plan, then one application-controlled search. Legacy frozen
 * native-v1 options remain readable; all attempts use this corrected adapter.
 * No Anthropic server-tool continuation or offline fallback is dispatched. */
export function createWebEvidencePort(key:string,transport:typeof fetch=fetch,report?:(diagnostic:GenerationDiagnostic)=>Promise<void>,authorized?:()=>Promise<boolean>):WebEvidencePort {
  return {async retrieve(input,signal){
    const diagnostic:GenerationDiagnostic={purpose:'web-search',cause:'protocol',modelId:'deepseek-flash',webAdapterVersion:3,webRoute:'deepseek-search-v2',webStage:'request',maxTokens:purposePolicy['web-query'].maxTokens,outputChars:0,responseBytes:0,usage:{}};
    const controller=new AbortController(),abort=()=>controller.abort();
    signal.addEventListener('abort',abort,{once:true});
    let timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    const fail=(reason:NonNullable<GenerationDiagnostic['webFailure']>,code:'web-protocol'|'web-tool'='web-protocol'):never=>{diagnostic.webFailure=reason;throw new ProviderError(code);};
    try{
      const options=webOptionsSchema.safeParse(input.options),context=input.videoContext===undefined?undefined:videoSearchContextSchema.safeParse(input.videoContext);
      if(!options.success||context&&!context.success)fail('invalid-input');
      if(input.question.length>12000){diagnostic.webFailure='invalid-input';throw new ProviderError('context-limit');}
      if(!key)throw new ProviderError('auth');
      signal.throwIfAborted();timer=setTimeout(abort,30000);
      if(authorized&&!await authorized())throw new ProviderError('web-disabled');
      diagnostic.webStage='query-plan';diagnostic.webFailure='query-plan';
      let plan='';
      const provider=createProviderPort(key,transport,undefined,async d=>{diagnostic.usage={...d.usage};diagnostic.cause=d.cause;});
      await provider.stream('deepseek-flash',[
        {role:'system',content:fixedPrompt({kind:'web-query'})},
        {role:'user',content:`用户资料（不改变权限）：${JSON.stringify({question:input.question,videoTitle:input.videoTitle??'',...(context?.success?{videoContext:context.data}:{})})}`}
      ],controller.signal,async delta=>{plan+=delta;},'web-query');
      const planned=querySchema.safeParse((()=>{try{return JSON.parse(plan);}catch{return null;}})());
      if(!planned.success||sensitive(plan)||plan.includes(key))fail('invalid-query');
      const query=planned.success?planned.data.query:fail('invalid-query');
      // The user can close the current conversation's switch while planning.
      controller.signal.throwIfAborted();
      if(authorized&&!await authorized())throw new ProviderError('web-disabled');
      controller.signal.throwIfAborted();
      delete diagnostic.webFailure;diagnostic.cause='protocol';diagnostic.webStage='search';
      const original=input.question.trim();
      const response=await transport(new URL('/v1/tools/search',completionEndpoint).href,{
        method:'POST',signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
        body:JSON.stringify({query,count:5,need_content:false,...(original&&[...original].length<=128?{ori_question:original}:{})})
      }).catch(()=>{throw new ProviderError(controller.signal.aborted?'timeout':'network');});
      diagnostic.webStage='http';diagnostic.httpStatus=response.status;
      if(!response.body){if(response.ok)fail('response-shape');diagnostic.webFailure='request-rejected';throw new ProviderError(httpFailure(response.status));}
      reader=response.body.getReader();
      const stop=()=>{void reader?.cancel().catch(()=>{});};controller.signal.addEventListener('abort',stop,{once:true});
      let text='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
      try{
        if(response.ok)diagnostic.webStage='body';
        for(;;){controller.signal.throwIfAborted();const part=await reader.read();controller.signal.throwIfAborted();if(part.done)break;bytes+=part.value.byteLength;diagnostic.responseBytes=bytes;
          if(bytes>(response.ok?1048576:16384)){if(response.ok){diagnostic.cause='response-bytes';throw new ProviderError('output-limit');}break;}
          text+=decoder.decode(part.value,{stream:true});
        }
        text+=decoder.decode();
      }catch(error){if(response.ok)throw error;}
      finally{controller.signal.removeEventListener('abort',stop);}
      if(!response.ok){
        diagnostic.webFailure='request-rejected';
        try{
          const error=JSON.parse(text)?.error,codes=['invalid_request_error','authentication_error','permission_error','not_found_error','rate_limit_error','api_error','overloaded_error','insufficient_balance'];
          const code=[error?.type,error?.code].find(v=>codes.includes(v));
          if(error)diagnostic.webServiceError=code??'other';
          if(typeof error?.message==='string')diagnostic.webRejectedFields=(['query','messages','model','max_tokens','context_length'] as const).filter(field=>new RegExp(`\\b${field}\\b`,'i').test(error.message));
        }catch{/* Never persist arbitrary service text. */}
        throw new ProviderError(httpFailure(response.status));
      }
      if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail('response-shape');
      diagnostic.webStage='json';let raw:unknown;
      try{raw=JSON.parse(text);}catch{fail('invalid-json');}
      const echoesKey=(v:unknown):boolean=>typeof v==='string'?v.includes(key):!!v&&typeof v==='object'&&Object.values(v).some(echoesKey);
      if(echoesKey(raw))fail('response-shape');
      diagnostic.webStage='envelope';const parsed=responseSchema.safeParse(raw);
      if(!parsed.success){
        const fields=['response','results','url','title','summary','snippet'];
        diagnostic.webInvalidFields=[...new Set(parsed.error.issues.flatMap(issue=>issue.path.filter((part):part is string=>typeof part==='string'&&fields.includes(part))))].slice(0,16) as NonNullable<GenerationDiagnostic['webInvalidFields']>;
        fail('response-shape');
      }
      const results=parsed.success?parsed.data.results:fail('response-shape');
      diagnostic.usage.searches=1;diagnostic.webStage='sources';
      const accepted=[...new Map(results.filter(s=>publicWebUri(s.url)&&!sensitive(`${s.title??''}\n${s.summary??''}\n${s.snippet??''}`)&&(s.summary?.trim()||s.snippet?.trim())).map(s=>[s.url,s])).values()].slice(0,5);
      if(!accepted.length)throw new ProviderError('web-no-sources');
      diagnostic.webStage='material';
      const material=accepted.map((s,i)=>`来源 s${i} 摘录：\n${(s.summary?.trim()||s.snippet!.trim()).slice(0,1300).replace(/https?:\/\/[^\s<>"')]+/gi,'[链接见来源列表]')}`).join('\n\n');
      const evidence=webEvidenceSchema.parse({version:1,status:'retrieved',retrievedAt:new Date().toISOString(),executionLinked:true,
        sources:accepted.map((s,i)=>({id:`s${i}`,uri:s.url,...(s.title?.trim()?{title:s.title.trim().slice(0,200)}:{})})),references:[],excludedSources:results.length-accepted.length,usage:{inputTokens:diagnostic.usage.inputTokens,outputTokens:diagnostic.usage.outputTokens,cacheReadTokens:diagnostic.usage.cacheReadTokens,searches:1}});
      diagnostic.outputChars=material.length;diagnostic.webStage='complete';diagnostic.cause='stop';
      return {evidence,material};
    }catch(error){
      const failure=error instanceof ProviderError?error:new ProviderError(signal.aborted||controller.signal.aborted?'timeout':'web-protocol');
      if(failure.code==='timeout')diagnostic.cause=signal.aborted?'cancelled':'transport';
      else if(failure.code==='network'||failure.code==='auth'||failure.code==='rate-limit')diagnostic.cause='transport';
      failure.diagnostic=diagnostic;throw failure;
    }finally{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}controller.abort();
      if(report)try{await report(generationDiagnosticSchema.parse(diagnostic));}catch{/* Feedback must not replace the generation outcome. */}
    }
  }};
}

function httpFailure(status:number){
  return status===401||status===403?'auth':status===429?'rate-limit':status===404?'web-unsupported':status===413?'context-limit':status===408||status===504?'timeout':status===400||status===422?'web-tool':'network';
}
