import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedAttachmentStore } from '../../src/data/attachment-store';
import { IndexedManagementStore } from '../../src/data/management-store';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { png } from '../fixtures/png';

async function fixture(outputType: 'chat' | 'html' = 'chat') {
  const name=crypto.randomUUID(), spaces=new IndexedWorkspaceStore(name), jobs=new IndexedGenerationStore(name);
  const a=await spaces.open({platform:'bilibili',videoId:'BVfixture',partId:'20',title:'fixture'});
  const target={kind:'chat' as const,workspaceId:a.id,chatId:a.chatId}, binding={platform:'bilibili' as const,videoId:'BVfixture',partId:'20',tabId:1,documentId:'doc',epoch:1};
  const draft=(await spaces.read(a.id,a.chatId))!.draft;
  await spaces.save(a.id,0,{...draft,outputType,template:outputType==='html'?{templateId:'builtin-map',revisionId:'builtin-map:v2'}:null,text:'画面问题',modelId:'fixture'},a.chatId);
  const job=await jobs.freezeChat(target,1,{binding,locator:'original',fingerprint:'original',language:'zh',cueCount:1},true,true),id=job.attempts[0].attemptId;
  await jobs.attach(job.jobId,id,5); await jobs.claim(job.jobId,id,5);
  return {name,spaces,jobs,a,target,job,id};
}
const stage={phase:'capturing' as const,plan:{times:[1],reason:'画面细节'},attachmentIds:[],resolution:'images' as const};
test('T16: attempt-owned frame never edits draft; final evidence freezes, retry reuses exactly; backup remaps dependencies',async()=>{
  const f=await fixture();
  await f.jobs.visual(f.job.jobId,f.id,stage);
  const captured=await f.jobs.visual(f.job.jobId,f.id,stage,{dataUrl:png(),width:2,height:2,time:1});
  const visual=captured.attempts[0].visual!; expect(visual.attachmentIds).toHaveLength(1);
  expect((await f.spaces.read(f.a.id,f.a.chatId))!.draft.attachmentIds).toEqual([]);
  expect(captured.snapshot).toEqual(f.job.snapshot);
  await f.jobs.visual(f.job.jobId,f.id,{...visual,phase:'answering',frozen:true});
  await expect(f.jobs.visual(f.job.jobId,f.id,{...visual,phase:'planning'})).rejects.toMatchObject({code:'revision-conflict'});
  await f.jobs.finish(f.job.jobId,f.id,'failed','network');
  const retry=await f.jobs.retry(f.job.jobId); expect(retry.attempts[1].visual).toEqual({...visual,phase:'answering',frozen:true}); expect(retry.snapshot).toEqual(f.job.snapshot);
  const file=await new IndexedBackupStore(f.name).export(); expect(file).not.toContain('documentId'); expect(file).not.toContain('executor');
  const dest=crypto.randomUUID(), importer=new IndexedBackupStore(dest),plan=await importer.preview(file);await importer.execute(plan.planId,plan.checksum);
  const imported=(await new IndexedGenerationStore(dest).get(f.job.jobId))!;
  expect(imported.attempts[1].state).toBe('interrupted');
  expect((await new IndexedAttachmentStore(dest).read(f.target,visual.attachmentIds,true))[0].time).toBe(1);
});
test('T16: stop and deletion beat late decoded frame; restoration never revives the old attempt',async()=>{
  for(const deletion of [false,true]){
    const f=await fixture();await f.jobs.visual(f.job.jobId,f.id,stage);
    if(deletion)await new IndexedManagementStore(f.name).move({workspaceId:f.a.id,entityType:'chat',id:f.a.chatId},0);
    else await f.jobs.finish(f.job.jobId,f.id,'stopped');
    await f.jobs.visual(f.job.jobId,f.id,stage,{dataUrl:png(),width:2,height:2,time:1}).catch(()=>{});
    if(deletion)await new IndexedManagementStore(f.name).restore({workspaceId:f.a.id,entityType:'chat',id:f.a.chatId},1);
    expect((await f.jobs.get(f.job.jobId))!.attempts[0]).toMatchObject({state:'stopped',visual:{attachmentIds:[]}});
    expect((await new IndexedBackupStore(f.name).export())).not.toContain('data:image');
  }
});
test('T16: no image decision while model/media fault; partial plan cannot freeze as complete',async()=>{
  const f=await fixture();await f.jobs.visual(f.job.jobId,f.id,{phase:'permission',attachmentIds:[],issue:'model'});
  await expect(f.jobs.decideVisual(f.job.jobId,'images')).rejects.toMatchObject({code:'unsupported-capability'});
  await f.jobs.decideVisual(f.job.jobId,'subtitle');
  await expect(f.jobs.decideVisual(f.job.jobId,'images')).rejects.toMatchObject({code:'revision-conflict'});
  await expect(f.jobs.visual(f.job.jobId,f.id,{...stage,frozen:true})).rejects.toMatchObject({code:'invalid-message'});
});

