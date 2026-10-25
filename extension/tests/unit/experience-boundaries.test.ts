import 'fake-indexeddb/auto';
import {test,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedKnowledgeStore} from '../../src/data/knowledge-store';
import {createProviderPort,ProviderError} from '../../src/generation/provider-port';
import {runChat} from '../../src/generation/run-chat';
import {ApplicationError} from '../../src/contracts/application';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import {TimedMarkdown,markdownBody} from '../../src/workbench/TimedMarkdown';
import {taskFailureMessage} from '../../src/workbench/MessageTask';

const html='<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>证据与解释</title><style>body{font:17px/1.7 sans-serif;color:#203b36;background:#faf9f4;margin:18px}button{font:inherit;padding:8px}</style></head><body><h1>证据与解释</h1><p>比较观点时先确认依据，再辨认补充解释。</p><button onclick="document.querySelector(\'aside\').hidden=false">展开解释</button><aside hidden>自信程度不等于独立证据充分。</aside></body></html>';
const event=(content:string,finish_reason:string|null=null)=>'data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason}]})+'\n\n';
test('synthetic HTML boundaries distinguish token, characters, structure, EOF and timeout without saved failures or retries',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),tasks=new IndexedGenerationStore(name),pages=new IndexedKnowledgeStore(name);
  const source={platform:'bilibili' as const,videoId:'BVbounds',partId:'11',title:'合成边界'};
  const space=await spaces.open(source),basis={binding:{...source,tabId:99,documentId:'fixture',epoch:1},locator:'local',fingerprint:'local',language:'zh',cueCount:1};
  const cases=[
    {name:'complete',text:'说明\n```html\n'+html+'\n```\n可点击展开。',finish:'stop',cause:'stop',envelope:'complete',error:null},
    {name:'provider-token',text:html.slice(0,-100),finish:'length',cause:'service-length',envelope:'missing-end',error:'output-limit'},
    {name:'local-characters',text:html.replace('<body>','<body>'+'x'.repeat(4000000)),finish:'stop',cause:'local-characters',envelope:'oversize',error:'output-limit'},
    {name:'structure',text:html.slice(0,-7),finish:'stop',cause:'stop',envelope:'missing-end',error:'html-format'},
    {name:'stream-eof',text:html.slice(0,-100),finish:null,cause:'protocol',envelope:'missing-end',error:'protocol'},
    {name:'timeout',text:'',finish:null,cause:'cancelled',envelope:'missing-start',error:'timeout'}
  ];
  for(const replay of cases){
    const current=(await spaces.read(space.id,space.chatId))!;
    await spaces.save(space.id,current.draft.revision,{...current.draft,text:replay.name,modelId:'synthetic',outputType:'html'},space.chatId);
    const job=await tasks.freezeChat({kind:'chat',workspaceId:space.id,chatId:space.chatId},current.draft.revision+1,basis),attempt=job.attempts[0].attemptId;
    await tasks.attach(job.jobId,attempt,99);await tasks.claim(job.jobId,attempt,99);
    let calls=0,request:any;const controller=new AbortController();
    const provider=createProviderPort('SYNTHETIC_NO_REAL_KEY',async(_input,init)=>{
      calls++;request=JSON.parse(init!.body as string);
      if(replay.name==='timeout'){controller.abort();throw new DOMException('Synthetic timeout','AbortError');}
      const chunks=replay.name==='local-characters'?[replay.text]:replay.text.match(/[\s\S]{1,16000}/g)??[];
      return new Response(chunks.map(c=>event(c)).join('')+(replay.finish?event('',replay.finish)+'data: [DONE]\n\n':''),{headers:{'content-type':'text/event-stream'}});
    },undefined,async d=>{await tasks.diagnostic(job.jobId,attempt,d);});
    let error:string|null=null;
    try{
      await runChat(job.snapshot as ChatRequestSnapshot,[{from:0,to:1,content:'合成字幕依据'}],provider,controller.signal,async(text,coverage)=>{const row=(await tasks.get(job.jobId))!;await tasks.checkpoint(job.jobId,attempt,row.seq+1,text,coverage);});
      await tasks.finish(job.jobId,attempt,'completed',null,crypto.randomUUID());
    }catch(e){error=e instanceof ProviderError||e instanceof ApplicationError?e.code:'unexpected';await tasks.finish(job.jobId,attempt,'failed',error as any);}
    const finished=(await tasks.get(job.jobId))!,last=finished.attempts.at(-1)!;
    expect({error,calls,maxTokens:request.max_tokens},replay.name).toEqual({error:replay.error,calls:1,maxTokens:393216});
    expect(last.diagnostics?.at(-1),replay.name).toMatchObject({purpose:'html-page',cause:replay.cause,htmlEnvelope:replay.envelope});
    expect(last.state).toBe(replay.error?'failed':'completed');
    expect(await pages.list(space.id,undefined,true)).toHaveLength(1);
  }
});

test('view-only Markdown compatibility preserves hierarchy and excludes ambiguous clock, code and URLs',()=>{
  const source='# 标题 [00:01]\n\n- 列表 [00:02] **重点**\n\n视频 00:03；钟点 12:30；比率 4:3；[原资料](https://x.test/%5B00:04%5D)\n\n> 引用\n\n`[00:05]`\n\n```js\nconst t="[00:06]";\n```\n\n| 依据 | 解释 |\n| --- | --- |\n| 视频 | 补充 |';
  const rendered=renderToStaticMarkup(createElement(TimedMarkdown,{content:source,seek:()=>{}}));
  expect(rendered).toContain('<h1>');expect(rendered).toContain('<strong>重点</strong>');expect(rendered).toContain('<table>');expect(rendered).toContain('<blockquote>');
  expect(rendered.match(/class="answer-time"/g)).toHaveLength(3);expect(rendered).toContain('<code>[00:05]</code>');expect(rendered).toContain('href="https://x.test/%5B00:04%5D"');
  const wrapped='```markdown\n# 旧包装\n\n**正文** [00:02]\n```';expect(markdownBody(wrapped)).toBe('# 旧包装\n\n**正文** [00:02]');expect(wrapped).toContain('```');
  expect(markdownBody('```js\n[00:02]\n```')).toBe('```js\n[00:02]\n```');
  expect(taskFailureMessage({error:'output-limit',diagnostics:[{purpose:'html-page',cause:'service-length'}]} as any)).toContain('模型输出被服务端截断');
});
