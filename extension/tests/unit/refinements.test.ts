import {IndexedSubtitleStore} from '../../src/data/subtitle-store';
import {subtitleBasis} from '../../src/generation/subtitle-context';
import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedRoleStore} from '../../src/data/role-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {mentionAt,consumeMention} from '../../src/app/mention';
import {subtitleBatches} from '../../src/generation/run-subtitle';
import {IndexedStyleStore} from '../../src/data/style-store';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {decode} from '../../src/data/backup-format';
import type {PortablePreferences,PortablePreferencesPort} from '../../src/contracts/portable-preferences';
import {runChat} from '../../src/generation/run-chat';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';

test.each(['chat','markdown','html'] as const)('roles apply to %s according to the global opt-in',async outputType=>{
 for(const allOutputs of [false,true]){
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),tasks=new IndexedGenerationStore(name);
  const role=await new IndexedRoleStore(name).create({name:'表达',description:'',instructions:'ROLE_PRIVATE_SENTINEL'});
  const source={platform:'bilibili' as const,videoId:'BVscope',partId:'1',title:'scope'},space=await spaces.open(source);
  await spaces.save(space.id,0,{...space.draft,text:'问题',modelId:'fixture',outputType,role:{roleId:role.id,revisionId:role.revisionId}});
  const job=await tasks.freezeChat({kind:'chat',workspaceId:space.id,chatId:space.chatId},1,{locator:'fixture',fingerprint:'fixture',language:'zh',cueCount:1,binding:{...source,tabId:1,documentId:'doc',epoch:1}},false,false,undefined,allOutputs);
  expect('roleSnapshot' in job.snapshot).toBe(outputType==='chat'||allOutputs);
 }
});

test('tool shortcut consumes only the caret-local exclamation without damaging normal punctuation',()=>{
 const trigger=mentionAt('请看 !截图',6);
 expect(trigger).toMatchObject({start:3,end:6,query:'截图',kind:'tools'});
 expect(consumeMention('请看 !截图 后面',trigger)).toBe('请看  后面');
 expect(mentionAt('正常句子！',5)).toBeNull();
 expect(mentionAt('!自主',3,true)).toBeNull();
});

test('long subtitle processing covers more than the former sixteen batches in order',()=>{
 const cues=Array.from({length:21001},(_,i)=>({from:i*2,to:i*2+1,content:`正文${i}`}));
 const batches=subtitleBatches(cues);
 expect(batches.length).toBeGreaterThan(16);
 expect(batches.flatMap(batch=>batch.cues.map(cue=>cue.index))).toEqual(cues.map((_,i)=>i));
});

test('style versions freeze as P2 requirements and survive deletion and isolated backup restoration',async()=>{
 const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),styles=new IndexedStyleStore(name),tasks=new IndexedGenerationStore(name);
 const style=await styles.create({name:'自定义纸张',description:'STYLE_SENTINEL 米色纸张与黑色标题'}),source={platform:'bilibili' as const,videoId:'BVstyle',partId:'1',title:'Style'},space=await spaces.open(source);
 await spaces.save(space.id,0,{...space.draft,text:'请求',outputType:'html',modelId:'fixture',htmlStyle:{styleId:style.id,revisionId:style.revisionId}});
 const job=await tasks.freezeChat({kind:'chat',workspaceId:space.id,chatId:space.chatId},1,{locator:'fixture',fingerprint:'fixture',language:'zh',cueCount:1,binding:{...source,tabId:1,documentId:'doc',epoch:1}});
 expect(job.snapshot).toMatchObject({htmlStyle:{description:style.description}});
 await styles.save(style.id,1,{name:style.name,description:'NEW_STYLE'});await styles.delete(style.id,2);
 let sent='';await runChat(job.snapshot as ChatRequestSnapshot,[{from:0,to:1,content:'资料'}],{async stream(_model,messages){sent=JSON.stringify(messages);}},new AbortController().signal,async()=>{});
 expect(sent).toContain('P2 本次风格要求');expect(sent).toContain('STYLE_SENTINEL');expect(sent).not.toContain('NEW_STYLE');
 await tasks.finish(job.jobId,job.attempts[0].attemptId,'stopped');
 const backup=await new IndexedBackupStore(name).export(),target=new IndexedBackupStore(crypto.randomUUID()),plan=await target.preview(backup);await target.execute(plan.planId,plan.checksum);
 const restored=(await decode(await target.export())).payload;
 expect(restored.styles[0].deleted).toBe(true);expect(restored.styleRevisions).toHaveLength(2);expect(restored.jobs[0].snapshot).toMatchObject({htmlStyle:{description:style.description}});
});

