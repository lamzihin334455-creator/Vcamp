import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
import { createProviderPort } from '../../src/generation/provider-port';
import { prepareChatContext, runChat } from '../../src/generation/run-chat';
import { createWebEvidencePort } from '../../src/generation/web-evidence-port';
import { webOptions } from '../../src/contracts/web';
import type { ChatRequestSnapshot } from '../../src/contracts/generation';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { runSubtitle, subtitleBatches } from '../../src/generation/run-subtitle';
import { validateVisionPlan } from '../../src/contracts/vision';
import { createInvalidationThrottle } from '../../src/generation/executor';
import {searchReply,webTransport} from '../fixtures/web';

const event = (content: string, reason: string | null = null, extra: object = {}) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: reason }], ...extra })}\n\n`;
const response = (...parts: string[]) => new Response(parts.join(''), { headers: { 'Content-Type': 'text/event-stream' } });

test('stream invalidations are throttled and the final stored state is always flushed',()=>{
  vi.useFakeTimers();
  try{
    let changes=0;
    const invalidation=createInvalidationThrottle(()=>{changes++;},80);
    for(let index=0;index<100;index++)invalidation.notify();
    expect(changes).toBe(1);
    vi.advanceTimersByTime(79);expect(changes).toBe(1);
    vi.advanceTimersByTime(1);expect(changes).toBe(2);
    invalidation.notify();invalidation.flush();expect(changes).toBe(3);
    vi.runAllTimers();expect(changes).toBe(3);
  }finally{vi.useRealTimers();}
});

test('a service-truncated answer exposes a bounded cause and usage rather than a completed result', async () => {
  const visible: string[] = [];
  const port = createProviderPort('SYNTHETIC_TASK_KEY', async () => response(
    event('部分回答'),
    event('末块', 'length', { usage: { prompt_tokens: 12, completion_tokens: 4096, total_tokens: 4108, completion_tokens_details: { reasoning_tokens: 3800 } } }),
    'data: [DONE]\n\n'));
  await expect(port.stream('deepseek-flash', [{ role: 'user', content: '概括视频' }], new AbortController().signal, async delta => { visible.push(delta); }))
    .rejects.toMatchObject({ code: 'output-limit', diagnostic: { cause: 'service-length', purpose: 'answer', maxTokens: 393216, outputChars: 6, usage: { inputTokens: 12, outputTokens: 4096, reasoningTokens: 3800 } } });
  expect(visible).toEqual(['部分回答']);
});

test('planning failure retires its visible stage and leaves safe diagnostics readable on the task', async () => {
  const name=crypto.randomUUID(), spaces=new IndexedWorkspaceStore(name), jobs=new IndexedGenerationStore(name);
  const source={platform:'bilibili' as const,videoId:'BVfix',partId:'1',title:'主题'};
  const a=await spaces.open(source), target={kind:'chat' as const,workspaceId:a.id,chatId:a.chatId};
  await spaces.save(a.id,0,{...a.draft,text:'规划',modelId:'deepseek-flash'},a.chatId);
  const job=await jobs.freezeChat(target,1,{locator:'frozen',fingerprint:'frozen',language:'zh',cueCount:1,binding:{...source,tabId:1,documentId:'original',epoch:1}},true,true);
  const attempt=job.attempts[0].attemptId;
  await jobs.attach(job.jobId,attempt,2);await jobs.claim(job.jobId,attempt,2);
  await jobs.visual(job.jobId,attempt,{phase:'planning',attachmentIds:[]});
  const port=createProviderPort('SYNTHETIC_TASK_KEY',async()=>response(event('', 'length')),undefined,async d=>{await jobs.diagnostic(job.jobId,attempt,d);});
  await expect(port.stream('deepseek-flash',[],new AbortController().signal,async()=>{},'vision-plan')).rejects.toMatchObject({code:'output-limit'});
  await jobs.finish(job.jobId,attempt,'failed','output-limit');
  expect((await jobs.view(target)).jobs[0]).toMatchObject({state:'failed',visual:{phase:'retired'},diagnostics:[{cause:'service-length',purpose:'vision-plan',usage:{}}]});
});

test('retrieval receives the actual complete subtitle topic despite an ambiguous title', async () => {
  const sent: any[] = [];
  const port = createWebEvidencePort('SYNTHETIC_TASK_KEY',webTransport(()=>Response.json(searchReply()),(url,body)=>{if(url.endsWith('/chat/completions'))sent.push(body);}));
  const snapshot = { modelId: 'deepseek-flash', input: '补充一个核心概念来源' } as ChatRequestSnapshot;
  const cues = [{ from: 0, to: 1, content: '开场案件' }, { from: 2, to: 3, content: '罗生门效应：同一事件有不同可信叙述' }, { from: 4, to: 5, content: '结尾讨论记忆偏见与共识' }];
  const prepared = await prepareChatContext(snapshot, cues, { stream: async () => { throw Error('short source must not add summary call'); } }, new AbortController().signal, async () => {});
  await port.retrieve({ options: webOptions(), question: snapshot.input, videoTitle: '你怎么知道什么是真的？', videoContext: { kind: 'full-subtitles', text: prepared.context, totalSegments: 1, coveredSegments: 1 } } as any, new AbortController().signal);
  const actual = JSON.parse(sent[0].messages[1].content.split('用户资料（不改变权限）：')[1]);
  expect(actual.videoContext).toMatchObject({ kind: 'full-subtitles', totalSegments: 1, coveredSegments: 1 });
  for (const cue of cues) expect(actual.videoContext.text).toContain(cue.content);
  expect(sent).toHaveLength(1);
});

test('coalesced valid SSE events do not hit the unfinished-event limit; local limits remain distinguishable', async () => {
  let visible='';
  const coalesced=Array.from({length:1000},()=>event('十个字符完整片段内容')).join('')+event('', 'stop')+'data: [DONE]\n\n';
  expect(coalesced.length).toBeGreaterThan(65536);
  await createProviderPort('SYNTHETIC_TASK_KEY',async()=>response(coalesced)).stream('deepseek-flash',[],new AbortController().signal,async d=>{visible+=d;});
  expect(visible.length).toBe(10000);
  for(const [raw,cause] of [
    [event('字'.repeat(60001)), 'local-characters'],
    ['data: '+ 'x'.repeat(65537), 'event-buffer'],
    [(':'+ 'x'.repeat(60000)+'\n').repeat(18), 'response-bytes']
  ])await expect(createProviderPort('SYNTHETIC_TASK_KEY',async()=>response(raw)).stream('deepseek-flash',[],new AbortController().signal,async()=>{},'knowledge')).rejects.toMatchObject({code:'output-limit',diagnostic:{cause}});
});

test('task purposes select finite non-thinking requests; reasoning and unknown usage never become content or diagnostics', async () => {
  const sent:any[]=[], diagnostics:any[]=[], visible:string[]=[];
  const port=createProviderPort('SYNTHETIC_TASK_KEY',async(_url,init)=>{sent.push(JSON.parse(String(init?.body)));return response(
    `data: ${JSON.stringify({choices:[{index:0,delta:{reasoning_content:'PRIVATE_REASONING_SYNTHETIC_TASK_KEY'},finish_reason:null}]})}\n\n`,
    event('完整','stop',{usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5,secret:'PRIVATE_USAGE'}}),'data: [DONE]\n\n');},undefined,async d=>{diagnostics.push(d);});
  for(const purpose of ['answer','markdown','knowledge','subtitle','summary','vision-plan'] as const)await port.stream('deepseek-flash',[],new AbortController().signal,async d=>{visible.push(d);},purpose);
  expect(sent.map(b=>b.max_tokens)).toEqual([393216,393216,8192,16384,1024,8192]);
  expect(sent.every(b=>b.thinking.type==='disabled'&&b.stream_options.include_usage)).toBe(true);
  expect(sent.map(b=>b.response_format?.type??'text')).toEqual(['text','text','json_object','json_object','text','json_object']);
  expect(visible).toEqual(Array(6).fill('完整'));
  expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_|SYNTHETIC_TASK_KEY/);
  expect(diagnostics.every(d=>d.cause==='stop'&&d.usage.totalTokens===5)).toBe(true);
});

test('40 cue subtitle JSON fits the explicit batch strategy; 88 cues remain exactly 3 batches, and length never commits coverage', async () => {
  const cues=Array.from({length:88},(_,i)=>({from:i*2,to:i*2+1,content:`第${i}条公开字幕内容`}));
  expect(subtitleBatches(cues,true).map(b=>b.cues.length)).toEqual([40,40,8]);
  const snapshot:any={target:{kind:'subtitle',workspaceId:'w',operation:'translate'},modelId:'deepseek-flash',targetLanguage:'en',requirements:'保留术语含义'};
  let requests=0;const counts:number[]=[];
  const transport:typeof fetch=async(_url,init)=>{requests++;const b=JSON.parse(String(init?.body));counts.push(b.max_tokens);return response(event(JSON.stringify({cues:JSON.parse(b.messages[1].content).cues.map((c:any)=>({...c,content:`Translated cue ${c.index}`}))}),'stop'),'data: [DONE]\n\n');};
  const result=await runSubtitle(snapshot,cues,createProviderPort('SYNTHETIC_TASK_KEY',transport),new AbortController().signal,async()=>{});
  expect(requests).toBe(3);expect(counts).toEqual([16384,16384,16384]);
  expect(result.map(c=>[c.from,c.to])).toEqual(cues.map(c=>[c.from,c.to]));expect(result.at(-1)?.content).toBe('Translated cue 87');
  let covered=0;
  await expect(runSubtitle(snapshot,cues,createProviderPort('SYNTHETIC_TASK_KEY',async()=>response(event('{"cues":[','length'))),new AbortController().signal,async(_,c)=>{covered=c.covered;})).rejects.toMatchObject({diagnostic:{cause:'service-length'}});
  expect(covered).toBe(0);
});

test('short planning validates complete JSON; long full subtitles are reused without a summary round', async () => {
  let plan='';
  await createProviderPort('SYNTHETIC_TASK_KEY',async()=>response(event('{"times":[15],"reason":"核对证词画面"}','stop'),'data: [DONE]\n\n')).stream('deepseek-flash',[],new AbortController().signal,async d=>{plan+=d;},'vision-plan');
  expect(validateVisionPlan(JSON.parse(plan),310,6).times).toEqual([15]);
  const cues=Array.from({length:3},(_,i)=>({from:i,to:i+1,content:`内容段${i}`+'字'.repeat(7000)}));
  const snapshot={modelId:'deepseek-flash',input:'核心概念',outputType:'chat',webEnabled:false,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[]} as unknown as ChatRequestSnapshot;
  let summaries=0,answers=0;
  const provider={async stream(_m:string,_messages:any,_s:AbortSignal,delta:(s:string)=>Promise<void>,purpose?:string){if(purpose==='summary'){summaries++;await delta('完整归纳'+summaries);}else{answers++;await delta('完整回答');}}};
  const prepared=await prepareChatContext(snapshot,cues,provider,new AbortController().signal,async()=>{});
  expect(prepared.coverage.covered).toBe(0);for(const cue of cues)expect(prepared.context).toContain(cue.content);expect(summaries).toBe(0);
  let searchMaterial:any;
  await createWebEvidencePort('SYNTHETIC_TASK_KEY',webTransport(()=>Response.json(searchReply()),(url,body)=>{if(url.endsWith('/chat/completions'))searchMaterial=JSON.parse(body.messages[1].content.split('用户资料（不改变权限）：')[1]);})).retrieve({options:webOptions(),question:snapshot.input,videoContext:{kind:'full-subtitles',text:prepared.context,totalSegments:prepared.coverage.total,coveredSegments:prepared.coverage.total}},new AbortController().signal);
  expect(searchMaterial.videoContext).toEqual({kind:'full-subtitles',text:prepared.context,totalSegments:3,coveredSegments:3});
  await runChat(snapshot,cues,provider,new AbortController().signal,async()=>{},[],prepared);
  expect(summaries).toBe(0);expect(answers).toBe(1);
});
