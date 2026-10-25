import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedScribbleStore} from '../../src/data/scribble-store';
import {IndexedDocumentStore} from '../../src/data/document-store';
import {databaseTransaction} from '../../src/data/database';
import {documentExportSchema} from '../../src/contracts/documents';
import {createProviderService} from '../../src/generation/provider-service';
import {IndexedAttachmentStore} from '../../src/data/attachment-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {png} from '../fixtures/png';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {IndexedLibraryStore} from '../../src/data/library-store';
import {createLibraryService} from '../../src/library/service';
import {createMessageRouter} from '../../src/app/message-router';

test('duplicate and partial scribble selections never widen to unselected notes',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),scribbles=new IndexedScribbleStore(name),docs=new IndexedDocumentStore(name);
  const space=await spaces.open({platform:'bilibili',videoId:'BVscope',partId:'1',title:'Selection scope'});
  const a=await scribbles.create(space.id,'Selected A',1),b=await scribbles.create(space.id,'Selected B',2);
  await scribbles.create(space.id,'UNSELECTED PRIVATE NOTE',3);
  const pick=(id:string)=>({target:{workspaceId:space.id,entityType:'scribble' as const,id},format:'md' as const});
  for(const selection of [[pick(a.id),pick(a.id)],[pick(a.id),pick(b.id)]]){
    const result=await docs.export(selection);
    expect(result.errors).toEqual([]);expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toContain('Selected A');
    expect(result.files[0].content).not.toContain('UNSELECTED PRIVATE NOTE');
  }
  expect((await docs.export([pick('*')])).files[0].content).toContain('UNSELECTED PRIVATE NOTE');
  const library=createLibraryService(new IndexedLibraryStore(name),async()=>{},async()=>{},undefined,undefined,undefined,undefined,undefined,docs);
  const router=createMessageRouter(spaces,'release',async()=>null,undefined,undefined,undefined,undefined,undefined,undefined,undefined,library);
  const sender={id:'release',frameId:0,url:`chrome-extension://release/reader.html?workspaceId=${encodeURIComponent(space.id)}&scribbleId=${a.id}`};
  const exported=await router.handle({version:1,requestId:crypto.randomUUID(),operation:{type:'library.export',selection:[pick(a.id),pick(a.id)]}},sender);
  expect(exported.ok).toBe(true);
  if(!exported.ok)throw Error('Fixed reader export failed');
  expect(exported.view.library?.documents?.files[0].content).toContain('Selected A');
  expect(exported.view.library?.documents?.files[0].content).not.toContain('UNSELECTED PRIVATE NOTE');
  expect(await router.handle({version:1,requestId:crypto.randomUUID(),operation:{type:'library.export',selection:[pick('*')]}},sender)).toMatchObject({ok:false,code:'forbidden'});
});

test('saved long Markdown and HTML export without the obsolete 2M cutoff',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),docs=new IndexedDocumentStore(name);
  const space=await spaces.open({platform:'bilibili',videoId:'BVlong',partId:'1',title:'Long output'});
  const content='x'.repeat(2100000)+'COMPLETE';
  await databaseTransaction(name,['artifacts','noteRevisions'],'readwrite',(tx,done)=>{
    for(const [id,type]of [['note','markdown'],['page','html-page']]){
      tx.objectStore('artifacts').put({id,workspaceId:space.id,sourceChatId:space.chatId,type,title:id,revision:1,revisionId:id+'-rev',jobId:'job',attemptId:'attempt'});
      tx.objectStore('noteRevisions').put({id:id+'-rev',artifactId:id,content});
    }
    done(undefined);
  });
  const result=await docs.export([
    {target:{workspaceId:space.id,entityType:'markdown',id:'note'},format:'md'},
    {target:{workspaceId:space.id,entityType:'html',id:'page'},format:'html'},
  ]);
  expect(result.errors).toEqual([]);expect(result.files).toHaveLength(2);
  expect(result.files.every(file=>file.content.endsWith('COMPLETE'))).toBe(true);
  expect(documentExportSchema.safeParse(result).success).toBe(true);
});

