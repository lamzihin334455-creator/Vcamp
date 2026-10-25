import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';

test('B: an aborted draft transaction reports failure and keeps the last saved draft', async () => {
  const store = new IndexedWorkspaceStore(`abort-${crypto.randomUUID()}`);
  const source = { platform: 'bilibili' as const, videoId: 'video', partId: 'part', title: '视频' };
  const opened = await store.open(source);
  const saved = await store.save(opened.id, 0, { ...opened.draft, text: '此前已保存' });

  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (this.name === 'workspaces') this.transaction.abort();
    return originalPut.call(this, value, key);
  };
  try {
    await expect(store.save(saved.id, saved.draft.revision, { ...saved.draft, text: '本次应回滚' }))
      .rejects.toMatchObject({ code: 'storage-failed' });
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }

  expect((await store.read(saved.id))?.draft.text).toBe('此前已保存');
});
