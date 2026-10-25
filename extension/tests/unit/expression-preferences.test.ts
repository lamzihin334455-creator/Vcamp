import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import {runChat} from '../../src/generation/run-chat';
import {IndexedTemplateStore} from '../../src/data/template-store';
import {fixedPromptRules,selectFixedRules} from '../../src/prompts/fixed-rules';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import type {ProviderMessage} from '../../src/generation/provider-port';

test.each(['chat','markdown','html'] as const)('actual %s request retains role expression preferences and ends with the explicit current task',async outputType=>{
 const input='这次只用两句话，不要时间点。',instructions='详细解释；每章结尾给一处时间区间。';
 const snapshot:ChatRequestSnapshot={snapshotId:'expression',templateRevisionId:'t1',target:{kind:'chat',workspaceId:'w',chatId:'c'},input,outputType,modelId:'fixture',webEnabled:false,mediaDuration:180,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[],...(outputType==='html'?{htmlFormat:1}:{}),roleSnapshot:{roleId:'r',revisionId:'r1',revision:1,name:'我的表达',description:'',instructions},templateSnapshot:{templateId:'t',revisionId:'t1',revision:1,name:'整理',description:'',requirements:'按章节整理视频。',outputType,defaultModelId:null}};
 let sent:readonly ProviderMessage[]=[];
 await runChat(snapshot,[{from:60.25,to:80,content:'视频说明一种方法。'}],{async stream(_id,messages){sent=messages;}},new AbortController().signal,async()=>{});
 const current=String(sent.at(-1)!.content),system=String(sent[0].content);
 expect(current).toContain(instructions);expect(current).toContain(snapshot.templateSnapshot!.requirements);
 expect(current.trim().endsWith(input)).toBe(true);
 expect(system).toContain('是否显示时间');expect(system).toContain('频率');expect(system).toContain('详略');
 expect(system).toContain('[P1:time-links]');expect(system).toContain('区间');
 expect(system).toContain('P0、P1 不可被覆盖');
});

test('new template defaults are flexible, old selections and user edits remain resolvable',async()=>{
 const store=new IndexedTemplateStore(crypto.randomUUID());
 const summary=(await store.list()).find(t=>t.id==='builtin-summary')!;
 const note=(await store.list()).find(t=>t.id==='builtin-note')!;
 expect(summary.requirements).not.toContain('五个要点');expect(note.requirements).not.toContain('保留视频中的关键时间点');
 expect(summary.revision).toBeGreaterThan(1);expect(note.revision).toBeGreaterThan(1);
 expect((await store.revision(summary.id,'builtin-summary:v1')).requirements).toContain('五个要点');
 expect((await store.revision(note.id,'builtin-note:v1')).requirements).toContain('关键时间点');
 const custom=await store.save(note.id,note.revision,{name:note.name,description:note.description,outputType:note.outputType,defaultModelId:null,requirements:'我的自定义格式'});
 expect((await store.list()).find(t=>t.id===note.id)?.requirements).toBe('我的自定义格式');
 expect((await store.revision(note.id,custom.revisionId)).requirements).toBe('我的自定义格式');
});

test('concise time contract is capability scoped and never loads into internal planning',()=>{
 expect(fixedPromptRules['time-links'].text.length).toBeLessThan(300);
 expect(selectFixedRules({kind:'requirements-plan'}).some(rule=>rule.id==='time-links')).toBe(false);
});

test('auxiliary planning does not inject output demands into final generation',async()=>{
 let sent:readonly ProviderMessage[]=[];
 await runChat({snapshotId:'planning',templateRevisionId:null,target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'简短回答',outputType:'chat',modelId:'fixture',webEnabled:false,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[],evidence:{version:1,planningMode:'planned',plan:{version:1,interpretedIntent:'理解视频',additionalSources:[],outputRequirements:['PLAN_ONLY:每句话附时间点']},includedSources:['full_subtitles'],unavailableSources:[]}},[{from:0,to:1,content:'方法介绍'}],{async stream(_id,messages){sent=messages;}},new AbortController().signal,async()=>{});
 expect(JSON.stringify(sent)).not.toContain('PLAN_ONLY');
 expect(JSON.stringify(sent)).toContain('理解视频');
 expect(sent.at(-1)!.content).toBe('简短回答');
});
