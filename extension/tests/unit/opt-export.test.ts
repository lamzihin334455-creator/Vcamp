import 'fake-indexeddb/auto';
import {test,expect} from 'vitest';
import {IndexedDocumentStore,safeFilename} from '../../src/data/document-store';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedScribbleStore} from '../../src/data/scribble-store';

test('export is an exact selection snapshot, grouped scribbles sort by time and exclude other P/deleted entries',async()=>{
  const db=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(db),notes=new IndexedScribbleStore(db),docs=new IndexedDocumentStore(db);
  const a=await spaces.open({platform:'bilibili',videoId:'BVfixture',partId:'1',title:'../题目',pageNumber:1}),b=await spaces.open({...a.source,partId:'2',pageNumber:2});
  const last=await notes.create(a.id,'后',90),first=await notes.create(a.id,'前',1.25);await notes.create(b.id,'绝不混入',1);
  const result=await docs.export([{target:{workspaceId:a.id,entityType:'scribble',id:first.id},format:'txt'}]);
  expect(result.files).toHaveLength(1);expect(result.files[0].content).toContain('前');expect(result.files[0].content).not.toContain('后');expect(result.files[0].name).not.toMatch(/[\\/]/);
  const grouped=await docs.export([{target:{workspaceId:a.id,entityType:'scribble',id:'*'},format:'md'}]);
  expect(grouped.files[0].content.indexOf('00:01')).toBeLessThan(grouped.files[0].content.indexOf('01:30'));
  expect(grouped.files[0].content).not.toContain('绝不混入');
  await notes.save(a.id,last.id,1,'新版本');expect(grouped.files[0].content).not.toContain('新版本');
  const invalid=await docs.export([{target:{workspaceId:a.id,entityType:'html',id:'missing'},format:'srt'}]);expect(invalid.files).toHaveLength(0);expect(invalid.errors).toHaveLength(1);
});

test('scribble selections default to one chronological document per workspace and format',async()=>{
  const db=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(db),notes=new IndexedScribbleStore(db),docs=new IndexedDocumentStore(db);
  const a=await spaces.open({platform:'bilibili',videoId:'BVnotes',partId:'1',title:'随笔'});
  const first=await notes.create(a.id,'第一条',2),second=await notes.create(a.id,'第二条',1);
  const result=await docs.export([
    {target:{workspaceId:a.id,entityType:'scribble',id:first.id},format:'md'},
    {target:{workspaceId:a.id,entityType:'scribble',id:second.id},format:'md'}
  ]);
  expect(result.files).toHaveLength(1);
  expect(result.files[0].content.indexOf('第二条')).toBeLessThan(result.files[0].content.indexOf('第一条'));
});

test('native subtitles require bound memory, keep millisecond cues and independent provenance sidecars; failed selections preserve successes',async()=>{
  const db=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(db),docs=new IndexedDocumentStore(db),notes=new IndexedScribbleStore(db);
  const a=await spaces.open({platform:'bilibili',videoId:'BVnative',partId:'1',title:'题目',pageNumber:1});const saved=await notes.create(a.id,'保留此成功项',60);
  const nativeTarget={workspaceId:a.id,entityType:'subtitle' as const,id:'native'};
  const offline=await docs.export([{target:nativeTarget,format:'srt'},{target:{workspaceId:a.id,entityType:'scribble',id:saved.id},format:'txt'}]);expect(offline.errors[0].reason).toContain('回源读取');expect(offline.files).toHaveLength(1);
  const native={workspaceId:a.id,language:'zh-CN',category:'human' as const,cues:[{from:1.2345,to:2.9996,content:'第一行\n\n第二行'}]};
  const srt=await docs.export([{target:nativeTarget,format:'srt'}],native);expect(srt.errors).toEqual([]);expect(srt.files[0].content).toBe('1\n00:00:01,235 --> 00:00:03,000\n第一行\n第二行\n');expect(srt.files[1].name).toBe(srt.files[0].name.replace(/\.srt$/,'.source.txt'));expect(srt.files[1].content).toContain('站点人工');expect(srt.files[1].content).toContain('非插件AI生成');
  const vtt=await docs.export([{target:nativeTarget,format:'vtt'}],native);expect(vtt.files[0].content).toMatch(/^WEBVTT\n\nNOTE\n/);expect(vtt.files[0].content).toContain('00:00:01.235 --> 00:00:03.000');
  expect(safeFilename('CON.txt')).toBe('_CON.txt');expect(safeFilename('../a\\b?.md')).not.toMatch(/[\\/?]/);expect(safeFilename('超'.repeat(250)+'.source.txt')).toMatch(/\.source\.txt$/);
});
