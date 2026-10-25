// Test build only. Fixture content goes through existing semantic commits; no
// model API, Key, raw database writes or production sample library.
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedScribbleStore } from '../../src/data/scribble-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { IndexedArtifactStore } from '../../src/data/artifact-store';
async function seed() {
const spaces = new IndexedWorkspaceStore(), tasks = new IndexedGenerationStore(), scribbles = new IndexedScribbleStore(), library = new IndexedLibraryStore();
const source = { platform: 'bilibili' as const, videoId: 'BVlibraryA', partId: '11', title: '重复视频标题 · P1 私密章节', videoTitle: '重复视频标题', partTitle: '私密章节', pageNumber: 1, partCount: 2 };
const a = await spaces.open(source), second = await spaces.createChat(a.id);
await spaces.save(a.id, 0, { ...second.draft, text: '当前工作台草稿必须保留' }, second.chatId);
const p2 = await spaces.open({ ...source, partId: '12', title: '重复视频标题 · P2 第二章', partTitle: '第二章', pageNumber: 2 });
const b = await spaces.open({ ...source, videoId: 'BVlibraryB', partId: '21', title: '重复视频标题', partTitle: '单 P', partCount: 1 });
const binding = { platform: 'bilibili' as const, videoId: source.videoId, partId: source.partId, tabId: 101, documentId: 'semantic-fixture', epoch: 1 };
const basis = { locator: 'semantic-fixture', fingerprint: 'semantic-fixture', language: 'zh', cueCount: 1, binding };
for (const [outputType, text] of [['chat', '资料库持久问答'], ['markdown', '# 资料库真实笔记\n\n固定空间的正文。']] as const) {
  const draft = (await spaces.read(a.id, a.chatId))!.draft;
  await spaces.save(a.id, draft.revision, { ...draft, text: 'fixture question', outputType, modelId: 'fixture' }, a.chatId);
  const job = await tasks.freezeChat({ kind: 'chat', workspaceId: a.id, chatId: a.chatId }, draft.revision + 1, basis), attempt = job.attempts[0].attemptId;
  await tasks.attach(job.jobId, attempt, 101); const claimed = (await tasks.claim(job.jobId, attempt, 101))!;
  await tasks.checkpoint(job.jobId, attempt, claimed.seq + 1, text, { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  await tasks.finish(job.jobId, attempt, 'completed', null, crypto.randomUUID());
}
const note = await scribbles.create(a.id, '资料库持久随笔', 2);
const sub = await tasks.freezeSubtitle({ snapshotId: crypto.randomUUID(), target: { kind: 'subtitle', workspaceId: a.id, operation: 'translate' }, source: { locator: 'semantic-fixture', fingerprint: 'semantic-fixture' }, targetLanguage: 'en', requirements: '', modelId: 'fixture' }, basis), attempt = sub.attempts[0].attemptId;
await tasks.attach(sub.jobId, attempt, 101); const claimed = (await tasks.claim(sub.jobId, attempt, 101))!;
await tasks.checkpoint(sub.jobId, attempt, claimed.seq + 1, '', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
await tasks.finish(sub.jobId, attempt, 'completed', null, 'library-saved-subtitle', { kind: 'subtitle', cues: [{ from: 0, to: 1, content: 'Library saved AI subtitle' }] });
await library.recordObservation(source, 3, Date.now());
await spaces.selectChat(a.id, second.chatId);
const result = { a, second, p2, b, note, artifact: (await new IndexedArtifactStore().list(a.id))[0] };
(window as unknown as { fixture: unknown }).fixture = result;
document.body.textContent = 'Semantic fixture ready';

}
void seed().catch(error => { document.body.textContent = String(error); });
