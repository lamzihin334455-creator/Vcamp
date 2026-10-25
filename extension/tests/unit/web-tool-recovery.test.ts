import {test,expect} from 'vitest';
import {createWebEvidencePort} from '../../src/generation/web-evidence-port';
import {webOptions} from '../../src/contracts/web';
import 'fake-indexeddb/auto';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {failureFeedback} from '../../src/workbench/failure-feedback';
import {searchReply,webTransport} from '../fixtures/web';

const key='SYNTHETIC_WEB_RECOVERY_KEY';
const input={options:webOptions(),question:'使用模板快速总结，核对视频中的赛事版权说法'};
test('a legacy frozen native request uses the corrected direct route once',async()=>{
  let calls=0;
  const port=createWebEvidencePort(key,webTransport(()=>{calls++;return Response.json(searchReply('https://example.test/rights'));}));
  const result=await port.retrieve({...input,options:{...input.options,route:'deepseek-native-v1'}},new AbortController().signal);
  expect(calls).toBe(1);
  expect(result.evidence).toMatchObject({executionLinked:true,usage:{searches:1},sources:[{uri:'https://example.test/rights'}]});
});

test('native tool blocks cannot be misrepresented as a direct search response',async()=>{
  for(const response of [{content:[]},{id:'native',stop_reason:'pause_turn',usage:{server_tool_use:{web_search_requests:2}},content:[{type:'server_tool_use',id:'tool',name:'web_search'}]}])
    await expect(createWebEvidencePort(key,webTransport(()=>Response.json(response))).retrieve(input,new AbortController().signal)).rejects.toMatchObject({code:'web-protocol',diagnostic:{webStage:'envelope',webFailure:'response-shape'}});
});

test('a result title without a returned excerpt cannot stand in for web material',async()=>{
  await expect(createWebEvidencePort(key,webTransport(()=>Response.json({results:[{url:'https://example.test/rights',title:'我准备搜索'}]}))).retrieve(input,new AbortController().signal)).rejects.toMatchObject({code:'web-no-sources',diagnostic:{webStage:'sources'}});
});

test('HTTP rejection and response shape record safe distinct causes; no remote text or keys escape',async()=>{
  const diagnostics:any[]=[];
  const requests=[
    {response:Response.json({error:{type:'invalid_request_error',message:`query PRIVATE_RESPONSE ${key}`}}, {status:400}),expected:{httpStatus:400,webFailure:'request-rejected',webServiceError:'invalid_request_error',webRejectedFields:['query']}},
    {response:Response.json({content:[]}),expected:{httpStatus:200,webFailure:'response-shape'}},
    {response:Response.json({results:[]}),expected:{httpStatus:200,webStage:'sources'}},
  ];
  for(const {response,expected} of requests){
    await expect(createWebEvidencePort(key,webTransport(()=>response),async d=>{diagnostics.push(d);}).retrieve(input,new AbortController().signal)).rejects.toMatchObject({diagnostic:expected});
    expect(diagnostics.at(-1)).toMatchObject({...expected,webAdapterVersion:3});
  }
  expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_RESPONSE|SYNTHETIC_WEB_RECOVERY_KEY/);
  const invalid={...input,question:'长'.repeat(12001)};
  await expect(createWebEvidencePort(key,async()=>{throw Error('must not fetch');},async d=>{diagnostics.push(d);}).retrieve(invalid,new AbortController().signal)).rejects.toMatchObject({code:'context-limit',diagnostic:{webStage:'request',webFailure:'invalid-input'}});
  expect(diagnostics).toHaveLength(4);
});

test('final diagnostic survives full history, failed first write, refresh/export and legacy feedback is honest',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),store=new IndexedGenerationStore(name);
  const source={platform:'bilibili' as const,videoId:'BVfeedback',partId:'1',title:'PRIVATE_VIDEO_TITLE'},space=await spaces.open(source);
  await spaces.save(space.id,0,{...space.draft,text:'PRIVATE_QUESTION',modelId:'deepseek-flash',webEnabled:true},space.chatId);
  const target={kind:'chat' as const,workspaceId:space.id,chatId:space.chatId};
  const job=await store.freezeChat(target,1,{locator:'test',fingerprint:'digest',language:'zh',cueCount:1,binding:{...source,tabId:1,documentId:'doc',epoch:1}});
  const attempt=job.attempts[0].attemptId;
  await store.attach(job.jobId,attempt,1);await store.claim(job.jobId,attempt,1);
  for(let i=0;i<18;i++)await store.diagnostic(job.jobId,attempt,{purpose:'summary',cause:'stop',maxTokens:1024,outputChars:i,responseBytes:0,usage:{}});
  let failure:any;
  try{await createWebEvidencePort(key,webTransport(()=>new Response('',{status:400})),async()=>{throw Error('first diagnostic write failed');}).retrieve(input,new AbortController().signal);}catch(error){failure=error;}
  // Executor's catch retries the attached diagnostic before finish.
  await store.diagnostic(job.jobId,attempt,failure.diagnostic);await store.diagnostic(job.jobId,attempt,failure.diagnostic);
  await store.finish(job.jobId,attempt,'failed',failure.code);
  const view=(await new IndexedGenerationStore(name).view(target)).jobs[0];
  expect(view.diagnostics).toHaveLength(18);expect(view.diagnostics!.at(-1)).toMatchObject({httpStatus:400,webFailure:'request-rejected'});
  const feedback=failureFeedback(view,'0.1.27');
  expect(JSON.parse(feedback)).toMatchObject({appVersionAtExport:'0.1.27',error:'web-tool',diagnosticStatus:'recorded'});
  expect(feedback).not.toMatch(/PRIVATE_|SYNTHETIC_WEB_RECOVERY_KEY/);
  const file=await new IndexedBackupStore(name).export(),backup=new IndexedBackupStore(crypto.randomUUID()),preview=await backup.preview(file);
  await backup.execute(preview.planId,preview.checksum);
  expect(JSON.parse(failureFeedback({...view,diagnostics:undefined},'0.1.27'))).toMatchObject({diagnosticStatus:'not-recorded',diagnostics:[]});
});
