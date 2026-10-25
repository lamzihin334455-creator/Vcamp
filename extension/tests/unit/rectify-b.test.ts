import 'fake-indexeddb/auto';
import {test, expect} from 'vitest';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedKnowledgeStore} from '../../src/data/knowledge-store';
import {IndexedScribbleStore} from '../../src/data/scribble-store';
import {VideoSessions} from '../../src/video/sessions';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {IndexedLibraryStore} from '../../src/data/library-store';
import {createProviderPort} from '../../src/generation/provider-port';
import {htmlInstructions,parseHtmlPage} from '../../src/contracts/html-page';
import {presetTemplates} from '../../src/workbench/template-presets';
import {createTaskService} from '../../src/generation/task-service';

const source={platform:'bilibili' as const,videoId:'BVhtml',partId:'1',title:'视频'};
const html='<!doctype html><html lang="zh"><head><title>阅读页</title><style>body{font-size:18px}</style></head><body><button onclick="this.textContent=\'完成\'">开始</button></body></html>';
test('new HTML request saves source as html-page, never parses JSON; invalid document cannot complete',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),tasks=new IndexedGenerationStore(name),pages=new IndexedKnowledgeStore(name);
  const a=await spaces.open(source);await spaces.save(a.id,0,{...a.draft,text:'生成阅读页面',outputType:'html',modelId:'fixture'},a.chatId);
  const job=await tasks.freezeChat({kind:'chat',workspaceId:a.id,chatId:a.chatId},1,{locator:'x',fingerprint:'f',language:'zh',cueCount:1,binding:{...source,tabId:1,documentId:'d',epoch:1}});
  expect(job.snapshot).toMatchObject({htmlFormat:1});
  const attempt=job.attempts[0].attemptId;await tasks.attach(job.jobId,attempt,2);const claimed=(await tasks.claim(job.jobId,attempt,2))!;
  await tasks.checkpoint(job.jobId,attempt,claimed.seq+1,html,{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});
  await tasks.finish(job.jobId,attempt,'completed',null,'page');
  expect(await pages.list(a.id,undefined,true)).toMatchObject([{id:'page',type:'html-page',pageVersion:1,source:html,sourceChatId:a.chatId}]);
  const library=new IndexedLibraryStore(name),folder=await library.createFolder('HTML 收藏');await library.addFavorite(folder.id,{workspaceId:a.id,entityType:'html',id:'page'});
  const backup=new IndexedBackupStore(name),file=await backup.export(),dest=crypto.randomUUID(),importer=new IndexedBackupStore(dest);
  expect(JSON.parse(file).manifest.formatVersion).toBe(6);
  const plan=await importer.preview(file);await importer.execute(plan.planId,plan.checksum);
  expect(await new IndexedKnowledgeStore(dest).list(a.id,'page',true)).toMatchObject([{id:'page',type:'html-page',pageVersion:1,source:html}]);
  expect((await new IndexedLibraryStore(dest).detail(a.id)).entities).toContainEqual(expect.objectContaining({id:'page',entityType:'html'}));
  expect((await new IndexedLibraryStore(dest).query()).favorites).toContainEqual(expect.objectContaining({target:{workspaceId:a.id,entityType:'html',id:'page'}}));
  await new IndexedBackupStore(crypto.randomUUID()).preview(await importer.export());
});
test('HTML envelope rejects JSON, incomplete and oversized output; one HTML fence preserves source',()=>{
  for(const value of ['{}',html.replace('</html>',''),html+'trailing',html.replace('</body>','x'.repeat(4000001)+'</body>')])expect(()=>parseHtmlPage(value)).toThrow();
  expect(parseHtmlPage('```html\n'+html+'\n```').source).toBe(html);
});
test('HTML generation policy keeps only format, readability and sandbox boundaries while leaving content design to the model',()=>{
  expect(htmlInstructions).toContain('<!doctype html>');
  expect(htmlInstructions).toContain('280–420px');
  expect(htmlInstructions).toContain('vcamp-time:67.8');
  expect(htmlInstructions).toContain('不换算链接目标');
  expect(htmlInstructions).not.toMatch(/4000–8000|统一视觉风格|按问题选择有价值的展开|测验|比较、筛选|区分视频依据、补充解释和推断/);
  const preset=presetTemplates.find(template=>template.id==='builtin-map')!;
  expect(preset).toMatchObject({revision:5,revisionId:'builtin-map:v5',outputProtocol:'html-page-v1'});
  expect(preset.requirements).not.toMatch(/风格统一|包含适合此主题的页内交互|区分视频依据与补充解释/);
});
test('HTML SSE tolerates token-sized event overhead above 1 MiB, with finite non-JSON output policy',async()=>{
  const event=(text:string,reason:string|null=null)=>'data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:reason}]})+'\n\n';
  const body=event('a').repeat(14000)+event('','stop')+'data: [DONE]\n\n';expect(body.length).toBeGreaterThan(1048576);
  let received='',request:any;
  const port=createProviderPort('SYNTHETIC_TASK_KEY',async(_url,init)=>{request=JSON.parse(String(init?.body));return new Response(body,{headers:{'Content-Type':'text/event-stream'}});});
  await port.stream('fixture',[],new AbortController().signal,async delta=>{received+=delta;},'html-page');
  expect(received).toHaveLength(14000);expect(request.max_tokens).toBe(393216);expect(request.response_format).toBeUndefined();
});
test('scribbles display time ascending, creation order on ties, untimed last; edits keep order',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),notes=new IndexedScribbleStore(name),a=await spaces.open(source);
  await notes.create(a.id,'末尾',null);const one=await notes.create(a.id,'同时间先',20);await notes.create(a.id,'开头',3);await notes.create(a.id,'同时间后',20);
  await notes.save(a.id,one.id,1,'同时间先已编辑');
  expect((await notes.list(a.id)).map(n=>n.text)).toEqual(['开头','同时间先已编辑','同时间后','末尾']);
});
test('navigation invalidation discards an in-flight old identity observation',async()=>{
  let release!:(value:any)=>void;
  const sessions=new VideoSessions({observe:()=>new Promise(resolve=>{release=resolve;}),read:async()=>({status:'ready',cues:[],language:null}),seek:async()=>({time:0,paused:true})});
  const old=sessions.observe(1);await Promise.resolve();await Promise.resolve();sessions.invalidate(1);
  release({documentId:'old',marker:'old',source});
  expect(await old).toMatchObject({source:null,binding:null,status:'loading',cues:[]});
});
test('saved enhanced subtitles cannot send an old Chat while active identity is unknown or a different P',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),tasks=new IndexedGenerationStore(name),a=await spaces.open(source);
  const binding={...source,tabId:1,documentId:'d',epoch:1},basis={binding,locator:'local',fingerprint:'f',language:'zh',cueCount:1};
  const sub=await tasks.freezeSubtitle({snapshotId:crypto.randomUUID(),target:{kind:'subtitle',workspaceId:a.id,operation:'enhance'},source:{locator:'local',fingerprint:'f'},targetLanguage:null,requirements:'',modelId:'fixture'},basis),attempt=sub.attempts[0].attemptId;
  await tasks.attach(sub.jobId,attempt,10);const claimed=(await tasks.claim(sub.jobId,attempt,10))!;await tasks.checkpoint(sub.jobId,attempt,claimed.seq+1,'',{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});await tasks.finish(sub.jobId,attempt,'completed',null,'enhanced',{kind:'subtitle',cues:[{from:0,to:1,content:'保存的增强字幕'}]});
  await tasks.subtitleStore.select(a.id,0,{kind:'enhanced',versionId:'enhanced'});await spaces.save(a.id,0,{...a.draft,text:'问题',modelId:'fixture'},a.chatId);
  let active:typeof binding|null=null,opened=0;
  const service=createTaskService(tasks,spaces,{command:async()=>({providerId:'deepseek',revision:1,hasKey:true,models:[{id:'fixture',name:'fixture',text:'declared',vision:'unknown',web:'unknown'}],defaultModelId:'fixture',status:'ready'})},async()=>({binding:active,status:'loading',cues:[],language:null}),{create:async()=>++opened,navigate:async()=>{},exists:async()=>false,close:async()=>{}},'fixture',()=>{});
  const send={type:'generation.send' as const,target:{kind:'chat' as const,workspaceId:a.id,chatId:a.chatId},expectedRevision:1,binding};
  await expect(service.command(send)).rejects.toMatchObject({code:'stale-binding'});
  active={...binding,partId:'2'};await expect(service.command(send)).rejects.toMatchObject({code:'stale-binding'});expect(opened).toBe(0);
  active=binding;expect(await service.command(send)).toMatchObject({target:send.target,jobs:[{state:'preparing'}]});expect(opened).toBe(1);
});
