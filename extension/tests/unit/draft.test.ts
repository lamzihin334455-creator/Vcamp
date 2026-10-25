import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { createApplication } from '../../src/app/application';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import type { SaveDraft } from '../../src/contracts/application';

test('A: saved draft returns after reopening the application and database', async () => {
  const db = `draft-${crypto.randomUUID()}`;
  const binding = { platform: 'bilibili' as const, videoId: 'test-video', partId: 'test-part', title: '测试视频' };
  const app = createApplication(new IndexedWorkspaceStore(db));
  const session = await app.openPanel(binding);
  const before = await session.query();
  expect(before.draft?.text).toBe('');
  await session.command({ type: 'draft.save', expectedRevision: 0, draft: { ...before.draft!, text: '保留这份中文草稿', outputType: 'markdown' } });
  const reopened = await createApplication(new IndexedWorkspaceStore(db)).openPanel(binding);
  expect((await reopened.query()).draft).toMatchObject({ text: '保留这份中文草稿', outputType: 'markdown', revision: 1 });
});

test('A: readonly requests cannot save even if a caller constructs a write command', async () => {
  const app = createApplication(new IndexedWorkspaceStore(`reader-${crypto.randomUUID()}`));
  const panel = await app.openPanel({ platform: 'bilibili', videoId: 'v', partId: 'p', title: '视频' });
  const original = await panel.query();
  const reader = app.openReader(original.workspaceId!);
  await expect(reader.command({ type: 'draft.save', expectedRevision: 0, draft: original.draft! })).rejects.toMatchObject({ code: 'forbidden' });
  expect((await reader.query()).draft).toBeNull();
});

test('A: a stale window cannot overwrite another saved draft', async () => {
  const app = createApplication(new IndexedWorkspaceStore(`conflict-${crypto.randomUUID()}`));
  const session = await app.openPanel({ platform: 'bilibili', videoId: 'v', partId: 'p', title: '视频' });
  const draft = (await session.query()).draft!;
  await session.command({ type: 'draft.save', expectedRevision: 0, draft: { ...draft, text: '窗口 A' } });
  await expect(session.command({ type: 'draft.save', expectedRevision: 0, draft: { ...draft, text: '窗口 B' } })).rejects.toMatchObject({ code: 'revision-conflict' });
  expect((await session.query()).draft?.text).toBe('窗口 A');
});

test('A: malformed commands are rejected without changing the saved draft', async () => {
  const panel = await createApplication(new IndexedWorkspaceStore(`invalid-${crypto.randomUUID()}`)).openPanel({ platform: 'bilibili', videoId: 'v', partId: 'p', title: '视频' });
  await expect(panel.command({ type: 'draft.save', expectedRevision: 0, draft: { text: 42 } } as unknown as SaveDraft)).rejects.toMatchObject({ code: 'invalid-message' });
  expect((await panel.query()).draft?.text).toBe('');
});

test('A: equal titles in different stable parts keep separate drafts', async () => {
  const app = createApplication(new IndexedWorkspaceStore(`parts-${crypto.randomUUID()}`));
  const source = { platform: 'bilibili' as const, videoId: 'same-video', partId: 'part-a', title: '重复标题' };
  const a = await app.openPanel(source);
  const b = await app.openPanel({ ...source, partId: 'part-b' });
  const original = await a.query();
  await a.command({ type: 'draft.save', expectedRevision: 0, draft: { ...original.draft!, text: 'A 的草稿' } });
  expect((await b.query()).draft?.text).toBe('');
  expect((await (await app.openPanel({ ...source, title: '标题改变' })).query()).draft?.text).toBe('A 的草稿');
});
