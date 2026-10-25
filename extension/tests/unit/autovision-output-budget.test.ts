import {expect,test} from 'vitest';
import {createProviderPort} from '../../src/generation/provider-port';
import {runChat} from '../../src/generation/run-chat';
import {htmlPageSchema} from '../../src/contracts/knowledge';
import {parseHtmlPage} from '../../src/contracts/html-page';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import {purposePolicy} from '../../src/generation/purpose-policy';
import {allocateVisualPlan,visualPolicy} from '../../src/generation/visual-selection';

// Controlled service substitutes make both truncation layers deterministic;
// the old client's small max_tokens returns length, otherwise stream the whole
// document. This reproduces a budget failure, not real-model quality/frequency.
function service(output:string,neededTokens:number){
 const requests:any[]=[];
 const port=createProviderPort('SYNTHETIC_BUDGET_TOKEN',async(_url,init)=>{
  const body=JSON.parse(String(init!.body));requests.push(body);
  const enough=body.max_tokens>=neededTokens,content=enough?output:output.slice(0,100);
  const data=content.match(/[\s\S]{1,4096}/g)!.map(content=>'data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:null}]})+'\n\n').join('');
  return new Response(data+'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:enough?'stop':'length'}],usage:{completion_tokens:enough?neededTokens:body.max_tokens}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 });
 return {port,requests};
}

test.each(['markdown','html'] as const)('autonomous %s completes beyond old token and character caps with final reserve intact',async outputType=>{
 const content=outputType==='markdown'?'# 深度学习笔记\n\n'+('完整画面与字幕依据。\n'.repeat(4000)):'<!doctype html><html><head><title>完整学习页</title></head><body>'+('<p>完整画面与字幕依据。</p>'.repeat(5000))+'</body></html>';
 const f=service(content,outputType==='markdown'?20000:48000);
 const snapshot:ChatRequestSnapshot={snapshotId:'fixture',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'结合自主识别画面生成完整学习产物',outputType,...(outputType==='html'?{htmlFormat:1 as const}:{}),modelId:'local',autoVision:true,webEnabled:false,referenceSnapshotIds:[],attachmentIds:[],historyProjection:[],templateRevisionId:null};
 const audit=allocateVisualPlan({version:2,scope:'focused',needsNewFrames:false,evidence:[],unresolved:[]},snapshot,[],'字幕规划','最终依据');
 let saved='';
 await runChat(snapshot,[{from:0,to:2,content:'完整字幕'}],f.port,new AbortController().signal,async text=>{saved=text;},[],undefined,[],'已经取得的画面依据',undefined,{tokenAllowance:visualPolicy.tokenCeiling,history:[],detailById:{}});
 expect(saved).toBe(content);expect(f.requests).toHaveLength(1);
 expect(audit.budget.finalOutputReserved).toBe(f.requests[0].max_tokens);
 if(outputType==='html'){
  const parsed=parseHtmlPage(saved);expect(parsed.source).toBe(content);
  expect(htmlPageSchema.parse({id:'p',workspaceId:'w',sourceChatId:'c',revisionId:'r',type:'html-page',pageVersion:1,...parsed,sourceDeleted:false}).source).toBe(content);
 }
});

test.each([['vision-plan',6000,12000],['vision-review',12000,24000]] as const)('%s has room for a detailed structured response',async(purpose,neededTokens,chars)=>{
 const output=JSON.stringify({version:3,description:'核对实际图片，逐项说明已确认和未确认的信息。'.repeat(Math.ceil(chars/24))});
 const f=service(output,neededTokens);let received='';
 await f.port.stream('local',[{role:'user',content:'返回结构化核验'}],new AbortController().signal,async text=>{received+=text;},purpose);
 expect(received).toBe(output);expect(f.requests).toHaveLength(1);
});

test('local character limits remain independent of service stop and no continuation is issued',async()=>{
 const output='文'.repeat(purposePolicy.markdown.outputChars+1),f=service(output,100);
 await expect(f.port.stream('local',[{role:'user',content:'笔记'}],new AbortController().signal,async()=>{},'markdown')).rejects.toMatchObject({code:'output-limit',diagnostic:{cause:'local-characters'}});
 expect(f.requests).toHaveLength(1);
});

test('service length remains a failure even below the new character limits',async()=>{
 const f=service('短但未完成',1000000);
 await expect(f.port.stream('local',[{role:'user',content:'笔记'}],new AbortController().signal,async()=>{},'markdown')).rejects.toMatchObject({code:'output-limit',diagnostic:{cause:'service-length'}});
 expect(f.requests).toHaveLength(1);
});

test.each(['single-large-event','many-small-events'] as const)('long Markdown tolerates %s without hitting the old SSE buffers',async mode=>{
 const event=(content:string,finish_reason:string|null=null)=>'data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason}]})+'\n\n';
 const expected=mode==='single-large-event'?'文'.repeat(70000):'文'.repeat(14000);
 const body=(mode==='single-large-event'?event(expected):event('文').repeat(14000))+event('','stop')+'data: [DONE]\n\n';
 const port=createProviderPort('SYNTHETIC_BUDGET_TOKEN',async()=>new Response(body,{headers:{'content-type':'text/event-stream'}}));
 let received='';await port.stream('local',[],new AbortController().signal,async text=>{received+=text;},'markdown');
 expect(received).toBe(expected);
});
