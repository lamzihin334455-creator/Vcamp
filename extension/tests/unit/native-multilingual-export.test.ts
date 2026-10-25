import 'fake-indexeddb/auto';
import {test,expect} from 'vitest';
import {IndexedDocumentStore} from '../../src/data/document-store';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedLibraryStore} from '../../src/data/library-store';
import {createLibraryService} from '../../src/library/service';

test('catalog and export preserve every available native language, with exact P ownership',async()=>{
  const db=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(db),docs=new IndexedDocumentStore(db);
  const space=await spaces.open({platform:'bilibili',videoId:'BVlanguages',partId:'1',title:'多语言',pageNumber:1});
  const tracks=['zh-CN','ai-en','ai-ja'].map(language=>({language,label:language,status:'ready' as const,cues:[{from:1.234,to:3.456,content:`native ${language}`}]}));
  const snapshot={workspaceId:space.id,language:tracks[0].language,cues:tracks[0].cues,tracks};
  const service=createLibraryService(new IndexedLibraryStore(db),async()=>{},async()=>{},undefined,undefined,undefined,undefined,undefined,docs,async()=>snapshot);
  const catalog=await service.command({type:'library.read',workspaceId:space.id});
  const rows=catalog.entities.filter(e=>e.entityType==='subtitle');
  expect(rows.map(e=>e.language)).toEqual(tracks.map(t=>t.language));
  const result=await service.command({type:'library.export',selection:rows.map(e=>({target:{workspaceId:e.workspaceId,entityType:e.entityType,id:e.id},format:'srt'}))});
  expect(result.documents?.errors).toEqual([]);
  const srts=result.documents!.files.filter(f=>f.name.endsWith('.srt'));
  expect(srts).toHaveLength(3);
  for(const t of tracks)expect(srts.filter(f=>f.content.includes(`native ${t.language}`))).toHaveLength(1);
  const other=await spaces.open({...space.source,partId:'2',pageNumber:2});
  const wrong=await docs.export([{target:{workspaceId:other.id,entityType:'subtitle',id:rows[1].id},format:'srt'}],snapshot);
  expect(wrong.files).toEqual([]);expect(wrong.errors).toHaveLength(1);
  const legacy={workspaceId:space.id,language:'zh-CN',cues:tracks[0].cues};
  const legacyExport=await docs.export([{target:{workspaceId:space.id,entityType:'subtitle',id:'native:zh-CN'},format:'txt'}],legacy);
  expect(legacyExport.errors).toEqual([]);expect(legacyExport.files[0].content).toContain('native zh-CN');
});

test('unread or disappeared language cannot silently export the default track',async()=>{
  const db=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(db),docs=new IndexedDocumentStore(db);
  const space=await spaces.open({platform:'bilibili',videoId:'BVpartial',partId:'11',title:'部分语言'});
  const cues=[{from:0,to:1,content:'English only'}];
  const snapshot={workspaceId:space.id,language:'',cues:[],tracks:[{language:'zh-CN',label:'中文',status:'permission-denied' as const,cues:[]},{language:'en',label:'English',status:'ready' as const,cues}]};
  const service=createLibraryService(new IndexedLibraryStore(db),async()=>{},async()=>{},undefined,undefined,undefined,undefined,undefined,docs,async()=>snapshot);
  const catalog=await service.command({type:'library.read',workspaceId:space.id});
  expect(catalog.entities.filter(e=>e.entityType==='subtitle').map(e=>e.language)).toEqual(['en']);
  const target={workspaceId:space.id,entityType:'subtitle' as const};
  const result=await service.command({type:'library.export',selection:[{target:{...target,id:'native:en'},format:'vtt'},{target:{...target,id:'native:zh-CN'},format:'srt'},{target:{...target,id:'native:ja'},format:'txt'}]});
  expect(result.documents?.files).toHaveLength(1);expect(result.documents?.errors).toHaveLength(2);
  expect(result.documents?.files[0].content).toContain('English only');
});
