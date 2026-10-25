import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import {createWebEvidencePort} from '../../src/generation/web-evidence-port';
import {webOptions} from '../../src/contracts/web';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedAttachmentStore} from '../../src/data/attachment-store';
import {createProviderPort} from '../../src/generation/provider-port';
import {runChat} from '../../src/generation/run-chat';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import {png} from '../fixtures/png';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {limits} from '../../src/generation/subtitle-context';
import {searchReply,webTransport} from '../fixtures/web';

const key='SYNTHETIC_RELIABILITY_KEY';
const source={platform:'bilibili' as const,videoId:'BVreliable',partId:'1',title:'课程'};
const basis={locator:'test',fingerprint:'digest',language:'zh',cueCount:1,binding:{...source,tabId:1,documentId:'doc',epoch:1}};
const coverage={total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]};
const reply=()=>searchReply();
const complete=()=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'继续回答'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
async function fixture(){
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),tasks=new IndexedGenerationStore(name),images=new IndexedAttachmentStore(name),space=await spaces.open(source);
  const target={kind:'chat' as const,workspaceId:space.id,chatId:space.chatId};
  const freeze=async(text:string,autoVision=false)=>{const draft=(await spaces.read(space.id,space.chatId))!.draft;await spaces.save(space.id,draft.revision,{...draft,text,modelId:'deepseek-flash'},space.chatId);return tasks.freezeChat(target,draft.revision+1,basis,true,autoVision);};
  return {name,spaces,tasks,images,space,target,freeze};
}

test('first web answer deduplicates legitimate direct search sources',async()=>{
  const value=reply();value.results.push({...value.results[0]});
  let calls=0;
  const result=await createWebEvidencePort(key,webTransport(()=>{calls++;return Response.json(value);})).retrieve({options:webOptions(),question:'解释概念'},new AbortController().signal);
  expect(result.evidence).toMatchObject({status:'retrieved',executionLinked:true,sources:[{uri:'https://example.test/source'}]});
  expect(result.evidence.sources).toHaveLength(1);expect(calls).toBe(1);
});

test.each(['nullable','duplicate','many'])('direct search handles %s without another search',async variant=>{
  const value=reply();
  if(variant==='nullable')(value.results[0] as any).title=null;
  if(variant==='duplicate')value.results.push({...value.results[0]});
  if(variant==='many')value.results=Array.from({length:25},(_,i)=>({...value.results[0],url:`https://example.test/${i}`}));
  let calls=0;
  const result=await createWebEvidencePort(key,webTransport(()=>{calls++;return Response.json(value);})).retrieve({options:webOptions(),question:'解释概念'},new AbortController().signal);
  expect(result.evidence.sources).toHaveLength(variant==='many'?5:1);expect(calls).toBe(1);
  if(variant==='many')expect(result.evidence.excludedSources).toBe(20);
});

test('web retrieval accepts full subtitles above 30000 characters without losing the end',async()=>{
  const text='字幕'.repeat(16000)+'字幕结尾';let sent:any;
  const result=await createWebEvidencePort(key,webTransport(()=>Response.json(reply()),(url,body)=>{if(url.endsWith('/chat/completions'))sent=body;})).retrieve({options:webOptions(),question:'解释结尾',videoContext:{kind:'full-subtitles',text,totalSegments:3,coveredSegments:3}},new AbortController().signal);
  expect(sent.messages[1].content).toContain('字幕结尾');expect(result.evidence.sources).toHaveLength(1);
});

test('a long completed answer does not prevent the next question from freezing or reaching the provider',async()=>{
  const f=await fixture(),job=await f.freeze('先详细说明'),attempt=job.attempts[0].attemptId;
  await f.tasks.attach(job.jobId,attempt,1);await f.tasks.claim(job.jobId,attempt,1);
  await f.tasks.checkpoint(job.jobId,attempt,(await f.tasks.get(job.jobId))!.seq+1,'详细说明'.repeat(3300),coverage);
  await f.tasks.finish(job.jobId,attempt,'completed',null,crypto.randomUUID());
  const next=await f.freeze('接着举例');let sent:any;
  await runChat(next.snapshot as ChatRequestSnapshot,[{from:0,to:1,content:'字幕'}],createProviderPort(key,async(_url,init)=>{sent=JSON.parse(String(init?.body));return complete();}),new AbortController().signal,async()=>{});
  expect(sent.messages.at(-1).content).toContain('接着举例');expect(JSON.stringify(sent.messages)).toContain('详细说明');
});

