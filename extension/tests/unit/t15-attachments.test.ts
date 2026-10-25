import { digest } from '../../src/data/backup-format';
import { emptyDraft } from '../../src/contracts/application';
import { runChat } from '../../src/generation/run-chat';
import { createProviderPort } from '../../src/generation/provider-port';
import { IndexedBackupStore } from '../../src/data/backup-store';
import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
import { captureCurrent } from '../../src/video/capture';
import { validateImage, imageBudget } from '../../src/data/image-validation';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedAttachmentStore } from '../../src/data/attachment-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';

import { png } from '../fixtures/png';

test('T15: captured image belongs to original Chat, freezes into message and survives draft removal / retry', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), images = new IndexedAttachmentStore(name), jobs = new IndexedGenerationStore(name);
  const a = await spaces.open({ platform:'bilibili',videoId:'BVfixture',partId:'20',title:'fixture' });
  const target = { kind:'chat' as const, workspaceId:a.id, chatId:a.chatId };
  const binding = { platform:'bilibili' as const,videoId:'BVfixture',partId:'20',tabId:1,documentId:'doc',epoch:1 };
  await images.add(target, binding, 0, { dataUrl:png(), width:2,height:2,time:12 });
  const saved = (await spaces.read(a.id,a.chatId))!;
  const id = saved.draft.attachmentIds[0]; expect(id).toBeTruthy();
  const b = await spaces.createChat(a.id);
  await expect(images.read({ workspaceId:a.id,chatId:b.chatId },[id])).rejects.toMatchObject({code:'forbidden'});
  await spaces.save(a.id,1,{ ...saved.draft,text:'Explain',modelId:'fixture' },a.chatId);
  const job = await jobs.freezeChat(target,2,{binding,locator:'fixture',fingerprint:'fixture',language:'zh',cueCount:1},true);
  expect(job.snapshot).toMatchObject({attachmentIds:[id]});
  expect((await spaces.read(a.id,a.chatId))!.draft.attachmentIds).toEqual([]);
  await jobs.finish(job.jobId,job.attempts[0].attemptId,'failed','network');
  const retry = await jobs.retry(job.jobId);
  expect(retry.snapshot).toEqual(job.snapshot);
  expect((await images.read(target,[id],true))[0].dataUrl).toBe(png());
  await expect(images.add(target,binding,0,{dataUrl:png(),width:2,height:2,time:13})).rejects.toMatchObject({code:'revision-conflict'});
});

test('T15: a dropped local image keeps its filename and is disclosed to the final model', async () => {
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),images=new IndexedAttachmentStore(name),jobs=new IndexedGenerationStore(name);
  const opened=await spaces.open({platform:'bilibili',videoId:'BVfixture',partId:'20',title:'fixture'}),target={kind:'chat' as const,workspaceId:opened.id,chatId:opened.chatId};
  const binding={platform:'bilibili' as const,videoId:'BVfixture',partId:'20',tabId:1,documentId:'doc',epoch:1};
  const image=await images.upload(target,binding,0,'diagram.png',{dataUrl:png(),width:2,height:2,time:0});
  const withImage=(await spaces.read(opened.id,opened.chatId))!;
  expect(image.uploadName).toBe('diagram.png');
  expect(withImage.draft.attachments).toEqual([{attachmentId:image.id,workspaceId:opened.id,chatId:opened.chatId,name:'diagram.png',mimeType:'image/png'}]);
  await spaces.save(opened.id,1,{...withImage.draft,text:'解释这张图',modelId:'fixture'},opened.chatId);
  const job=await jobs.freezeChat(target,2,{binding,locator:'fixture',fingerprint:'fixture',language:'zh',cueCount:1},true);
  if(!('input' in job.snapshot))throw new Error('expected chat snapshot');
  let sent:any[]=[];
  await runChat(job.snapshot,[{from:0,to:1,content:'字幕'}],{async stream(_id,messages){sent=[...messages];}},new AbortController().signal,async()=>{},await images.forSnapshot(job.snapshot));
  const manifest=JSON.stringify(sent[1]),final=JSON.stringify(sent.at(-1));
  expect(final).toContain('用户上传图片：diagram.png');
  expect(manifest).toContain('\\"uploadedImages\\":1');
});

