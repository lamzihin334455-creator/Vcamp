import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedArtifactStore } from '../../src/data/artifact-store';
import { IndexedKnowledgeStore } from '../../src/data/knowledge-store';

// Synthetic saved history only: no provider, HTTP or model execution.
export async function seedImport(name = 'vcamp') {
  const spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  const notes = new IndexedArtifactStore(name), knowledge = new IndexedKnowledgeStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'BVimportfix', partId: '101', title: '合成导入视频', videoTitle: '合成导入视频', partTitle: '合成导入分P', pageNumber: 1, partCount: 1 };
  const a = await spaces.open(source), target = { kind: 'chat' as const, workspaceId: a.id, chatId: a.chatId };
  const basis = { locator: 'synthetic', fingerprint: 'synthetic', language: 'zh', cueCount: 1,
    binding: { ...source, tabId: 77, documentId: 'synthetic', epoch: 1 } };
  async function complete(input: string, text: string, outputType: 'chat' | 'markdown' | 'html', referenceIds: string[] = []) {
    const row = (await spaces.read(a.id, a.chatId))!;
    await spaces.save(a.id, row.draft.revision, { ...row.draft, text: input, outputType, template:outputType==='html'?{templateId:'builtin-map',revisionId:'builtin-map:v2'}:null, referenceIds, modelId: 'synthetic' }, a.chatId);
    const job = await tasks.freezeChat(target, row.draft.revision + 1, basis), attemptId = job.attempts[0].attemptId;
    await tasks.attach(job.jobId, attemptId, 77);
    const claimed = (await tasks.claim(job.jobId, attemptId, 77))!;
    await tasks.checkpoint(job.jobId, attemptId, claimed.seq + 1, text, { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
    await tasks.finish(job.jobId, attemptId, 'completed', null, crypto.randomUUID());
    return job;
  }
  await complete('合成 A', '合成 A 已保存回答', 'chat');
  await complete('合成 B', '# 合成 B 初版', 'markdown');
  const note = (await notes.list(a.id, a.chatId))[0];
  await notes.save(a.id, note.id, 1, '# 合成 B 编辑版 revision 2');
  const document = { version: 1, title: '合成知识 v1', summary: '仅用于导入回归。',
    groups: [{ id: 'g1', title: '知识', items: [{ id: 'i1', title: '合成条目', body: '合成条目正文', basis: 'video', question: '合成问题？' }] }],
    concepts: [], relations: [], questions: [] };
  const knowledgeJob = await complete('合成 C', JSON.stringify(document), 'html', [note.id]);
  const item = (await knowledge.list(a.id))[0];
  const row = (await spaces.read(a.id, a.chatId))!;
  await spaces.save(a.id, row.draft.revision, { ...row.draft, text: '合成未发送草稿', outputType: 'chat', referenceIds: [note.id],
    references: [{ artifactId: note.id, workspaceId: a.id, sourceChatId: a.chatId, title: note.title, type: 'markdown' }],
    knowledgeFollowup: { artifactId: item.id, revisionId: item.revisionId, entryId: 'i1', question: '合成问题？' } }, a.chatId);
  return { a, source, note, knowledge: item, knowledgeJobId: knowledgeJob.jobId };
}
