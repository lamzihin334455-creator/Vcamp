import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedLibraryStore } from '../../src/data/library-store';
import { IndexedDocumentStore } from '../../src/data/document-store';
import { createLibraryService } from '../../src/library/service';
import { createMessageRouter } from '../../src/app/message-router';
import { subtitleBasis } from '../../src/generation/subtitle-context';

test('finishing a correction preserves a newer explicit native language selection', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'correction-selection', partId: '1', title: '双语视频' }, space = await spaces.open(source);
  const cues = [{ from: 0, to: 1, content: 'chat gbt' }];
  const basis = await subtitleBasis({ ...source, tabId: 1, documentId: 'doc', epoch: 1 }, 'zh-CN', cues);
  await tasks.subtitleStore.select(space.id, 0, { kind: 'native', language: 'zh-CN' });
  const job = await tasks.freezeSubtitle({ snapshotId: crypto.randomUUID(), target: { kind: 'subtitle', workspaceId: space.id, operation: 'enhance' }, source: { locator: basis.locator, fingerprint: basis.fingerprint }, targetLanguage: null, requirements: '', modelId: 'fixture' }, basis);
  const attempt = job.attempts[0].attemptId;
  await tasks.attach(job.jobId, attempt, 1); const claimed = (await tasks.claim(job.jobId, attempt, 1))!;
  await tasks.subtitleStore.select(space.id, 1, { kind: 'native', language: 'en' });
  await tasks.checkpoint(job.jobId, attempt, claimed.seq + 1, '', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  await tasks.finish(job.jobId, attempt, 'completed', null, 'corrected-zh', { kind: 'subtitle', cues: [{ from: 0, to: 1, content: 'ChatGPT' }] });
  expect((await tasks.subtitleStore.query(space.id)).analysisSource).toEqual({ kind: 'native', language: 'en' });
  expect((await tasks.subtitleVersions(space.id))).toMatchObject([{ id: 'corrected-zh', language: 'zh-CN' }]);
});

test('a fixed library reader uses saved documents without observing or listing transient native subtitles', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), store = new IndexedLibraryStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'reader-native', partId: '1', title: '阅读器' }, space = await spaces.open(source);
  let liveReads = 0;
  const service = createLibraryService(store, async () => {}, async () => {}, undefined, undefined, undefined, undefined, undefined, new IndexedDocumentStore(name), async () => {
    liveReads++; return { workspaceId: space.id, language: 'zh-CN', cues: [{ from: 0, to: 1, content: '临时原始字幕' }] };
  });
  const router = createMessageRouter(spaces, 'test', async () => source, undefined, undefined, undefined, undefined, undefined, undefined, undefined, service);
  const sender = { id: 'test', url: `chrome-extension://test/reader.html?library=1&workspaceId=${encodeURIComponent(space.id)}` };
  const result = await router.handle({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'library.read', workspaceId: space.id } }, sender);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('reader failed');
  expect(result.view.library?.entities.filter(entity => entity.entityType === 'subtitle')).toEqual([]);
  expect(liveReads).toBe(0);
  const nativeExport = await router.handle({ version: 1, requestId: crypto.randomUUID(), operation: { type: 'library.export', selection: [{ target: { workspaceId: space.id, entityType: 'subtitle', id: 'native:zh-CN' }, format: 'srt' }] } }, sender);
  expect(nativeExport.ok).toBe(true);
  if (!nativeExport.ok) throw new Error('export request failed');
  expect(nativeExport.view.library?.documents?.files).toEqual([]);
  expect(nativeExport.view.library?.documents?.errors).toHaveLength(1);
  expect(liveReads).toBe(0);
  const interactive = await service.command({ type: 'library.read', workspaceId: space.id });
  expect(interactive.entities.filter(entity => entity.entityType === 'subtitle')).toMatchObject([{ id: 'native:zh-CN' }]);
  expect(liveReads).toBe(1);
});