test('T15: removing a draft image deletes its stored row and the next capture starts from the visible draft budget',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),images=new IndexedAttachmentStore(name);
  const opened=await spaces.open({platform:'bilibili',videoId:'BVfixture',partId:'20',title:'fixture'}),target={workspaceId:opened.id,chatId:opened.chatId};
  const binding={platform:'bilibili' as const,videoId:'BVfixture',partId:'20',tabId:1,documentId:'doc',epoch:1};
  const first=await images.upload(target,binding,0,'removed.png',{dataUrl:png(),width:2,height:2,time:0});
  await images.remove(target,1,first.id);
  const empty=(await spaces.read(opened.id,opened.chatId))!;
  expect(empty.draft.attachmentIds).toEqual([]);
  await expect(images.read(target,[first.id])).rejects.toMatchObject({code:'forbidden'});
  expect(JSON.parse(await new IndexedBackupStore(name).export()).payload.attachments.some((attachment:any)=>attachment.id===first.id)).toBe(false);
  const replacement=await images.add(target,binding,empty.draft.revision,{dataUrl:png(),width:2,height:2,time:1});
  expect((await spaces.read(opened.id,opened.chatId))!.draft.attachmentIds).toEqual([replacement.id]);
});

test('T15: backup keeps bytes and remaps draft/message/request attachments with conflict Chat',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),images=new IndexedAttachmentStore(name),jobs=new IndexedGenerationStore(name),backup=new IndexedBackupStore(name);
  const a=await spaces.open({platform:'bilibili',videoId:'BVfixture',partId:'20',title:'fixture'}),target={kind:'chat' as const,workspaceId:a.id,chatId:a.chatId};
  const binding={platform:'bilibili' as const,videoId:'BVfixture',partId:'20',tabId:1,documentId:'doc',epoch:1};
  await images.add(target,binding,0,{dataUrl:png(),width:2,height:2,time:1});
  const d=(await spaces.read(a.id,a.chatId))!.draft;await spaces.save(a.id,d.revision,{...d,modelId:'fixture',text:'image'},a.chatId);
  const job=await jobs.freezeChat(target,2,{binding,locator:'fixture',fingerprint:'fixture',language:'zh',cueCount:1},true);await jobs.finish(job.jobId,job.attempts[0].attemptId,'failed','network');
  await images.add(target,binding,3,{dataUrl:png(),width:2,height:2,time:2});
  const file=await backup.export(),destination=crypto.randomUUID(),importer=new IndexedBackupStore(destination),ds=new IndexedWorkspaceStore(destination);
  const plan=await importer.preview(file);await importer.execute(plan.planId,plan.checksum);
  const draft=(await ds.read(a.id,a.chatId))!.draft;await ds.save(a.id,draft.revision,{...draft,text:'local'},a.chatId);
  const conflict=await importer.preview(file);await importer.execute(conflict.planId,conflict.checksum);
  const chatId=conflict.mapping.find(m=>m.from===a.chatId)!.to;expect(chatId).not.toBe(a.chatId);
  const copy=(await ds.read(a.id,chatId))!,imageStore=new IndexedAttachmentStore(destination);
  expect((await imageStore.read({workspaceId:a.id,chatId},copy.draft.attachmentIds))[0]).toMatchObject({dataUrl:png(),time:2,chatId});
  const snapshot=(await new IndexedGenerationStore(destination).get(conflict.mapping.find(m=>m.from===job.jobId)!.to))!.snapshot;
  expect('attachmentIds' in snapshot && (await imageStore.forSnapshot(snapshot))[0]).toMatchObject({dataUrl:png(),time:1,chatId});
  const broken=JSON.parse(file);broken.payload.attachments=[];broken.manifest.checksum=await digest(broken.manifest.formatVersion>=6?{payload:broken.payload,...(broken.preferences?{preferences:broken.preferences}:{})}:broken.payload);
  await expect(new IndexedBackupStore(crypto.randomUUID()).preview(JSON.stringify(broken))).rejects.toMatchObject({code:'invalid-message'});
});

