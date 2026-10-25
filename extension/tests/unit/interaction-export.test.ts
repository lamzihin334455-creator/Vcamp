import 'fake-indexeddb/auto';
import {test,expect} from 'vitest';
import {IndexedDocumentStore} from '../../src/data/document-store';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {readCompleteSubtitles} from '../../src/video/subtitles';

test('one selected track exports multiple formats, normalized JSON and only genuine original JSON',async()=>{
  const db=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(db),docs=new IndexedDocumentStore(db);
  const space=await spaces.open({platform:'bilibili',videoId:'BVformats',partId:'1',title:'单视频',videoTitle:'单视频',pageNumber:1,partCount:1});
  const raw={font_size:.4,body:[{from:1.234,to:3.456,content:'独立原始数据',location:2}]};
  const loaded=await readCompleteSubtitles({metadata:async()=>({http:200,json:{code:0,data:{subtitle:{subtitles:[{lan:'zh',lan_doc:'中文',subtitle_url:'https://aisubtitle.hdslb.com/local'}]}}}}),track:async()=>({http:200,json:raw})},new AbortController().signal);
  const native={...loaded,workspaceId:space.id,language:'zh',cues:loaded.cues};
  const target={workspaceId:space.id,entityType:'subtitle' as const,id:'native:zh'};
  const result=await docs.export(['srt','vtt','json','bili-json'].map(format=>({target,format})) as any,native);
  expect(result.errors).toEqual([]);expect(result.files).toHaveLength(5);
  expect(result.files.find(f=>f.name.endsWith('.srt'))?.content).toContain('00:00:01,234 --> 00:00:03,456');
  expect(result.files.find(f=>f.name.endsWith('.vtt'))?.content).toMatch(/^WEBVTT/);
  const normalized=JSON.parse(result.files.find(f=>f.name.endsWith('.json')&&!f.name.endsWith('.bilibili.json'))!.content);
  expect(normalized).toMatchObject({format:'vcamp-subtitles',version:1,language:'zh',source:{videoId:'BVformats',partId:'1',pageNumber:1},cues:[{from:1.234,to:3.456,content:'独立原始数据'}]});
  expect(JSON.parse(result.files.find(f=>f.name.endsWith('.bilibili.json'))!.content)).toEqual(raw);
  expect(result.files.every(f=>!f.name.includes('_P1'))).toBe(true);
  const old=await docs.export([{target,format:'bili-json' as any},{target,format:'vtt'}],{workspaceId:space.id,language:'zh',cues:loaded.cues});
  expect(old.errors).toHaveLength(1);expect(old.errors[0].reason).toContain('原始');expect(old.files).toHaveLength(1);
});