test('provider import rejects known non-text models atomically',async()=>{
  let saved:unknown;
  const service=createProviderService({async read(){return saved;},async write(value){saved=structuredClone(value);}},async()=>Response.json({data:[
    {id:'audio-only',input_modalities:['audio'],output_modalities:['audio']},
    {id:'text-model',input_modalities:['text'],output_modalities:['text']},
  ]}));
  let view=await service.command({type:'provider.save-key',providerId:'deepseek',key:'SYNTHETIC_RELEASE_TEST',expectedRevision:0});
  view=await service.command({type:'provider.fetch',expectedRevision:view.revision});
  const before=structuredClone(saved);
  await expect(service.command({type:'provider.import-models',modelIds:['audio-only','text-model'],expectedRevision:view.revision})).rejects.toMatchObject({code:'model-unavailable'});
  expect(saved).toEqual(before);
  const accepted=await service.command({type:'provider.import-models',modelIds:['text-model'],expectedRevision:view.revision});
  expect(accepted.defaultModelId).toBe('text-model');
  // Old installations may already contain an unsupported imported entry.
  const legacy=structuredClone(saved) as {models:typeof accepted.models;catalog:typeof accepted.models};
  legacy.models.push(legacy.catalog.find(model=>model.id==='audio-only')!);
  const restored=createProviderService({async read(){return legacy;},async write(){throw Error('Must not persist an unsupported default');}});
  const current=await restored.command({type:'provider.query'});
  await expect(restored.command({type:'provider.default',modelId:'audio-only',expectedRevision:current.revision})).rejects.toMatchObject({code:'model-unavailable'});
});

test('text-only generation rejects image-bearing history instead of silently stripping it',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),images=new IndexedAttachmentStore(name),jobs=new IndexedGenerationStore(name);
  const space=await spaces.open({platform:'bilibili',videoId:'BVhistory',partId:'1',title:'Image history'});
  const target={kind:'chat' as const,workspaceId:space.id,chatId:space.chatId};
  const binding={platform:'bilibili' as const,videoId:'BVhistory',partId:'1',tabId:1,documentId:'doc',epoch:1};
  await images.add(target,binding,0,{dataUrl:png(),width:2,height:2,time:1});
  const withImage=(await spaces.read(space.id,space.chatId))!;
  await spaces.save(space.id,withImage.draft.revision,{...withImage.draft,text:'Describe',modelId:'fixture'},space.chatId);
  const basis={binding,locator:'fixture',fingerprint:'fixture',language:'zh',cueCount:1};
  const first=await jobs.freezeChat(target,withImage.draft.revision+1,basis,true);
  await jobs.attach(first.jobId,first.attempts[0].attemptId,1);
  const claimed=(await jobs.claim(first.jobId,first.attempts[0].attemptId,1))!;
  await jobs.checkpoint(first.jobId,first.attempts[0].attemptId,claimed.seq+1,'Image described',{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});
  await jobs.finish(first.jobId,first.attempts[0].attemptId,'completed',null,crypto.randomUUID());
  const latest=(await spaces.read(space.id,space.chatId))!;
  await spaces.save(space.id,latest.draft.revision,{...latest.draft,text:'Explain that image',modelId:'text-only'},space.chatId);
  await expect(jobs.freezeChat(target,latest.draft.revision+1,basis,false)).rejects.toMatchObject({code:'unsupported-capability'});
});

test('backup exports reject an over-limit graph before advertising a restorable file',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),notes=new IndexedScribbleStore(name),backup=new IndexedBackupStore(name);
  const space=await spaces.open({platform:'bilibili',videoId:'BVbackup',partId:'1',title:'Backup boundary'});
  const sample=await notes.create(space.id,'Synthetic note',0);
  await databaseTransaction(name,['scribbles'],'readwrite',(tx,done)=>{
    // One workspace + one Chat + 19,999 notes exceeds the 20,000-record restore cap.
    for(let i=1;i<19999;i++)tx.objectStore('scribbles').put({...sample,id:crypto.randomUUID(),creationOrder:i});
    done(undefined);
  });
  await expect(backup.beginExport()).rejects.toMatchObject({code:'resource-limit'});
  await expect(backup.export()).rejects.toMatchObject({code:'resource-limit'});
});