test('T15: v7 migration retains draft; legacy format1 imports without attachments',async()=>{
  const name=crypto.randomUUID(),id=JSON.stringify(['bilibili','BVold','1']);
  await new Promise<void>((resolve,reject)=>{const r=indexedDB.open(name,7);r.onupgradeneeded=()=>{for(const table of ['workspaces','jobs','subtitleVersions','artifacts','noteRevisions','templates','templateRevisions','scribbles','folders','favorites','cacheEntries','cachePlans'])r.result.createObjectStore(table,{keyPath:table==='jobs'?'jobId':table==='templateRevisions'?'revisionId':table==='cachePlans'?'planId':'id'});};r.onsuccess=()=>{const tx=r.result.transaction(['workspaces'],'readwrite');tx.objectStore('workspaces').put({id,source:{platform:'bilibili',videoId:'BVold',partId:'1',title:'old'},recentChatId:'old-chat',chats:[{id:'old-chat',title:'old',draft:{...emptyDraft(),text:'v7 retained'}}]});tx.oncomplete=()=>{r.result.close();resolve();};};r.onerror=()=>reject(r.error);});
  const space=await new IndexedWorkspaceStore(name).read(id,'old-chat');expect(space!.draft.text).toBe('v7 retained');
  const packet=JSON.parse(await new IndexedBackupStore(name).export());delete packet.payload.styles; delete packet.payload.styleRevisions; delete packet.payload.roles;delete packet.payload.roleRevisions;delete packet.payload.attachments;packet.manifest.formatVersion=1;packet.manifest.databaseVersion=7;packet.manifest.types=packet.manifest.types.filter((t:string)=>!['styles','styleRevisions','roles','roleRevisions','attachments'].includes(t));packet.manifest.checksum=await digest(packet.manifest.formatVersion>=6?{payload:packet.payload,...(packet.preferences?{preferences:packet.preferences}:{})}:packet.payload);
  const destination=crypto.randomUUID(),backup=new IndexedBackupStore(destination),plan=await backup.preview(JSON.stringify(packet));await backup.execute(plan.planId,plan.checksum);expect((await new IndexedWorkspaceStore(destination).read(id,'old-chat'))!.draft.text).toBe('v7 retained');
});
test('T15: full segmented subtitles and actual image parts share one final provider payload',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),images=new IndexedAttachmentStore(name),jobs=new IndexedGenerationStore(name);
  const a=await spaces.open({platform:'bilibili',videoId:'BVfixture',partId:'20',title:'fixture'}),target={kind:'chat' as const,workspaceId:a.id,chatId:a.chatId},binding={platform:'bilibili' as const,videoId:'BVfixture',partId:'20',tabId:1,documentId:'doc',epoch:1};
  await images.add(target,binding,0,{dataUrl:png(),width:2,height:2,time:1});const d=(await spaces.read(a.id,a.chatId))!.draft;await spaces.save(a.id,1,{...d,text:'picture',modelId:'fixture'},a.chatId);
  await expect(jobs.freezeChat(target,2,{binding,locator:'fixture',fingerprint:'fixture',language:'zh',cueCount:2})).rejects.toMatchObject({code:'unsupported-capability'});
  const job=await jobs.freezeChat(target,2,{binding,locator:'fixture',fingerprint:'fixture',language:'zh',cueCount:2},true);if(!('input' in job.snapshot))throw Error();
  const requests:any[]=[];
  const provider=createProviderPort('synthetic-key',async(_url,init)=>{requests.push(JSON.parse(init!.body as string));return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'answer'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});});
  await runChat(job.snapshot,[{from:0,to:1,content:'x'.repeat(7000)},{from:1,to:2,content:'y'.repeat(7000)}],provider,new AbortController().signal,async()=>{},await images.forSnapshot(job.snapshot));
  expect(requests).toHaveLength(1);expect(requests[0].messages[1].content).toContain('x'.repeat(100));expect(requests[0].messages[1].content).toContain('y'.repeat(100));expect(requests[0].messages.at(-1).content.at(-1)).toEqual({type:'image_url',image_url:{url:png()}});
});

test('T15: permission denial does not inspect media; corrupt bytes and excessive image budget fail', async()=>{
  const observe=vi.fn(), executeScript=vi.fn();
  vi.stubGlobal('chrome',{permissions:{contains:async()=>false},scripting:{executeScript}});
  try { await expect(captureCurrent({platform:'bilibili',videoId:'BVfixture',partId:'20',tabId:1,documentId:'doc',epoch:1},observe)).rejects.toMatchObject({code:'permission-denied'});expect(observe).not.toHaveBeenCalled();expect(executeScript).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); }
  const frame={dataUrl:png(),width:2,height:2,time:0};expect((await validateImage(frame)).bytes).toBeGreaterThan(0);
  const corrupted=Buffer.from(frame.dataUrl.slice(22),'base64');corrupted[42]^=1;
  await expect(validateImage({...frame,dataUrl:'data:image/png;base64,'+corrupted.toString('base64')})).rejects.toMatchObject({code:'invalid-message'});
  expect(()=>imageBudget(Array.from({length:11},()=>({bytes:1} as any)))).toThrow();
  expect(()=>imageBudget(Array.from({length:6},()=>({bytes:4*1048576} as any)))).toThrow();
  expect(()=>imageBudget(Array.from({length:10},()=>({bytes:2*1048576} as any)))).not.toThrow();
});
