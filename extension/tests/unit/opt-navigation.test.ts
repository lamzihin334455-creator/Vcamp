import 'fake-indexeddb/auto';
import {test,expect} from 'vitest';
import {htmlAction} from '../../src/html/navigation';
import {createMessageRouter} from '../../src/app/message-router';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedLibraryStore} from '../../src/data/library-store';
import {createLibraryService} from '../../src/library/service';
import {remarkVideoTimes} from '../../src/workbench/TimedMarkdown';
test('narrow HTML actions reject tokens, extra capabilities and invalid times/URLs',()=>{
  const seek={type:'vcamp.html.action',token:'current',kind:'seek',time:3600};expect(htmlAction(seek,'current')).toEqual({kind:'seek',time:3600});
  for(const value of [{...seek,token:'stale'},{...seek,workspaceId:'other'},{...seek,time:-1},{...seek,time:NaN},{...seek,time:Infinity},{...seek,time:360000},{type:'client.command',token:'current',command:{}},{...seek,kind:'external',time:undefined,url:'javascript:alert(1)'}])expect(htmlAction(value,'current')).toBeNull();
  expect(htmlAction({type:'vcamp.html.action',token:'current',kind:'external',url:'https://example.com/reference'},'current')).toEqual({kind:'external',url:'https://example.com/reference'});
});
test('source seek resolves saved workspace/P and readonly forces existing source-open, cross-P/extra-field requests refused',async()=>{
  const db=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(db),source={platform:'bilibili' as const,videoId:'BVsource',partId:'11',pageNumber:1,title:'来源'};
  const a=await spaces.open(source),b=await spaces.open({...source,partId:'12',pageNumber:2});const current:any[]=[],opened:any[]=[];
  const library=createLibraryService(new IndexedLibraryStore(db),async()=>{},async(s,t)=>{opened.push({s,t});},undefined,undefined,undefined,undefined,async(s,t)=>{current.push({s,t});});
  const router=createMessageRouter(spaces,'test',async()=>null,undefined,undefined,undefined,undefined,undefined,undefined,undefined,library);
  const target={workspaceId:a.id,entityType:'chat' as const,id:a.chatId},sender={id:'test',url:'chrome-extension://test/sidepanel.html',frameId:0};
  const request=(op:unknown)=>({version:1,requestId:crypto.randomUUID(),operation:op});
  expect(await router.handle(request({type:'library.locate',target,time:3600}),sender)).toMatchObject({ok:true});expect(current).toEqual([{s:source,t:3600}]);
  const reader={...sender,url:`chrome-extension://test/reader.html?library=1&workspaceId=${encodeURIComponent(a.id)}&chatId=${a.chatId}`};
  expect(await router.handle(request({type:'library.locate',target,time:1.25}),reader)).toMatchObject({ok:true});expect(opened).toEqual([{s:source,t:1.25}]);
  for(const op of [{type:'library.locate',target:{...target,workspaceId:b.id,id:b.chatId},time:1},{type:'library.locate',target,time:1,tabId:9},{type:'library.locate',target,time:360000},{type:'library.export',selection:[{target:{...target,workspaceId:b.id,id:b.chatId},format:'md'}]}])expect(await router.handle(request(op),reader)).toMatchObject({ok:false});
  const fixedEntity={...sender,url:`chrome-extension://test/reader.html?workspaceId=${encodeURIComponent(a.id)}&artifactId=${a.chatId}`};expect(await router.handle(request({type:'library.locate',target,time:1}),fixedEntity)).toMatchObject({ok:false});
  expect(current).toHaveLength(1);expect(opened).toHaveLength(1);
});
test('Markdown time adaptation visits text nodes, preserves code, URLs and source labels outside explicit times',()=>{
  const tree:any={type:'root',children:[{type:'paragraph',children:[{type:'text',value:'依据 [01:02:03]，比例 1:2。'},{type:'inlineCode',value:'[01:02]'},{type:'link',url:'https://example.com/[01:02]',children:[{type:'text',value:'[01:02]'}]}]},{type:'code',value:'[01:02]'}]};
  remarkVideoTimes()(tree);expect(tree.children[0].children[1]).toMatchObject({type:'link',url:'vcamp-time:3723'});
  expect(tree.children[0].children.at(-2)).toMatchObject({type:'inlineCode',value:'[01:02]'});expect(tree.children[0].children.at(-1).url).toBe('https://example.com/[01:02]');expect(tree.children[1]).toEqual({type:'code',value:'[01:02]'});
});
test('Markdown note headings recognize bare leading timestamps and time ranges without turning clocks into controls',()=>{
  const tree:any={type:'root',children:[
    {type:'paragraph',children:[{type:'strong',children:[{type:'text',value:'00:00–00:25 背景与系列介绍'}]}]},
    {type:'paragraph',children:[{type:'text',value:'00:45-01:34 第一步：完整摸底测试'}]},
    {type:'paragraph',children:[{type:'text',value:'会议时间 12:30，比率 4:3'}]}
  ]};
  remarkVideoTimes()(tree);
  expect(tree.children[0].children[0].children.filter((node:any)=>node.type==='link').map((node:any)=>node.url)).toEqual(['vcamp-time:0','vcamp-time:25']);
  expect(tree.children[1].children.filter((node:any)=>node.type==='link').map((node:any)=>node.url)).toEqual(['vcamp-time:45','vcamp-time:94']);
  expect(tree.children[2].children).toEqual([{type:'text',value:'会议时间 12:30，比率 4:3'}]);
});
