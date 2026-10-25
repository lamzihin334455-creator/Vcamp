import {expect,test} from 'vitest';
import {createProviderPort} from '../../src/generation/provider-port';
import {parseEvidenceProposal} from '../../src/generation/vision-plan';
import type {GenerationDiagnostic} from '../../src/contracts/generation-diagnostic';

test('planning JSON survives independent token and UTF-8/SSE byte partitions exactly',async()=>{
  const plan={version:2,scope:'focused',needsNewFrames:true,evidence:[{id:'page',need:'读取“背景”与 "布局"，含转义 \\ 和换行\n及 😀',priority:'required',mode:'single',reuseAttachmentIds:[],detailNeed:'read-text',readTargets:['选项名称'],reason:'SYN 是凭证前缀，不是完整凭证',windows:[{from:1,to:3,anchor:2,cueIds:[0],basis:'subtitle'}]}],unresolved:[]};
  const text=JSON.stringify(plan),encoder=new TextEncoder();
  for(const tokenSize of [1,2,7,text.length])for(const byteSize of [1,2,3,7,31,1024,100000]){
    let wire=': keepalive\r\n\r\n';
    const event=(content:string,finish:string|null=null)=>'data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:finish}]})+'\r\n\r\n';
    wire+='data: '+JSON.stringify({choices:[{index:0,delta:{reasoning_content:'不应混入正文'},finish_reason:null}]})+'\r\n\r\n';
    for(let i=0;i<text.length;i+=tokenSize)wire+=event(text.slice(i,i+tokenSize));
    wire+=event('','stop')+'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:5736,completion_tokens:521,total_tokens:6257}})+'\r\n\r\ndata: [DONE]\r\n\r\n';
    const bytes=encoder.encode(wire),diagnostics:GenerationDiagnostic[]=[];
    const transport:typeof fetch=async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=byteSize)controller.enqueue(bytes.slice(i,i+byteSize));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
    let received='';
    await createProviderPort('SYNTHETIC_TASK_KEY',transport,undefined,async d=>{diagnostics.push(d);}).stream('fixture',[],new AbortController().signal,async d=>{received+=d;},'vision-plan');
    expect(received,`tokens ${tokenSize}, bytes ${byteSize}`).toBe(text);
    expect(parseEvidenceProposal(received,10,[{from:1,to:3,content:'菜单'}],[])).toEqual({plan});
    expect(diagnostics[0]).toMatchObject({cause:'stop',outputChars:text.length,responseBytes:bytes.length,usage:{outputTokens:521}});
  }
});
