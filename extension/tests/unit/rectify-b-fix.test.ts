import {expect,test} from 'vitest';
import {runChat} from '../../src/generation/run-chat';
import {createProviderPort} from '../../src/generation/provider-port';
import {parseHtmlPage} from '../../src/contracts/html-page';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import type {GenerationDiagnostic} from '../../src/contracts/generation-diagnostic';

const snapshot:ChatRequestSnapshot={snapshotId:'fixture',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'使用风格化的可交互页面来让我理解视频内容',outputType:'html',htmlFormat:1,modelId:'deepseekv4.1flash',webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[]};
const page='<!doctype html><html lang="zh"><head><title>学习页</title></head><body><h1>学习页</h1><button onclick="this.textContent=\'已展开\'">展开解释</button></body></html>';
const event=(text:string,reason:string|null=null)=>'data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:reason}]})+'\n\n';
test('HTML service length and stop-with-incomplete-document remain distinct through provider/runChat, without repair retries',async()=>{
  for(const finish of ['length','stop']){
    const diagnostics:GenerationDiagnostic[]=[];let calls=0,partial='',request:any;
    const port=createProviderPort('LOCAL_FIXTURE_TOKEN',async(_url,init)=>{calls++;request=JSON.parse(String(init!.body));return new Response(event(page.slice(0,-14))+event('',finish)+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});},undefined,async d=>{diagnostics.push(d);});
    const run=runChat(snapshot,[{from:0,to:8,content:'记忆可能受偏见影响。'}],port,new AbortController().signal,async text=>{partial=text;});
    if(finish==='length')await expect(run).rejects.toMatchObject({code:'output-limit',diagnostic:{cause:'service-length',purpose:'html-page',maxTokens:393216}});
    else {await run;expect(()=>parseHtmlPage(partial)).toThrow();}
    expect(calls).toBe(1);expect(request.model).toBe(snapshot.modelId);expect(request.response_format).toBeUndefined();
    expect(diagnostics[0]).toMatchObject({cause:finish==='length'?'service-length':'stop',htmlEnvelope:'missing-end'});
    expect(JSON.stringify(diagnostics)).not.toContain('学习页');
  }
});
test('complete HTML crosses the same provider boundary and preserves its interaction source',async()=>{
  let text='';const diagnostics:GenerationDiagnostic[]=[];
  await runChat(snapshot,[{from:0,to:8,content:'字幕'}],createProviderPort('LOCAL_FIXTURE_TOKEN',async()=>new Response(event(page,'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}),undefined,async d=>{diagnostics.push(d);}),new AbortController().signal,async value=>{text=value;});
  expect(parseHtmlPage(text).source).toBe(page);expect(diagnostics[0]).toMatchObject({cause:'stop',htmlEnvelope:'complete'});
});
