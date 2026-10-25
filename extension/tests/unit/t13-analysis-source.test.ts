import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedSubtitleStore } from '../../src/data/subtitle-store';
import { subtitleBasis } from '../../src/generation/subtitle-context';

test('the selected main subtitle is shared by Chats, frozen for retry, rejects cross-space/deleted sources and never silently restores native', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name), subtitles = new IndexedSubtitleStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'enhance', partId: '1', title: '增强' }, a = await spaces.open(source), b = await spaces.open({ ...source, partId: '2' });
  const native = [{ from: 0, to: 1, content: '原始' }], enhanced = [{ from: 0, to: 1, content: '增强清楚的概念' }];
  const binding = { platform: source.platform, videoId: source.videoId, partId: source.partId, tabId: 1, documentId: 'doc', epoch: 1 }, basis = await subtitleBasis(binding, 'zh', native);
  const job = await tasks.freezeSubtitle({ snapshotId: crypto.randomUUID(), target: { kind: 'subtitle', workspaceId: a.id, operation: 'enhance' }, source: { locator: basis.locator, fingerprint: basis.fingerprint }, targetLanguage: null, requirements: '', modelId: 'fixture' }, basis);
  await tasks.attach(job.jobId, job.attempts[0].attemptId, 1); const claimed = (await tasks.claim(job.jobId, job.attempts[0].attemptId, 1))!;
  await tasks.checkpoint(job.jobId, job.attempts[0].attemptId, claimed.seq + 1, '', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  await tasks.finish(job.jobId, job.attempts[0].attemptId, 'completed', null, 'enhanced-v1', { kind: 'subtitle', cues: enhanced });
  await subtitles.select(a.id, 0, { kind: 'enhanced', versionId: 'enhanced-v1' });
  const selectedBasis = { ...await subtitleBasis(binding, 'zh', enhanced), subtitleVersionId: 'enhanced-v1' };
  let lastRequestId = '';
  for (const chat of [a, await spaces.createChat(a.id)]) {
    await spaces.save(a.id, 0, { ...chat.draft, text: '分析', modelId: 'fixture' }, chat.chatId);
    const request = await tasks.freezeChat({ kind: 'chat', workspaceId: a.id, chatId: chat.chatId }, 1, selectedBasis);
    lastRequestId = request.jobId;
    expect(request.snapshot).toMatchObject({ analysisSource: { kind: 'version', versionId: 'enhanced-v1', fingerprint: selectedBasis.fingerprint } });
    await tasks.finish(request.jobId, request.attempts[0].attemptId, 'stopped');
    await subtitles.select(a.id, (await subtitles.query(a.id)).sourceRevision, { kind: 'native' });
    expect((await tasks.retry(request.jobId)).basis).toEqual(selectedBasis);
    await tasks.finish(request.jobId, (await tasks.get(request.jobId))!.attempts.at(-1)!.attemptId, 'stopped');
    await subtitles.select(a.id, (await subtitles.query(a.id)).sourceRevision, { kind: 'enhanced', versionId: 'enhanced-v1' });
  }
  await expect(subtitles.select(b.id, 0, { kind: 'enhanced', versionId: 'enhanced-v1' })).rejects.toMatchObject({ code: 'source-changed' });
  await subtitles.invalidate(a.id, 'enhanced-v1');
  expect(await subtitles.query(a.id)).toMatchObject({ analysisSource: { kind: 'version', versionId: 'enhanced-v1' }, sourceValid: false, versions: [] });
  await expect(tasks.retry(lastRequestId)).rejects.toMatchObject({ code: 'source-changed' });
  const draft = (await spaces.read(a.id, a.chatId))!.draft;
  await spaces.save(a.id, draft.revision, { ...draft, text: '删除后不得切源' }, a.chatId);
  await expect(tasks.freezeChat({ kind: 'chat', workspaceId: a.id, chatId: a.chatId }, draft.revision + 1, selectedBasis)).rejects.toMatchObject({ code: 'source-changed' });
  await subtitles.select(a.id, (await subtitles.query(a.id)).sourceRevision, { kind: 'native' });
  expect((await subtitles.query(a.id)).sourceValid).toBe(true);
  await subtitles.select(a.id, (await subtitles.query(a.id)).sourceRevision, { kind: 'native', language: 'en' });
  await expect(tasks.freezeChat({ kind: 'chat', workspaceId: a.id, chatId: a.chatId }, draft.revision + 1, basis)).rejects.toMatchObject({ code: 'source-changed' });
  const englishBasis = await subtitleBasis(binding, 'en', native);
  const englishRequest = await tasks.freezeChat({ kind: 'chat', workspaceId: a.id, chatId: a.chatId }, draft.revision + 1, englishBasis);
  expect(englishRequest.snapshot).toMatchObject({ analysisSource: { kind: 'native', locator: englishBasis.locator, fingerprint: englishBasis.fingerprint } });
});
