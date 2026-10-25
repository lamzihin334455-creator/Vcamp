import {expect,test} from 'vitest';
import {createWebEvidencePort} from '../../src/generation/web-evidence-port';
import {webOptions} from '../../src/contracts/web';
import {queryResponse,searchReply,webTransport} from '../fixtures/web';

const queryReply=()=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:JSON.stringify({query:'赛事版权 报价'})},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
test('application dispatches exactly one direct search after a bounded query plan, with no server tool loop',async()=>{
  const requests:{url:string;body:any}[]=[];
  const port=createWebEvidencePort('SYNTHETIC_DIRECT_KEY',async(url,init)=>{
    const body=JSON.parse(String(init?.body));requests.push({url:String(url),body});
    if(String(url).endsWith('/chat/completions'))return queryReply();
    if(String(url).endsWith('/v1/tools/search'))return Response.json({results:[{url:'https://example.test/rights',title:'赛事版权',summary:'公开报道的赛事转播版权报价。',snippet:'赛事转播版权',content:''}]});
    // Synthetic native response matching all invalid-field groups in the user's
    // diagnostic, not a claim to reconstruct its unavailable raw response.
    return Response.json({id:'native',model:'deepseek-flash',stop_reason:'pause_turn',usage:{server_tool_use:{web_search_requests:2}},content:[{type:'tool_use',id:'tool',name:'web_search',input:{query:'赛事版权'}}]});
  });
  const result=await port.retrieve({options:webOptions(),question:'快速总结视频并核对版权报价',videoContext:{kind:'full-subtitles',text:'视频结尾说赛事转播版权达到八位数。',totalSegments:1,coveredSegments:1}},new AbortController().signal);
  expect(requests.map(r=>new URL(r.url).pathname)).toEqual(['/chat/completions','/v1/tools/search']);
  expect(requests[0].body.messages[1].content).toContain('视频结尾');
  expect(requests[0].body.tools).toBeUndefined();
  expect(requests[1].body).toMatchObject({query:'赛事版权 报价',count:5,need_content:false});
  expect(result).toMatchObject({evidence:{executionLinked:true,usage:{searches:1},sources:[{uri:'https://example.test/rights'}]}});
  expect(result.material).toContain('公开报道');
});

test('Unicode query bounds, plan JSON, output truncation and secrets reject before any search',async()=>{
  const frame=(content:string,finish_reason='stop')=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  for(const [response,code] of [
    [frame(JSON.stringify({query:'😀'.repeat(129)})),'web-protocol'],
    [frame(JSON.stringify({query:'  '})),'web-protocol'],
    [frame(JSON.stringify({query:'主题',webEnabled:true})),'web-protocol'],
    [frame(JSON.stringify({query:'sk-abcdefghijk'})),'web-protocol'],
    [frame('{"query":"未完成','length'),'output-limit'],
  ] as const){
    let calls=0;
    await expect(createWebEvidencePort('SYNTHETIC_DIRECT_KEY',async()=>{calls++;return response;}).retrieve({options:webOptions(),question:'检索'},new AbortController().signal)).rejects.toMatchObject({code,diagnostic:{webStage:'query-plan'}});
    expect(calls).toBe(1);
  }
  let calls=0;
  const result=await createWebEvidencePort('SYNTHETIC_DIRECT_KEY',async url=>{
    calls++;return String(url).endsWith('/chat/completions')?queryResponse('😀'.repeat(128)):Response.json(searchReply());
  }).retrieve({options:webOptions(),question:'检索'},new AbortController().signal);
  expect(calls).toBe(2);expect(result.evidence.usage).toMatchObject({inputTokens:4,outputTokens:3,cacheReadTokens:1,searches:1});
});

test('permission is checked before planning and again before search; stopping cannot dispatch a late search',async()=>{
  for(const offBeforePlan of [true,false]){
    let checks=0,calls=0;
    const port=createWebEvidencePort('SYNTHETIC_DIRECT_KEY',async()=>{calls++;return queryResponse();},undefined,async()=>{checks++;return !offBeforePlan&&checks===1;});
    await expect(port.retrieve({options:webOptions(),question:'检索'},new AbortController().signal)).rejects.toMatchObject({code:'web-disabled'});
    expect(calls).toBe(offBeforePlan?0:1);
  }
  const controller=new AbortController();let calls=0,checks=0;
  const port=createWebEvidencePort('SYNTHETIC_DIRECT_KEY',async()=>{calls++;return queryResponse();},undefined,async()=>{if(++checks===2)controller.abort();return true;});
  await expect(port.retrieve({options:webOptions(),question:'检索'},controller.signal)).rejects.toMatchObject({code:'timeout'});expect(calls).toBe(1);
});

test('response byte limit, invalid JSON, credential echoes and empty results never produce final web evidence',async()=>{
  for(const [response,code] of [
    [new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}}),'output-limit'],
    [new Response('{broken',{headers:{'content-type':'application/json'}}),'web-protocol'],
    [Response.json(searchReply('https://example.test/?token=private')),'web-no-sources'],
    [Response.json(searchReply('https://example.test/source','SYNTHETIC_DIRECT_KEY')),'web-protocol'],
    [Response.json({results:[]}),'web-no-sources'],
  ] as const){
    let searches=0;
    await expect(createWebEvidencePort('SYNTHETIC_DIRECT_KEY',webTransport(()=>{searches++;return response;})).retrieve({options:webOptions(),question:'检索'},new AbortController().signal)).rejects.toMatchObject({code});
    expect(searches).toBe(1);
  }
});

test('source IDs retain literal URLs and excerpts stay bounded with control characters and nullable metadata',async()=>{
  const value={results:[{url:'https://example.test/source?lang=zh#part',title:null,summary:null,snippet:'来源摘录'+'\n\t'.repeat(20000)},{url:'https://example.test/other',title:'正文缺失',summary:'',snippet:''}]};
  const result=await createWebEvidencePort('SYNTHETIC_DIRECT_KEY',webTransport(()=>Response.json(value))).retrieve({options:webOptions(),question:'检索'},new AbortController().signal);
  expect(result.evidence.sources).toEqual([{id:'s0',uri:value.results[0].url}]);expect(result.evidence.excludedSources).toBe(1);
  expect(result.material.length).toBeLessThanOrEqual(8000);expect(result.material).toContain('来源 s0 摘录');
});
