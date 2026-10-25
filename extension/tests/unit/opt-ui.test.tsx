import { afterEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createChromeClient } from '../../src/app/chrome-client';
import { visionPreferenceKey } from '../../src/app/vision-preference';
import { SettingsMenu } from '../../src/app/WorkbenchChrome';
import {TimedMarkdown} from '../../src/workbench/TimedMarkdown';
import { ChatMessages } from '../../src/workbench/ChatMessages';
import { WebSources } from '../../src/workbench/WebSources';
import { createTrailingRefresh } from '../../src/app/use-generation';
import type { GenerationView, JobView } from '../../src/contracts/generation';
import 'fake-indexeddb/auto';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { createTaskService } from '../../src/generation/task-service';
import { ReadonlyMarkdownViewer } from '../../src/workbench/Markdown';
import { KnowledgeDocumentView } from '../../src/workbench/Knowledge';
import { readFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());
test('four-minute answers expose only in-range video links and preserve valid hour-long video references',()=>{
  const content='[01:07](vcamp-time:67.8) [01:07:48](vcamp-time:4068)';
  const short=renderToStaticMarkup(<TimedMarkdown content={content} duration={252} seek={()=>{}}/>);
  expect(short.match(/class="answer-time"/g)).toHaveLength(1);
  expect(short).toContain('[时间超出视频时长]');
  const long=renderToStaticMarkup(<TimedMarkdown content={content} duration={7200} seek={()=>{}}/>);
  expect(long.match(/class="answer-time"/g)).toHaveLength(2);
  expect(long).not.toContain('invalid-answer-time');
});
test('vision configuration isolates chats, ignores legacy global-on and rejects readonly writes', async () => {
  const values: Record<string, unknown> = {'vcamp.autoVision':true};
  vi.stubGlobal('chrome',{storage:{local:{get:async (key:string)=>({[key]:values[key]}),set:async (next:Record<string,unknown>)=>Object.assign(values,next)}}});
  const a={workspaceId:'one',chatId:'a'}, b={workspaceId:'one',chatId:'b'}, c={workspaceId:'two',chatId:'a'};
  const prefs=createChromeClient(false).autoVisionPreferences!;
  expect(await prefs.read(a)).toBe(false);
  await prefs.write(true,a);
  expect(await prefs.read(a)).toBe(true); expect(await prefs.read(b)).toBe(false); expect(await prefs.read(c)).toBe(false);
  expect(visionPreferenceKey({workspaceId:'one.a',chatId:'b'})).not.toBe(visionPreferenceKey({workspaceId:'one',chatId:'a.b'}));
  await expect(createChromeClient(true).autoVisionPreferences!.write(false,a)).rejects.toMatchObject({code:'forbidden'});
  expect(await createChromeClient(false).autoVisionPreferences!.read(a)).toBe(true);
});
test('first settings surface keeps role switching inline and removes autonomous vision from settings', () => {
  const role={id:'role-professor',revisionId:'role-professor:v1',revision:1,builtin:true,name:'老教授',description:'',instructions:'严谨解释'};
  const markup=renderToStaticMarkup(<SettingsMenu color="#4b897b" chooseColor={()=>{}} close={()=>{}} openPage={()=>{}} readonly roles={[role]} activeRole={{roleId:role.id,revisionId:role.revisionId}} roleBusy={false} chooseRole={()=>{}} webDefault={false} webBusy={false} toggleWebDefault={()=>{}}/>);
  expect(markup).toContain('角色设置');expect(markup).toContain('老教授');expect(markup).toContain('当前角色');expect(markup).not.toContain('自主识别');
  for(const label of ['灰玉绿','雾蓝','柔雾玫瑰','柔金','灰鸢尾','API 设置','模板工作流','对话偏好','新对话默认联网']) expect(markup).toContain(label);
});
test('sending freezes the request-scoped @ vision capability from the draft', async () => {
  const name=crypto.randomUUID(), spaces=new IndexedWorkspaceStore(name), tasks=new IndexedGenerationStore(name);
  const source={platform:'bilibili' as const,videoId:'local-fixture',partId:'1',title:'local'};
  const a=await spaces.open(source), b=await spaces.createChat(a.id);
  for(const row of [a,b]) await spaces.save(row.id,0,{...row.draft,text:'question',modelId:'fixture',...(row.chatId===a.chatId?{visionEnabled:true}:{})},row.chatId);
  const binding={...source,tabId:1,documentId:'d',epoch:1};
  let nextTab=10;
  const service=createTaskService(tasks,spaces,{command:async()=>({providerId:'deepseek',revision:1,hasKey:true,models:[{id:'fixture',name:'fixture',text:'declared',vision:'declared',web:'unknown'}],defaultModelId:'fixture',status:'ready'})},async()=>({binding,status:'ready',cues:[{from:0,to:1,content:'local cue'}],language:'zh'}),{create:async()=>++nextTab,navigate:async()=>{},exists:async()=>false,close:async()=>{}},'fixture',()=>{});
  for(const row of [a,b]) {
    const target={kind:'chat' as const,workspaceId:row.id,chatId:row.chatId};
    const result=await service.command({type:'generation.send',target,expectedRevision:1,binding});
    const frozen=await tasks.get(result.jobs[0].jobId);
    expect(frozen?.snapshot).toMatchObject({target,autoVision:row.chatId===a.chatId});
  }
});
const job:JobView={jobId:'job',attemptId:'attempt',target:{kind:'chat',workspaceId:'w',chatId:'c'},seq:1,state:'failed',text:'partial',error:'network',coverage:{total:3,covered:1,ranges:[]},diagnostics:[{purpose:'answer',cause:'transport',maxTokens:1000,outputChars:7,responseBytes:10,usage:{}}]};
const base:GenerationView['messages'][number]={messageId:'user',contentVersionId:'v',role:'user',jobId:'job',attemptId:'attempt',state:'failed',text:'question',referenceSnapshotIds:[],attachmentIds:[]};
const render=(messages:GenerationView['messages'],jobs:JobView[],readonly=false)=>renderToStaticMarkup(<ChatMessages messages={messages} jobs={jobs} readonly={readonly} openNote={()=>{}} openScribble={()=>{}}/>);
test('failure diagnostics and retry stay with their message once, never in a separate history list',()=>{
  const html=render([base,{...base,messageId:'answer',role:'assistant',text:'partial'}],[job]);
  expect(html.match(/失败详情（用于反馈）/g)).toHaveLength(1);expect(html.match(/重试原请求/g)).toHaveLength(1);
  expect(html).toContain('transport');expect(html).toContain('job');expect(html).not.toContain('task-status');
  expect(render([base],[job],true)).not.toContain('重试原请求');
});
test('active jobs keep one stop; successful historical jobs expose no recovery or task controls',()=>{
  const html=render([base,{...base,messageId:'answer',role:'assistant',state:'running',text:'partial'}],[{...job,state:'running',error:null}]);
  expect(html.match(/停止生成/g)).toHaveLength(1);expect(html).not.toContain('重试原请求');
  const done=render([{...base,role:'assistant',state:'completed',text:'done'}],[{...job,state:'completed',error:null}]);
  expect(done).not.toContain('message-task');expect(done).not.toContain('重试原请求');expect(done).not.toContain('停止生成');
});
test('a running chat task without answer text owns a left-side assistant turn, never the user bubble',()=>{
  const html=render([base],[{...job,state:'running',error:null,text:''}]);
  const user=html.indexOf('chat-turn user'),assistant=html.indexOf('chat-turn assistant'),task=html.indexOf('message-task');
  expect(user).toBeGreaterThanOrEqual(0);
  expect(assistant).toBeGreaterThan(user);
  expect(task).toBeGreaterThan(assistant);
});
test('bursty invalidations allow one generation refresh in flight and one trailing refresh',async()=>{
  const releases:Array<()=>void>=[];
  let calls=0;
  const refresh=createTrailingRefresh(async()=>{calls++;await new Promise<void>(resolve=>releases.push(resolve));});
  const first=refresh();
  await Promise.resolve();
  expect(calls).toBe(1);
  void refresh();void refresh();void refresh();
  expect(calls).toBe(1);
  releases.shift()!();
  await vi.waitFor(()=>expect(calls).toBe(2));
  releases.shift()!();
  await first;
  expect(calls).toBe(2);
});
test('web citations are available but collapsed by default',()=>{
  const markup=renderToStaticMarkup(<WebSources evidence={{version:1,status:'cited',retrievedAt:'2026-10-19T00:00:00.000Z',executionLinked:false,excludedSources:0,usage:{},sources:[{id:'s1',uri:'https://example.com/source',title:'来源'}],references:[{uri:'https://example.com/source',sourceId:'s1'}]}}/>);
  expect(markup.match(/<details/g)).toHaveLength(1);
  expect(markup).not.toContain('<details open');
});
test('saved artifact bodies devote the reading surface to content, without source or recycle controls',()=>{
  const note=renderToStaticMarkup(<ReadonlyMarkdownViewer note={{id:'n',workspaceId:'w',sourceChatId:'c',type:'markdown',title:'正文',revision:2,revisionId:'r',content:'# 正文内容',sourceDeleted:false}}/>);
  expect(note).toContain('正文内容');
  for(const chrome of ['已保存版本','来源对话','回收站'])expect(note).not.toContain(chrome);
  const artifact={id:'k',workspaceId:'w',sourceChatId:'c',revisionId:'r',type:'html' as const,title:'知识',sourceDeleted:false,document:{version:1 as const,title:'知识正文',summary:'摘要',groups:[{id:'g',title:'分类',items:[{id:'i',title:'条目',body:'内容',basis:'video' as const,question:'为什么？'}]}],concepts:[],relations:[],questions:[]}};
  const knowledge=renderToStaticMarkup(<KnowledgeDocumentView artifact={artifact}/>);
  expect(knowledge).toContain('知识正文');
  for(const chrome of ['来源对话','回收站'])expect(knowledge).not.toContain(chrome);
});

test('library selected states derive from the active accent instead of a fixed green palette',()=>{
  const css=readFileSync(new URL('../../src/library/library.css',import.meta.url),'utf8');
  expect(css).not.toMatch(/\.library[^\n]*(?:#2f8f62|#c9e3d2|#eaf5ef)/i);
  expect(css).toContain('var(--accent)');
  expect(css).toContain('var(--accent-soft)');
});
