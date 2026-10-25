import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { createMessageRouter } from '../../src/app/message-router';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
const sender = { id: 'test', url: 'chrome-extension://test/sidepanel.html', frameId: 0 };
const request = (operation: unknown) => ({ version: 1, requestId: crypto.randomUUID(), operation });

test('unknown navigation identity hides old Chat while retaining its draft and recent selection for return',async()=>{
  const source={platform:'bilibili' as const,videoId:'BVswitch',partId:'1',title:'P1'},store=new IndexedWorkspaceStore(crypto.randomUUID());
  const a=await store.open(source),second=await store.createChat(a.id);await store.save(a.id,0,{...second.draft,text:'原 P 草稿'},second.chatId);
  let loading=false;
  const router=createMessageRouter(store,'test',async()=>null,{current:async()=>({binding:loading?null:{platform:'bilibili' as const,videoId:source.videoId,partId:source.partId,tabId:1,documentId:'d',epoch:1},status:loading?'loading' as const:'ready' as const,cues:loading?[]:[{from:0,to:1,content:'当前字幕'}],language:'zh',source:loading?null:source,localSource:source}),retry:async()=>{},seek:async()=>{}});
  expect(await router.handle(request({type:'workspace.query'}),sender)).toMatchObject({ok:true,view:{chatId:second.chatId,draft:{text:'原 P 草稿'}}});
  loading=true;expect(await router.handle(request({type:'workspace.query'}),sender)).toMatchObject({ok:true,view:{workspaceId:null,chatId:null,draft:null,video:{binding:null,cues:[]}}});
  loading=false;expect(await router.handle(request({type:'workspace.query'}),sender)).toMatchObject({ok:true,view:{chatId:second.chatId,draft:{text:'原 P 草稿'}}});
});

test('A: queued old draft saves to its confirmed space after active video changes', async () => {
  let partId = '1';
  const router = createMessageRouter(new IndexedWorkspaceStore(crypto.randomUUID()), 'test', async () => ({ platform: 'bilibili', videoId: 'BV1', partId, title: '标题' }));
  const a = await router.handle(request({ type: 'workspace.query' }), sender);
  if (!a.ok) throw new Error();
  partId = '2';
  await router.handle(request({ type: 'workspace.query' }), sender);
  const save = await router.handle(request({ type: 'draft.save', target: { workspaceId: a.view.workspaceId, chatId: a.view.chatId }, expectedRevision: 0, draft: { ...a.view.draft, text: '旧空间输入' } }), sender);
  expect(save).toMatchObject({ ok: true, view: { workspaceId: a.view.workspaceId, draft: { text: '旧空间输入' } } });
  const b = await router.handle(request({ type: 'workspace.query' }), sender);
  expect(b).toMatchObject({ ok: true, view: { draft: { text: '' } } });
  partId = '1';
  expect(await router.handle(request({ type: 'workspace.query' }), sender)).toMatchObject({ ok: true, view: { draft: { text: '旧空间输入' } } });
});

test('A: wrong Chat targets and readonly video operations are forbidden', async () => {
  const router = createMessageRouter(new IndexedWorkspaceStore(crypto.randomUUID()), 'test', async () => ({ platform: 'bilibili', videoId: 'BV1', partId: '1', title: '标题' }));
  const opened = await router.handle(request({ type: 'workspace.query' }), sender);
  if (!opened.ok) throw new Error();
  expect(await router.handle(request({ type: 'draft.save', target: { workspaceId: opened.view.workspaceId, chatId: 'another' }, expectedRevision: 0, draft: opened.view.draft }), sender)).toMatchObject({ ok: false, code: 'forbidden' });
  const reader = { ...sender, url: `chrome-extension://test/reader.html?workspaceId=${encodeURIComponent(opened.view.workspaceId!)}` };
  for (const type of ['video.retry', 'video.seek']) {
    expect(await router.handle(request({ type, binding: { platform: 'bilibili', videoId: 'BV1', partId: '1', tabId: 1, documentId: 'doc', epoch: 1 }, ...(type === 'video.seek' ? { time: 1, policy: 'preserve' } : {}) }), reader)).toMatchObject({ ok: false, code: 'forbidden' });
  }
});
