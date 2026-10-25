import 'fake-indexeddb/auto';
import {expect, test, vi} from 'vitest';
import {createProviderPort} from '../../src/generation/provider-port';
import {runChat} from '../../src/generation/run-chat';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {IndexedArtifactStore} from '../../src/data/artifact-store';
import {messageSchema, jobViewSchema} from '../../src/contracts/generation';
import {fetchModelList} from '../../src/generation/model-list';

const key='SYNTHETIC_HEADROOM_KEY';
const sse=(text:string)=>new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});

test('a complete long answer is received without a 4K request cap or 16K character cutoff and without prompting for extra work',async()=>{
  const text='完整解释。'.repeat(24000)+'回答终点';let sent:any,output='';
  const provider=createProviderPort(key,async(_url,init)=>{sent=JSON.parse(String(init?.body));return sse(text);});
  await runChat({snapshotId:'s',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'按需要解释',outputType:'chat',modelId:'deepseek-flash',webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[]},[{from:0,to:2,content:'视频依据'}],provider,new AbortController().signal,async text=>{output=text;});
  expect(output).toBe(text);expect(sent.max_tokens).toBe(393216);expect(sent.thinking).toEqual({type:'disabled'});
  expect(sent).not.toHaveProperty('reasoning_effort');expect(sent).not.toHaveProperty('thinking_budget');
  expect(sent.messages[0].content).toContain('完成任务即可结束');
  expect(sent.messages[0].content).not.toMatch(/393216|源码硬上限|本次输出上限/);
});

test('catalogue capacity is optional, validated and retained without rejecting models with unknown metadata',async()=>{
  const models=await fetchModelList(key,async()=>Response.json({data:[{id:'large',max_output_tokens:131072},{id:'unknown',max_output_tokens:'PRIVATE_VALUE'},{id:'invalid',max_output_tokens:-1}]}),new AbortController().signal);
  expect(models[0].maxOutputTokens).toBe(131072);expect(models[1]).not.toHaveProperty('maxOutputTokens');expect(models[2]).not.toHaveProperty('maxOutputTokens');
});

test('known third-party DeepSeek V4 requests disable thinking without requesting higher reasoning effort',async()=>{
  for(const [providerId,modelId] of [['bailian','deepseek-v4.1-flash-1017'],['siliconflow','deepseek-ai/DeepSeek-V4-Flash']] as const){
    let sent:any;const port=createProviderPort(key,async(_url,init)=>{sent=JSON.parse(String(init?.body));return sse('完成');},undefined,undefined,{providerId});
    await port.stream(modelId,[],new AbortController().signal,async()=>{});
    expect(sent.enable_thinking).toBe(false);expect(sent).not.toHaveProperty('reasoning_effort');expect(sent).not.toHaveProperty('thinking_budget');
    if(providerId==='bailian')expect(sent.max_tokens).toBe(393216);
  }
});

test('healthy final output can run beyond ten minutes; an actually idle stream times out without a second request',async()=>{
  vi.useFakeTimers();
  try{
    let calls=0,visible='';
    const port=createProviderPort(key,async()=>{calls++;return new Response(new ReadableStream({start(controller){
      for(let i=1;i<=7;i++)setTimeout(()=>controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'片段'},finish_reason:i===7?'stop':null}]})}\n\n${i===7?'data: [DONE]\n\n':''}`)),i*120000);
    }}),{headers:{'content-type':'text/event-stream'}});});
    const running=port.stream('deepseek-flash',[],new AbortController().signal,async text=>{visible+=text;});
    await vi.advanceTimersByTimeAsync(14*60000);await running;expect(visible).toBe('片段'.repeat(7));expect(calls).toBe(1);
    const idle=createProviderPort(key,async()=>new Response(new ReadableStream(),{headers:{'content-type':'text/event-stream'}}));
    const rejected=expect(idle.stream('deepseek-flash',[],new AbortController().signal,async()=>{})).rejects.toMatchObject({code:'timeout'});
    await vi.advanceTimersByTimeAsync(180000);await rejected;
  }finally{vi.useRealTimers();}
});

test('compatible final output uses declared model capacity or service defaults rather than a universal 8K cap',async()=>{
  for(const declared of [undefined,32768]){
    let sent:any;const diagnostics:any[]=[];
    const config:any={providerId:'custom',baseUrl:'https://example.test/v1',models:[{id:'fixture',...(declared?{maxOutputTokens:declared}:{})}]};
    const port=createProviderPort(key,async(_url,init)=>{sent=JSON.parse(String(init?.body));return sse('完成');},undefined,async d=>{diagnostics.push(d);},config);
    await port.stream('fixture',[],new AbortController().signal,async()=>{},'html-page');
    expect(sent.max_tokens).toBe(declared);expect(diagnostics[0].maxTokens).toBe(declared);
    expect(sent).not.toHaveProperty('thinking');expect(sent).not.toHaveProperty('reasoning_effort');
  }
});

test('long chat, Markdown and HTML survive checkpoint, completion, schemas and backup restore without truncation',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),store=new IndexedGenerationStore(name);
  for(const outputType of ['chat','markdown','html'] as const){
    const space=await spaces.open({platform:'bilibili',videoId:'fixture-'+outputType,partId:'1',title:'长输出'});
    await spaces.save(space.id,space.draft.revision,{...space.draft,text:'生成完整产物',modelId:'deepseek-flash',outputType},space.chatId);
    const target={kind:'chat' as const,workspaceId:space.id,chatId:space.chatId};
    const job=await store.freezeChat(target,space.draft.revision+1,{binding:{platform:'bilibili',videoId:'fixture-'+outputType,partId:'1',tabId:1,documentId:'doc',epoch:1},locator:'sub',fingerprint:'finger',language:'zh',cueCount:1},false,false);
    const attemptId=job.attempts[0].attemptId;await store.attach(job.jobId,attemptId,1);const claimed=(await store.claim(job.jobId,attemptId,1))!;
    const body='完整产物正文。'.repeat(24000)+'产物终点';
    const text=outputType==='html'?`<!doctype html><html><head><title>长页面</title></head><body>${body}</body></html>`:body;
    await store.checkpoint(job.jobId,attemptId,claimed.seq+1,text,{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});
    if(outputType!=='chat')await store.committing(job.jobId,attemptId);
    await store.finish(job.jobId,attemptId,'completed',null,crypto.randomUUID());
    const view=await store.view(target);
    for(const message of view.messages)expect(messageSchema.safeParse(message).success).toBe(true);
    for(const row of view.jobs)expect(jobViewSchema.safeParse(row).success).toBe(true);
    if(outputType==='markdown'){
      const artifacts=new IndexedArtifactStore(name),note=(await artifacts.list(space.id))[0];expect(note.content).toBe(text);
      expect((await artifacts.save(space.id,note.id,note.revision,text+'编辑完成')).content).toBe(text+'编辑完成');
    }
  }
  const file=await new IndexedBackupStore(name).export();
  const restored=new IndexedBackupStore(crypto.randomUUID()),preview=await restored.preview(file);await restored.execute(preview.planId,preview.checksum);
  const payload=JSON.parse(await restored.export()).payload;
  expect(payload.noteRevisions.filter((r:any)=>r.content.includes('产物终点')).length).toBeGreaterThanOrEqual(2);
  expect(payload.workspaces.flatMap((w:any)=>w.chats.flatMap((c:any)=>c.messages??[])).some((m:any)=>m.text.endsWith('产物终点'))).toBe(true);
});
