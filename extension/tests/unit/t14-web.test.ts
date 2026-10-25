import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {createWebEvidencePort} from '../../src/generation/web-evidence-port';
import {webOptions,publicWebUri,relateWebAnswer,type WebEvidence} from '../../src/contracts/web';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {IndexedArtifactStore} from '../../src/data/artifact-store';
import {digest} from '../../src/data/backup-format';
import {runChat} from '../../src/generation/run-chat';
import {IndexedAttachmentStore} from '../../src/data/attachment-store';
import {IndexedKnowledgeStore} from '../../src/data/knowledge-store';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import {png} from '../fixtures/png';
import {IndexedManagementStore} from '../../src/data/management-store';
import {searchReply,webTransport} from '../fixtures/web';
const source={platform:'bilibili' as const,videoId:'BVweb',partId:'1',title:'联网视频'};
const basis={locator:'test',fingerprint:'digest',language:'zh',cueCount:1,binding:{...source,tabId:1,documentId:'doc',epoch:1}};
test('new Chat default, current Chat and retry preserve separate frozen web choices',async()=>{
  let enabled=false;
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name,async()=>enabled),tasks=new IndexedGenerationStore(name);
  const a=await spaces.open(source);expect(a.draft.webEnabled??false).toBe(false);
  enabled=true;const b=await spaces.createChat(a.id);
  expect(b.draft.webEnabled).toBe(true);
  expect((await spaces.read(a.id,a.chatId))!.draft.webEnabled??false).toBe(false);
  await spaces.save(b.id,0,{...b.draft,text:'结合视频查资料',modelId:'answer-model'},b.chatId);
  const target={kind:'chat' as const,workspaceId:b.id,chatId:b.chatId};
  const job=await tasks.freezeChat(target,1,basis);
  expect(job.snapshot).toMatchObject({webEnabled:true,modelId:'answer-model',web:{providerId:'deepseek',modelId:'deepseek-flash',route:'deepseek-search-v2',maxSearches:1}});
  await tasks.finish(job.jobId,job.attempts[0].attemptId,'stopped');
  const current=(await spaces.read(b.id,b.chatId))!.draft;
  await spaces.save(b.id,current.revision,{...current,webEnabled:false,modelId:'other-model'},b.chatId);
  const retried=await tasks.retry(job.jobId);
  expect(retried.snapshot).toEqual(job.snapshot);
  expect(retried.attempts.at(-1)!.webEvidence).toBeUndefined();
  expect((await new IndexedWorkspaceStore(name).read(b.id,b.chatId))!.draft.webEnabled).toBe(false);
});
const uri='https://docs.example.test/topic?ref=public#part';
const reply=(url=uri)=>({...searchReply(url),results:[{...searchReply(url).results[0],title:''}]});
test('direct evidence adapter retains ordinary HTTPS identity without fetching source pages',async()=>{
  const requests:{url:string;body:any}[]=[];
  const port=createWebEvidencePort('FAKE_T14_KEY',webTransport(()=>Response.json(reply()),(url,body)=>{requests.push({url,body});}));
  const result=await port.retrieve({options:webOptions(),question:'联系视频解释',videoTitle:'课程'},new AbortController().signal);
  expect(result.evidence).toMatchObject({status:'retrieved',executionLinked:true,sources:[{id:'s0',uri}],references:[]});
  expect(result.evidence.sources[0].title).toBeUndefined();
  expect(requests).toHaveLength(2);expect(requests[1].url).toBe('https://api.deepseek.com/v1/tools/search');
  expect(requests[0].body).toMatchObject({model:'deepseek-flash',stream:true,thinking:{type:'disabled'},max_tokens:512});
  expect(requests[0].body.tools).toBeUndefined();
  expect(requests[0].body.messages[0].content).not.toContain('联系视频解释');
  expect(requests[0].body.messages[1].content).toContain('联系视频解释');
  expect(requests[1].body).toMatchObject({count:5,need_content:false});
  expect(JSON.stringify(result.evidence)).not.toContain('FAKE_T14_KEY');
});
const evidence=():WebEvidence=>({version:1,status:'retrieved',retrievedAt:'2026-10-16T00:00:00.000Z',executionLinked:true,sources:[{id:'s0',uri}],references:[],excludedSources:0,usage:{searches:1}});
async function webJob(outputType:'chat'|'markdown'|'html'='chat'){
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),tasks=new IndexedGenerationStore(name),a=await spaces.open(source);
  await spaces.save(a.id,0,{...a.draft,text:'联网视频问题',outputType,webEnabled:true,modelId:'answer'},a.chatId);
  const target={kind:'chat' as const,workspaceId:a.id,chatId:a.chatId},job=await tasks.freezeChat(target,1,basis),attempt=job.attempts[0].attemptId;
  await tasks.attach(job.jobId,attempt,1);await tasks.claim(job.jobId,attempt,1);
  return {name,spaces,tasks,a,target,job,attempt};
}
test('evidence, exact answer links and artifacts commit atomically, round trip and remap with a conflicting Chat',async()=>{
  const f=await webJob('markdown');
  const updated=await f.tasks.webEvidence(f.job.jobId,f.attempt,evidence());
  await f.tasks.checkpoint(f.job.jobId,f.attempt,updated.seq+1,`# 视频依据与网页补充\n[来源](${uri})`,{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});
  await f.tasks.finish(f.job.jobId,f.attempt,'completed',null,'web-note');
  const saved=(await f.tasks.view(f.target)).messages.at(-1)!.webEvidence!;
  expect(saved.status).toBe('cited');expect(saved.references).toEqual([{uri,sourceId:'s0'}]);
  expect((await new IndexedArtifactStore(f.name).list(f.a.id))[0].webEvidence).toEqual(saved);
  const file=await new IndexedBackupStore(f.name).export(),dest=crypto.randomUUID(),backup=new IndexedBackupStore(dest);
  expect(JSON.parse(file).manifest).toMatchObject({formatVersion:6,databaseVersion:10});
  const plan=await backup.preview(file);await backup.execute(plan.planId,plan.checksum);
  expect((await new IndexedGenerationStore(dest).view(f.target)).messages.at(-1)!.webEvidence).toEqual(saved);
  const spaces=new IndexedWorkspaceStore(dest),draft=(await spaces.read(f.a.id,f.a.chatId))!.draft;
  await spaces.save(f.a.id,draft.revision,{...draft,text:'不同的本地草稿'},f.a.chatId);
  const merge=await backup.preview(file);await backup.execute(merge.planId,merge.checksum);
  const copy=merge.mapping.find(m=>m.kind==='chat'&&m.from===f.a.chatId)!.to;
  expect(copy).not.toBe(f.a.chatId);
  expect((await new IndexedArtifactStore(dest).list(f.a.id,copy))[0].webEvidence).toEqual(saved);
  expect((await new IndexedGenerationStore(dest).view({...f.target,chatId:copy})).messages.at(-1)!.webEvidence).toEqual(saved);
  await new IndexedBackupStore(crypto.randomUUID()).preview(await backup.export());
  const invalid=JSON.parse(file);invalid.payload.artifacts[0].webEvidence.sources[0].uri='https://wrong.test/';invalid.manifest.checksum=await digest(invalid.payload);
  await expect(new IndexedBackupStore(crypto.randomUUID()).preview(JSON.stringify(invalid))).rejects.toMatchObject({code:'invalid-message'});
});
test('missing evidence cannot complete; stop and retry never inherit old evidence or accept late source writes',async()=>{
  const f=await webJob(),job=await f.tasks.get(f.job.jobId);
  await f.tasks.checkpoint(f.job.jobId,f.attempt,job!.seq+1,'不能冒充联网成功',{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});
  await expect(f.tasks.finish(f.job.jobId,f.attempt,'completed',null,'fake')).rejects.toMatchObject({code:'web-no-sources'});
  await f.tasks.finish(f.job.jobId,f.attempt,'stopped');
  await f.tasks.webEvidence(f.job.jobId,f.attempt,evidence());
  expect((await f.tasks.get(f.job.jobId))!.attempts[0].webEvidence).toBeUndefined();
  const retry=await f.tasks.retry(f.job.jobId);expect(retry.snapshot).toEqual(f.job.snapshot);expect(retry.attempts.at(-1)!.webEvidence).toBeUndefined();
  await f.tasks.webEvidence(f.job.jobId,f.attempt,evidence());
  expect((await f.tasks.get(f.job.jobId))!.attempts.at(-1)!.webEvidence).toBeUndefined();
});
test('safe literal identities and actual answer references stay distinct from facts or older/changed links',()=>{
  for(const bad of ['javascript:alert(1)','http://example.test','https://user:pass@example.test/','https://a.test/?token=x','https://a.test/?%61pi_key=x','https://a.test/?X-Amz-Signature=x','https://a.test/#%ZZ'])expect(publicWebUri(bad)).toBe(false);
  for(const bad of ['https://localhost/','https://127.0.0.1/','https://[::1]/'])expect(publicWebUri(bad)).toBe(false);
  expect(publicWebUri(uri)).toBe(true);expect(publicWebUri('https://a.test/?percent=100%25')).toBe(true);
  expect(relateWebAnswer(evidence(),`<${uri}>`).status).toBe('cited');
  expect(relateWebAnswer(evidence(),'仅模型解释')).toMatchObject({status:'uncited',references:[]});
  expect(relateWebAnswer(evidence(),'<https://docs.example.test/topic?ref=other#part>')).toMatchObject({status:'unmatched',references:[{sourceId:null}]});
});
test('empty/secret sources, HTTP errors, cancellation and malformed replies have no fallback or retries',async()=>{
  for(const [response,code] of [
    [new Response('',{status:401}),'auth'],[new Response('',{status:429}),'rate-limit'],
    [new Response('',{status:400}),'web-tool'],[new Response('',{status:404}),'web-unsupported'],
    [Response.json({content:[]}),'web-protocol'],
    [Response.json({results:[]}),'web-no-sources'],
    [Response.json(reply('https://example.test/?token=PRIVATE')),'web-no-sources'],
    [Response.json({results:[{url:uri,title:'只有标题'}]}),'web-no-sources'],
  ] as const){let calls=0;const port=createWebEvidencePort('FAKE_T14_KEY',webTransport(()=>{calls++;return response;}));await expect(port.retrieve({question:'问题',options:webOptions()},new AbortController().signal)).rejects.toMatchObject({code});expect(calls).toBe(1);}
  const controller=new AbortController();let aborted=false;
  const port=createWebEvidencePort('FAKE_T14_KEY',async(_url,init)=>new Promise((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));});}));
  const run=port.retrieve({question:'问题',options:webOptions()},controller.signal);controller.abort();
  await expect(run).rejects.toMatchObject({code:'timeout'});expect(aborted).toBe(true);
  const escapedKey='FAKE_"KEY',echo={results:[{url:uri,summary:escapedKey}]};
  await expect(createWebEvidencePort(escapedKey,webTransport(()=>Response.json(echo))).retrieve({question:'问题',options:webOptions()},new AbortController().signal)).rejects.toMatchObject({code:'web-protocol'});
});
test('web evidence composes with Chat, Markdown, HTML pages and frozen manual/T16 images on the selected answer model',async()=>{
  for(const outputType of ['chat','markdown','html'] as const){
    const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),tasks=new IndexedGenerationStore(name),attachments=new IndexedAttachmentStore(name),a=await spaces.open(source);
    const target={kind:'chat' as const,workspaceId:a.id,chatId:a.chatId};
    await attachments.add(target,basis.binding,0,{dataUrl:png(),width:2,height:2,time:0});
    const draft=(await spaces.read(a.id,a.chatId))!.draft;
    await spaces.save(a.id,draft.revision,{...draft,outputType,text:'结合画面和网页解释',webEnabled:true,modelId:'chosen-vision'},a.chatId);
    const job=await tasks.freezeChat(target,draft.revision+1,basis,true,true),attempt=job.attempts[0].attemptId;
    await tasks.attach(job.jobId,attempt,1);await tasks.claim(job.jobId,attempt,1);
    let searches=0;
    const web=await createWebEvidencePort('FAKE_T14_KEY',webTransport(()=>{searches++;return Response.json(reply());})).retrieve({question:'画面问题',options:webOptions()},new AbortController().signal);
    await tasks.webEvidence(job.jobId,attempt,web.evidence);
    const captured=await tasks.visual(job.jobId,attempt,{phase:'capturing',plan:{times:[1],reason:'画面依据'},attachmentIds:[],resolution:'images'},{dataUrl:png(),width:2,height:2,time:1});
    const visual=captured.attempts[0].visual!;
    let seq=(await tasks.visual(job.jobId,attempt,{...visual,phase:'answering',frozen:true})).seq,calls=0;
    const images=[...await attachments.forSnapshot(job.snapshot as ChatRequestSnapshot),...await attachments.read(target,visual.attachmentIds,true)];
    const page=`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width"><title>画面与网页</title></head><body><p>网页补充 <a href="${uri}">来源</a></p></body></html>`;
    await runChat(job.snapshot as ChatRequestSnapshot,[{from:0,to:2,content:'视频字幕'}],{async stream(model,messages,_signal,delta){
      calls++;expect(model).toBe('chosen-vision');
      expect(messages[0].content).toContain(outputType==='html'?'HTML 页面':outputType==='markdown'?'Markdown 正文':'Chat 问答');
      expect(messages[1].role).toBe('user');expect(messages[1].content).toContain(uri);expect(messages[0].content).toContain('按实际使用的资料区分视频原意');
      expect((messages.at(-1)!.content as any[]).filter(p=>p.type==='image_url')).toHaveLength(2);
      expect(JSON.stringify(messages.at(-1))).toContain('本请求自主取帧');
      await delta(outputType==='html'?page:`视频依据 [00:01]；网页补充 [来源](${uri})`);
    }},new AbortController().signal,async(text,coverage)=>{seq=(await tasks.checkpoint(job.jobId,attempt,seq+1,text,coverage)).seq;},images,undefined,visual.attachmentIds,'',web);
    await tasks.finish(job.jobId,attempt,'completed',null,'result');
    expect(searches).toBe(1);expect(calls).toBe(1);
    expect((await tasks.view(target)).messages.at(-1)!.webEvidence?.status).toBe('cited');
    if(outputType==='html')expect((await new IndexedKnowledgeStore(name).list(a.id,undefined,true))[0]).toMatchObject({type:'html-page',source:page,webEvidence:{status:'cited'}});
    if(outputType==='markdown')expect((await new IndexedArtifactStore(name).list(a.id))[0].webEvidence?.status).toBe('cited');
    await new IndexedBackupStore(crypto.randomUUID()).preview(await new IndexedBackupStore(name).export());
  }
});
test('offline final generation contains no current web evidence and sends every subtitle segment once',async()=>{
  const f=await webJob(),snapshot={...f.job.snapshot,webEnabled:false,web:undefined} as ChatRequestSnapshot;
  const calls:any[]=[];const provider={async stream(_model:string,messages:any,_signal:AbortSignal,delta:(s:string)=>Promise<void>){calls.push(messages);await delta('有界归纳');}};
  const cues=Array.from({length:10},(_,i)=>({from:i*2,to:i*2+2,content:'字幕'.repeat(1500)}));
  await runChat(snapshot,cues,provider,new AbortController().signal,async()=>{});
  expect(calls).toHaveLength(1);expect(JSON.stringify(calls)).not.toContain(uri);for(const cue of cues)expect(JSON.stringify(calls[0])).toContain(cue.content);
  calls.length=0;
  await runChat(f.job.snapshot as ChatRequestSnapshot,cues,provider,new AbortController().signal,async()=>{},[],undefined,[],'',{evidence:evidence(),material:'网页资料'});
  expect(calls).toHaveLength(1);expect(JSON.stringify(calls[0])).toContain(uri);
});
test('importing an active search marks both attempt and message interrupted, with no resumed retrieval',async()=>{
  const f=await webJob();await f.tasks.webEvidence(f.job.jobId,f.attempt,{...evidence(),status:'searching',executionLinked:false,sources:[]});
  const file=await new IndexedBackupStore(f.name).export(),name=crypto.randomUUID(),backup=new IndexedBackupStore(name),plan=await backup.preview(file);await backup.execute(plan.planId,plan.checksum);
  const view=await new IndexedGenerationStore(name).view(f.target);
  expect(view.jobs[0]).toMatchObject({state:'interrupted',webEvidence:{status:'failed'}});
  expect(view.messages.at(-1)).toMatchObject({state:'interrupted',webEvidence:{status:'failed'}});
});
test('deleting then restoring a searching Chat keeps its terminal evidence and rejects late retrieval',async()=>{
  const f=await webJob();await f.tasks.webEvidence(f.job.jobId,f.attempt,{...evidence(),status:'searching',executionLinked:false,sources:[]});
  const manager=new IndexedManagementStore(f.name),target={workspaceId:f.a.id,entityType:'chat' as const,id:f.a.chatId};
  await manager.move(target,0);await f.tasks.webEvidence(f.job.jobId,f.attempt,evidence());
  await manager.restore(target,1);await f.tasks.webEvidence(f.job.jobId,f.attempt,evidence());
  expect((await f.tasks.view(f.target)).messages.at(-1)).toMatchObject({state:'stopped',webEvidence:{status:'failed',sources:[]}});
  await new IndexedBackupStore(crypto.randomUUID()).preview(await new IndexedBackupStore(f.name).export());
});
