import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedArtifactStore } from '../../src/data/artifact-store';
import { IndexedScribbleStore } from '../../src/data/scribble-store';
import { IndexedTemplateStore } from '../../src/data/template-store';
import { IndexedSubtitleStore } from '../../src/data/subtitle-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { IndexedManagementStore } from '../../src/data/management-store';

// Public semantic persistence, test build only. No HTTP or credential path.
export async function seedBackup(name = 'vcamp') {
  const spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name), notes = new IndexedArtifactStore(name), templates = new IndexedTemplateStore(name), subtitles = new IndexedSubtitleStore(name), library = new IndexedLibraryStore(name), scribbles = new IndexedScribbleStore(name), trash = new IndexedManagementStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'BVbackupA', partId: '101', title: '备份重复标题 · P1', videoTitle: '备份重复标题', pageNumber: 1, partCount: 2 };
  const a = await spaces.open(source), second = await spaces.createChat(a.id), p2 = await spaces.open({ ...source, partId: '102', pageNumber: 2, title: '备份重复标题 · P2' }), b = await spaces.open({ ...source, videoId: 'BVbackupB', partId: '201', title: '备份重复标题', partCount: 1 });
  const basis = { locator: 'native-locator-no-body', fingerprint: 'source-fingerprint', language: 'zh', cueCount: 1, binding: { platform: source.platform, videoId: source.videoId, partId: source.partId, tabId: 77, documentId: 'fixture-document', epoch: 1 } };
  const template = await templates.create({ name: '自定义旧模板', description: '版本依赖', requirements: '旧要求', outputType: 'markdown', defaultModelId: 'fixture' });
  await templates.save(template.id, 1, { name: '自定义新模板', description: '', requirements: '新要求', outputType: 'markdown', defaultModelId: 'fixture' });
  async function complete(wsId: string, chatId: string, content: string, refId?: string) {
    const draft = (await spaces.read(wsId, chatId))!.draft;
    await spaces.save(wsId, draft.revision, { ...draft, text: '备份请求', outputType: refId ? 'chat' : 'markdown', template: refId ? null : { templateId: template.id, revisionId: template.revisionId }, referenceIds: refId ? [refId] : [], modelId: 'fixture' }, chatId);
    const analysis = (await subtitles.query(wsId)).analysisSource;
    const job = await tasks.freezeChat({ kind: 'chat', workspaceId: wsId, chatId }, draft.revision + 1, { ...basis, ...(analysis.kind !== 'native' ? { subtitleVersionId: analysis.versionId } : {}), binding: { ...basis.binding, videoId: wsId === b.id ? 'BVbackupB' : source.videoId, partId: wsId === b.id ? '201' : source.partId } });
    const attempt = job.attempts[0].attemptId;
    await tasks.attach(job.jobId, attempt, 77); const claimed = (await tasks.claim(job.jobId, attempt, 77))!;
    await tasks.checkpoint(job.jobId, attempt, claimed.seq + 1, content, { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
    await tasks.finish(job.jobId, attempt, 'completed', null, crypto.randomUUID());
    return job;
  }
  const firstJob = await complete(a.id, a.chatId, '# 导入原文\n旧版笔记'), note = (await notes.list(a.id, a.chatId))[0];
  const referenceJob = await complete(a.id, a.chatId, '冻结引用旧正文的回答', note.id);
  await notes.save(a.id, note.id, 1, '# 导入原文\n已编辑最新版');
  // A subsequent request freezes prior user/assistant content and old template.
  await complete(a.id, a.chatId, '保留历史投影', note.id);
  const draft = (await spaces.read(a.id, a.chatId))!.draft;
  await spaces.save(a.id, draft.revision, { ...draft, text: '主对话未发送草稿', outputType: 'markdown', template: { templateId: template.id, revisionId: template.revisionId }, referenceIds: [note.id], references: [{ artifactId: note.id, workspaceId: a.id, sourceChatId: a.chatId, title: note.title, type: 'markdown' }] }, a.chatId);
  const sd = (await spaces.read(a.id, second.chatId))!.draft;
  await spaces.save(a.id, sd.revision, { ...sd, text: '导入的旧运行任务', modelId: 'fixture' }, second.chatId);
  const running = await tasks.freezeChat({ kind: 'chat', workspaceId: a.id, chatId: second.chatId }, sd.revision + 1, basis);
  await tasks.attach(running.jobId, running.attempts[0].attemptId, 77); const runningClaim = (await tasks.claim(running.jobId, running.attempts[0].attemptId, 77))!;
  await tasks.checkpoint(running.jobId, running.attempts[0].attemptId, runningClaim.seq + 1, '运行中的部分回答', { total: 1, covered: 0, ranges: [] });
  const pendingDraft = (await spaces.read(a.id, second.chatId))!.draft;
  await spaces.save(a.id, pendingDraft.revision, { ...pendingDraft, text: '运行时的新草稿', scribble: { text: '未提交随笔', time: 5 } }, second.chatId);
  const sub = await tasks.freezeSubtitle({ snapshotId: crypto.randomUUID(), target: { kind: 'subtitle', workspaceId: a.id, operation: 'enhance' }, source: { locator: basis.locator, fingerprint: basis.fingerprint }, targetLanguage: null, requirements: '', modelId: 'fixture' }, basis);
  await tasks.attach(sub.jobId, sub.attempts[0].attemptId, 77); const claimed = (await tasks.claim(sub.jobId, sub.attempts[0].attemptId, 77))!;
  await tasks.checkpoint(sub.jobId, sub.attempts[0].attemptId, claimed.seq + 1, '', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  const subtitleId = crypto.randomUUID();
  await tasks.finish(sub.jobId, sub.attempts[0].attemptId, 'completed', null, subtitleId, { kind: 'subtitle', cues: [{ from: 0, to: 2, content: '保留的 AI 增强字幕' }] });
  await subtitles.select(a.id, 0, { kind: 'enhanced', versionId: subtitleId });
  const heldDraft = (await spaces.read(a.id, a.chatId))!.draft;
  const enhancedJob = await complete(a.id, a.chatId, '已保存增强源问答', note.id);
  const afterEnhanced = (await spaces.read(a.id, a.chatId))!.draft;
  await spaces.save(a.id, afterEnhanced.revision, { ...heldDraft, revision: afterEnhanced.revision }, a.chatId);
  const translated = await tasks.freezeSubtitle({ snapshotId: crypto.randomUUID(), target: { kind: 'subtitle', workspaceId: a.id, operation: 'translate' }, source: { subtitleVersionId: subtitleId }, targetLanguage: 'en', requirements: '', modelId: 'fixture' }, { ...basis, subtitleVersionId: subtitleId });
  const translationAttempt = translated.attempts[0].attemptId;
  await tasks.attach(translated.jobId, translationAttempt, 77); const translationClaim = (await tasks.claim(translated.jobId, translationAttempt, 77))!;
  await tasks.checkpoint(translated.jobId, translationAttempt, translationClaim.seq + 1, '', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  const translationId = crypto.randomUUID();
  await tasks.finish(translated.jobId, translationAttempt, 'completed', null, translationId, { kind: 'subtitle', cues: [{ from: 0, to: 2, content: 'Saved translation from enhanced source' }] });
  const scribble = await scribbles.create(a.id, '导入的具体随笔', 6), deletedChild = await scribbles.create(p2.id, '先删子项再删空间', null);
  await complete(b.id, b.chatId, '# 来源已删除的笔记');
  const bNote = (await notes.list(b.id))[0];
  await trash.move({ workspaceId: b.id, entityType: 'chat', id: b.chatId }, 0);
  await trash.move({ workspaceId: p2.id, entityType: 'scribble', id: deletedChild.id }, 0);
  await trash.move({ workspaceId: p2.id, entityType: 'workspace', id: p2.id }, 0);
  const folder = await library.createFolder('重复文件夹标题');
  await library.addFavorite(folder.id, { workspaceId: a.id, entityType: 'markdown', id: note.id });
  await library.addFavorite(folder.id, { workspaceId: b.id, entityType: 'markdown', id: bNote.id });
  await library.recordObservation(source, 33, Date.now());
  await spaces.selectChat(a.id, second.chatId);
  return { a, second, p2, b, note, bNote, template, subtitleId, translationId, enhancedJobId: enhancedJob.jobId, scribble, deletedChild, runningId: running.jobId, firstJobId: firstJob.jobId, referenceJobId: referenceJob.jobId, folder };
}