// One direct merge smoke: frozen T16 images + T09 structured result + format3.
import { runChat } from '../../src/generation/run-chat';
import { IndexedKnowledgeStore } from '../../src/data/knowledge-store';
import type { ChatRequestSnapshot } from '../../src/contracts/generation';
test('T09/T16 merged path keeps structured knowledge instructions, images and backup conflict mapping', async () => {
  const f = await fixture('html');
  const captured = await f.jobs.visual(f.job.jobId, f.id, stage, { dataUrl: png(), width: 2, height: 2, time: 1 });
  const visual = captured.attempts[0].visual!;
  const ready = await f.jobs.visual(f.job.jobId, f.id, { ...visual, phase: 'answering', frozen: true });
  const images = await new IndexedAttachmentStore(f.name).read(f.target, visual.attachmentIds, true);
  const document = { version: 1, title: '画面知识', summary: '测试资料', groups: [{ id: 'g', title: '分类', items: [{ id: 'i', title: '条目', body: '正文', basis: 'video', question: '问题' }] }], concepts: [], relations: [], questions: [] };
  let seq = ready.seq;
  await runChat(f.job.snapshot as ChatRequestSnapshot, [{ from: 0, to: 2, content: '完整字幕' }], { async stream(_model, messages, _signal, delta) {
    expect(messages[0].content).toContain('交互知识 JSON v1');
    expect(messages.at(-1)!.content).toContainEqual({ type: 'image_url', image_url: { url: png() } });
    await delta(JSON.stringify(document));
  } }, new AbortController().signal, async (text, coverage) => { seq = (await f.jobs.checkpoint(f.job.jobId, f.id, seq + 1, text, coverage)).seq; }, images, undefined, visual.attachmentIds);
  await f.jobs.finish(f.job.jobId, f.id, 'completed', null, 'knowledge-image-result');
  expect((await new IndexedKnowledgeStore(f.name).list(f.a.id))[0].document).toEqual(document);
  expect((await f.jobs.view(f.target)).messages.at(-1)).toMatchObject({ outputType: 'html', text: '', attachmentIds: visual.attachmentIds, artifactId: 'knowledge-image-result' });
  const file = await new IndexedBackupStore(f.name).export();
  expect(JSON.parse(file).manifest).toMatchObject({ formatVersion: 6, databaseVersion: 10 });
  for (const forbidden of ['visibleOnce', 'vcamp.media', 'visionGrant', 'documentId']) expect(file).not.toContain(forbidden);
  const dest = crypto.randomUUID(), backup = new IndexedBackupStore(dest);
  const first = await backup.preview(file); await backup.execute(first.planId, first.checksum);
  const spaces = new IndexedWorkspaceStore(dest), local = (await spaces.read(f.a.id, f.a.chatId))!;
  await spaces.save(f.a.id, local.draft.revision, { ...local.draft, text: '本机新输入' }, f.a.chatId);
  const conflict = await backup.preview(file); await backup.execute(conflict.planId, conflict.checksum);
  const mapped = (id: string) => conflict.mapping.find(item => item.from === id)!.to;
  const job = (await new IndexedGenerationStore(dest).get(mapped(f.job.jobId)))!;
  expect(job.attempts[0].visual!.attachmentIds).toEqual(visual.attachmentIds.map(mapped));
  expect((await new IndexedKnowledgeStore(dest).list(f.a.id)).find(item => item.sourceChatId === mapped(f.a.chatId))!.document).toEqual(document);
});
