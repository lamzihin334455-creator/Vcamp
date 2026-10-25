import {expect,test} from 'vitest';
import {createProviderPort} from '../../src/generation/provider-port';
import {fetchModelList} from '../../src/generation/model-list';
import {outputOptions} from '../../src/generation/output-policy';

const key='SYNTHETIC_QWEN_OUTPUT_KEY';
test('Bailian Qwen 3.8 Flash completes HTML instead of inheriting a catalogue 8192 output clamp',async()=>{
  const connection={providerId:'bailian' as const};
  const models=await fetchModelList(key,async()=>Response.json({data:[{id:'qwen3.8-flash',max_output_tokens:8192}]}),new AbortController().signal,connection);
  let sent:any,output='';const diagnostics:any[]=[];
  const html='<!doctype html><html><head><title>完整学习页</title></head><body>'+('<p>完整知识点</p>'.repeat(6000))+'</body></html>';
  const port=createProviderPort(key,async(_url,init)=>{
    sent=JSON.parse(String(init?.body));
    const complete=sent.max_tokens>=32768;
    return new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{content:complete?html:html.slice(0,18709)},finish_reason:complete?'stop':'length'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  },undefined,async d=>{diagnostics.push(d);},{...connection,models,catalog:models});
  await port.stream('qwen3.8-flash',[],new AbortController().signal,async text=>{output+=text;},'html-page');
  expect(sent.max_tokens).toBe(131072);expect(output).toBe(html);
  expect(sent.enable_thinking).toBe(false);expect(sent.stream_options).toEqual({include_usage:true});
  expect(sent).not.toHaveProperty('reasoning_effort');expect(sent).not.toHaveProperty('thinking_budget');
  expect(diagnostics[0]).toMatchObject({cause:'stop',htmlEnvelope:'complete',maxTokens:131072});
});

test('the exact Qwen model uses its documented capacity for all final outputs, including saved models without a catalogue',()=>{
  for(const purpose of ['answer','markdown','html-page'] as const)for(const metadata of [{},{models:[{id:'qwen3.8-flash',maxOutputTokens:8192}]},{catalog:[{id:'qwen3.8-flash',maxOutputTokens:8192}]}]){
    expect(outputOptions({providerId:'bailian',...metadata},'qwen3.8-flash',purpose)).toMatchObject({maxTokens:131072,thinking:{enable_thinking:false},includeUsage:true});
  }
  expect(outputOptions({providerId:'bailian'},'qwen3.8-flash','requirements-plan').maxTokens).toBe(768);
});

test('Qwen policy stays within official Bailian endpoints and does not guess other model capacities or proxy support',()=>{
  for(const baseUrl of ['https://dashscope.aliyuncs.com/compatible-mode/v1','https://dashscope-intl.aliyuncs.com/compatible-mode/v1','https://test-space.cn-beijing.maas.aliyuncs.com/compatible-mode/v1']){
    expect(outputOptions({providerId:'custom',baseUrl},'qwen3.8-flash','html-page').maxTokens).toBe(131072);
  }
  for(const baseUrl of ['https://proxy.test/v1','https://dashscope.aliyuncs.com.attacker.test/compatible-mode/v1','https://dashscope.aliyuncs.com/another-api']){
    expect(outputOptions({providerId:'bailian',baseUrl},'qwen3.8-flash','html-page')).toMatchObject({maxTokens:undefined,thinking:{},includeUsage:false});
  }
  expect(outputOptions({providerId:'bailian'},'qwen-unknown','html-page')).toMatchObject({maxTokens:undefined,thinking:{}});
  expect(outputOptions({providerId:'bailian',catalog:[{id:'qwen-unknown',maxOutputTokens:16384}]},'qwen-unknown','html-page').maxTokens).toBe(16384);
});

test('short Qwen responses stop naturally, capture numerical usage and never trigger another request',async()=>{
  let calls=0,output='';const diagnostics:any[]=[];
  const port=createProviderPort(key,async()=>{
    calls++;
    return new Response(`data: ${JSON.stringify({choices:[{delta:{content:'你好'},finish_reason:'stop'}]})}\n\ndata: ${JSON.stringify({choices:[],usage:{prompt_tokens:50,completion_tokens:2,total_tokens:52,completion_tokens_details:{reasoning_tokens:0}}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  },undefined,async d=>{diagnostics.push(d);},{providerId:'bailian'});
  await port.stream('qwen3.8-flash',[],new AbortController().signal,async text=>{output+=text;});
  expect(output).toBe('你好');expect(calls).toBe(1);
  expect(diagnostics[0]).toMatchObject({providerId:'bailian',providerEndpoint:'preset',modelId:'qwen3.8-flash',usage:{inputTokens:50,outputTokens:2,totalTokens:52,reasoningTokens:0}});
});

test('a genuine service length finish still fails without saving partial HTML or automatically retrying',async()=>{
  let calls=0;const diagnostics:any[]=[];
  const port=createProviderPort(key,async()=>{
    calls++;return new Response(`data: ${JSON.stringify({choices:[{delta:{content:'<!doctype html><html><head><title>未完成</title></head><body>'},finish_reason:'length'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  },undefined,async d=>{diagnostics.push(d);},{providerId:'bailian'});
  await expect(port.stream('qwen3.8-flash',[],new AbortController().signal,async()=>{},'html-page')).rejects.toMatchObject({code:'output-limit'});
  expect(calls).toBe(1);expect(diagnostics[0]).toMatchObject({cause:'service-length',maxTokens:131072,htmlEnvelope:'missing-end',providerId:'bailian'});
});