test('follow-up after autonomous vision sends historical frames as user evidence, never assistant images',async()=>{
  const f=await fixture(),job=await f.freeze('看看画面',true),attempt=job.attempts[0].attemptId;
  await f.tasks.attach(job.jobId,attempt,1);await f.tasks.claim(job.jobId,attempt,1);
  const captured=await f.tasks.visual(job.jobId,attempt,{phase:'capturing',plan:{times:[0],reason:'核对'},attachmentIds:[],resolution:'images'},{dataUrl:png(),width:2,height:2,time:0});
  const visual=await f.tasks.visual(job.jobId,attempt,{...captured.attempts[0].visual!,phase:'answering',frozen:true});
  await f.tasks.checkpoint(job.jobId,attempt,visual.seq+1,'画面说明',coverage);await f.tasks.finish(job.jobId,attempt,'completed',null,crypto.randomUUID());
  const next=await f.freeze('继续解释'),snapshot=next.snapshot as ChatRequestSnapshot,images=await f.images.forSnapshot(snapshot);let sent:any;
  await runChat(snapshot,[{from:0,to:1,content:'字幕'}],createProviderPort(key,async(_url,init)=>{
    sent=JSON.parse(String(init?.body));
    return sent.messages.some((m:any)=>m.role==='assistant'&&Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url'))?new Response('',{status:400}):complete();
  }),new AbortController().signal,async()=>{},images);
  expect(JSON.stringify(sent.messages)).toContain('image_url');expect(sent.messages.at(-1).content).toContain('继续解释');
});

test('many long rounds retain recent whole turns, keep stored history and survive backup/retry',async()=>{
  const f=await fixture();
  for(let i=0;i<5;i++){
    const job=await f.freeze(`问题${i}`),attempt=job.attempts[0].attemptId;
    await f.tasks.attach(job.jobId,attempt,1);await f.tasks.claim(job.jobId,attempt,1);
    await f.tasks.checkpoint(job.jobId,attempt,(await f.tasks.get(job.jobId))!.seq+1,`回答${i}`+'字'.repeat(15000),coverage);
    await f.tasks.finish(job.jobId,attempt,'completed',null,crypto.randomUUID());
  }
  const next=await f.freeze('当前追问'),snapshot=next.snapshot as ChatRequestSnapshot;
  expect(snapshot.historyProjection.map(m=>m.text.slice(0,3))).toEqual(['问题3','回答3','问题4','回答4']);
  expect(snapshot.historyOmitted).toBe(6);
  expect((await f.tasks.view(f.target)).messages.filter(m=>m.role==='assistant')).toHaveLength(5);
  let sent:any;
  await runChat(snapshot,Array.from({length:4},(_,i)=>({from:i,to:i+1,content:`完整字幕${i}`+'文'.repeat(9000)})),createProviderPort(key,async(_url,init)=>{sent=JSON.parse(String(init?.body));return complete();}),new AbortController().signal,async()=>{});
  const context=JSON.parse(sent.messages[1].content.split('\n')[1]);
  expect(context.datasetManifest.historyWindow).toMatchObject({includedMessages:4,omittedMessages:6});
  expect(context.datasetManifest.sources.find((s:any)=>s.source==='conversation_history').delivery).toBe('sampled');
  expect(sent.messages.reduce((n:number,m:any)=>n+m.content.length,0)).toBeLessThanOrEqual(limits.requestChars);
  expect(JSON.stringify(sent.messages)).toContain('完整字幕3');expect(JSON.stringify(sent.messages)).toContain('回答4');
  await f.tasks.finish(next.jobId,next.attempts[0].attemptId,'failed','network');
  expect((await f.tasks.retry(next.jobId)).snapshot).toEqual(snapshot);
  const backup=new IndexedBackupStore(crypto.randomUUID()),plan=await backup.preview(await new IndexedBackupStore(f.name).export());
  await backup.execute(plan.planId,plan.checksum);
});

test('repeated autonomous vision freezes a bounded history candidate pool and excludes failed partial answers',async()=>{
  const f=await fixture();
  for(let i=0;i<7;i++){
    const job=await f.freeze(`读画面${i}`,true),attempt=job.attempts[0].attemptId,snapshot=job.snapshot as ChatRequestSnapshot;
    expect(snapshot.historyProjection.reduce((n,m)=>n+m.attachmentIds.length,0)).toBeLessThanOrEqual(10);
    await f.tasks.attach(job.jobId,attempt,1);await f.tasks.claim(job.jobId,attempt,1);
    const capture=await f.tasks.visual(job.jobId,attempt,{phase:'capturing',plan:{times:[0],reason:'核对'},attachmentIds:[],resolution:'images'},{dataUrl:png(),width:2,height:2,time:0});
    const visual=await f.tasks.visual(job.jobId,attempt,{...capture.attempts[0].visual!,phase:'answering',frozen:true});
    await f.tasks.checkpoint(job.jobId,attempt,visual.seq+1,i===6?'失败的未完成文字':'画面回答',coverage);
    await f.tasks.finish(job.jobId,attempt,i===6?'failed':'completed',i===6?'protocol':null,i===6?null:crypto.randomUUID());
  }
  const next=await f.freeze('继续'),snapshot=next.snapshot as ChatRequestSnapshot;
  expect(snapshot.historyProjection.some(m=>m.text==='失败的未完成文字')).toBe(false);
  expect((await f.tasks.view(f.target)).messages.some(m=>m.text==='失败的未完成文字')).toBe(true);
});

test('optional diagnostic storage cannot discard an answer or mask the real failure',async()=>{
  let text='';
  await createProviderPort(key,async()=>complete(),undefined,async()=>{throw new Error('quota');}).stream('deepseek-flash',[],new AbortController().signal,async delta=>{text+=delta;});
  expect(text).toBe('继续回答');
  await expect(createProviderPort(key,async()=>new Response('',{status:429}),undefined,async()=>{throw new Error('quota');}).stream('deepseek-flash',[],new AbortController().signal,async()=>{})).rejects.toMatchObject({code:'rate-limit'});
});
