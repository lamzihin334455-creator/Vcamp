import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedStyleStore} from '../../src/data/style-store';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';

test('a builtin HTML style selected in a draft restores into a fresh database and remains portable',async()=>{
  const sourceName=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(sourceName);
  const row=await spaces.open({platform:'bilibili',videoId:'BVstyleBackup',partId:'1',title:'合成风格备份样本'});
  const style=(await new IndexedStyleStore(sourceName).list()).find(item=>item.name==='新拟态')!;
  await spaces.save(row.id,0,{...row.draft,text:'待生成的页面草稿',outputType:'html',htmlStyle:{styleId:style.id,revisionId:style.revisionId}});
  const file=await new IndexedBackupStore(sourceName).export(),targetName=crypto.randomUUID(),target=new IndexedBackupStore(targetName);
  const plan=await target.preview(file);await target.execute(plan.planId,plan.checksum);
  const restored=(await new IndexedWorkspaceStore(targetName).read(row.id))!.draft;
  expect(restored.text).toBe('待生成的页面草稿');expect(Object.keys(restored.htmlStyle!).sort()).toEqual(['revisionId','styleId']);
  expect(restored.htmlStyle!.styleId).not.toBe(style.id);
  expect(await new IndexedStyleStore(targetName).revision(restored.htmlStyle!.styleId,restored.htmlStyle!.revisionId)).toMatchObject({name:style.name,description:style.description});
  expect((await target.preview(file)).added).toBe(0);
  const next=new IndexedBackupStore(crypto.randomUUID());await expect(next.preview(await target.export())).resolves.toHaveProperty('planId');
});

test('frozen builtin style revisions retain provenance while draft selections stay two IDs',async()=>{
  const sourceName=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(sourceName),tasks=new IndexedGenerationStore(sourceName);
  const source={platform:'bilibili' as const,videoId:'BVfrozenStyle',partId:'1',title:'合成冻结风格样本'},row=await spaces.open(source);
  const style=(await new IndexedStyleStore(sourceName).list()).find(item=>item.name==='新拟态')!;
  await spaces.save(row.id,0,{...row.draft,text:'生成页面',outputType:'html',modelId:'fixture',htmlStyle:{styleId:style.id,revisionId:style.revisionId}});
  const job=await tasks.freezeChat({kind:'chat',workspaceId:row.id,chatId:row.chatId},1,{locator:'fixture',fingerprint:'fixture',language:'zh',cueCount:1,binding:{...source,tabId:1,documentId:'doc',epoch:1}});
  const targetName=crypto.randomUUID(),target=new IndexedBackupStore(targetName),plan=await target.preview(await new IndexedBackupStore(sourceName).export());await target.execute(plan.planId,plan.checksum);
  const restored=await new IndexedGenerationStore(targetName).get(job.jobId);
  expect(restored!.snapshot).toMatchObject({htmlStyle:{name:style.name,description:style.description,backupOriginalId:style.revisionId}});
  const draft=(await new IndexedWorkspaceStore(targetName).read(row.id))!.draft;expect(Object.keys(draft.htmlStyle!).sort()).toEqual(['revisionId','styleId']);
});