test('portable preferences restore without keys, retain folder state, and map an active builtin role',async()=>{
 const name=crypto.randomUUID(),roles=new IndexedRoleStore(name),role=(await roles.list())[0];
 let current:PortablePreferences={activeRole:{roleId:role.id,revisionId:role.revisionId},roleAllOutputs:true,webDefault:true,accent:'#218fc2',subtitleFontSize:20,libraryLayout:'grid',libraryState:{scope:{kind:'folders'},selectedParts:{BVexample:'2'}}};
 const sourcePort:PortablePreferencesPort={async read(){return structuredClone(current);},async write(value){current=structuredClone(value);}};
 const file=await new IndexedBackupStore(name,sourcePort).export();expect(JSON.parse(file).manifest).toMatchObject({formatVersion:6,databaseVersion:10});expect(file).not.toContain('apiKey');
 let restored:PortablePreferences={};const targetPort:PortablePreferencesPort={async read(){return structuredClone(restored);},async write(value){restored=structuredClone(value);}};
 const targetName=crypto.randomUUID(),target=new IndexedBackupStore(targetName,targetPort),plan=await target.preview(file);
 expect(plan.counts.preferences).toBe(7);expect(restored).toEqual({});await target.execute(plan.planId,plan.checksum);
 expect(restored).toMatchObject({roleAllOutputs:true,accent:'#218fc2',libraryLayout:'grid',libraryState:current.libraryState});
 expect(await new IndexedRoleStore(targetName).revision(restored.activeRole!.roleId,restored.activeRole!.revisionId)).toMatchObject({instructions:role.instructions});
 const repeated=await target.preview(file);expect(repeated.added).toBe(0);
});

test('long corrected subtitles commit, restore completely, and wait for an explicit main-track selection',async()=>{
 const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),tasks=new IndexedGenerationStore(name);
 const source={platform:'bilibili' as const,videoId:'BVlongsave',partId:'1',title:'Long'},space=await spaces.open(source);
 const cues=Array.from({length:21001},(_,i)=>({from:i*2,to:i*2+1,content:`已经修正的长字幕第${i}条。`}));
 const job=await tasks.freezeSubtitle({snapshotId:crypto.randomUUID(),target:{kind:'subtitle',workspaceId:space.id,operation:'enhance'},source:{locator:'fixture',fingerprint:'fixture'},targetLanguage:null,requirements:'',modelId:'fixture',subtitleWorkflow:2,webEnabled:false},{locator:'fixture',fingerprint:'fixture',language:'zh',cueCount:cues.length,binding:{...source,tabId:1,documentId:'doc',epoch:1}});
 const attempt=job.attempts[0].attemptId;await tasks.attach(job.jobId,attempt,1);const claimed=(await tasks.claim(job.jobId,attempt,1))!;
 const batches=subtitleBatches(cues);await tasks.checkpoint(job.jobId,attempt,claimed.seq+1,'',{total:batches.length,covered:batches.length,ranges:batches.map(({firstCue,lastCue})=>({firstCue,lastCue}))});
 await tasks.finish(job.jobId,attempt,'completed',null,'long-version',{kind:'subtitle',cues});
 expect((await tasks.subtitleVersions(space.id))[0].cues).toEqual(cues);expect((await new IndexedSubtitleStore(name).query(space.id)).analysisSource).toEqual({kind:'native'});
 const target=new IndexedBackupStore(crypto.randomUUID()),plan=await target.preview(await new IndexedBackupStore(name).export());await target.execute(plan.planId,plan.checksum);
 expect((await decode(await target.export())).payload.subtitleVersions[0].cues).toEqual(cues);
});

test('subtitle processing builds full source identity beyond the Q&A serialization budget',async()=>{
 const cues=Array.from({length:100000},(_,i)=>({from:i*2,to:i*2+1,content:'长字幕内容0123456789'})),binding={platform:'bilibili' as const,videoId:'BVhuge',partId:'1',tabId:1,documentId:'doc',epoch:1};
 await expect(subtitleBasis(binding,'zh',cues,{purpose:'subtitle'})).resolves.toMatchObject({cueCount:100000,timingFingerprint:expect.any(String)});
 expect(subtitleBatches(cues).flatMap(batch=>batch.cues)).toHaveLength(100000);
});
