import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedTemplateStore } from '../../src/data/template-store';
import { IndexedStyleStore } from '../../src/data/style-store';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { templateCommandSchema } from '../../src/contracts/template';

test('template ordering persists across reload/edit/add/delete without changing content revisions', async () => {
  const name = crypto.randomUUID(), store = new IndexedTemplateStore(name), original = await store.list();
  const ids = original.map(row => row.id).reverse();
  await store.reorder(ids);
  expect((await new IndexedTemplateStore(name).list()).map(row => row.id)).toEqual(ids);
  const current = (await store.list())[0];
  expect(current.revision).toBe(original.find(row => row.id === current.id)!.revision);
  const revision = await store.revision(current.id, current.revisionId);
  expect(revision).not.toHaveProperty('sortIndex');
  const edited = await store.save(current.id, current.revision, { name: '重新命名', description: '', requirements: '回答', outputType: 'chat', defaultModelId: null });
  expect((await store.list())[0].id).toBe(current.id);
  expect(await store.revision(current.id, edited.revisionId)).not.toHaveProperty('sortIndex');
  const added = await store.create({ name: '新增', description: '', requirements: '回答', outputType: 'chat', defaultModelId: null });
  expect((await store.list()).at(-1)!.id).toBe(added.id);
  await store.delete(current.id, edited.revision);
  await store.reorder(ids); // A stale window cannot revive a deleted row or drop a concurrent addition.
  expect((await store.list()).map(row => row.id)).toEqual([...ids.filter(id => id !== current.id), added.id]);
  expect(templateCommandSchema.safeParse({ type: 'template.reorder', ids: [added.id, added.id] }).success).toBe(false);
});

test('style/template sort metadata survives backup restore with immutable histories', async () => {
  const name = crypto.randomUUID(), styles = new IndexedStyleStore(name), templates = new IndexedTemplateStore(name);
  const a = await styles.list(), b = await templates.list();
  await styles.reorder(a.map(row => row.id).reverse()); await templates.reorder(b.map(row => row.id).reverse());
  const file = await new IndexedBackupStore(name).export();
  const other = crypto.randomUUID(), backup = new IndexedBackupStore(other), plan = await backup.preview(file);
  await backup.execute(plan.planId, plan.checksum);
  // The existing backup policy restores builtins as independent user copies.
  expect((await new IndexedStyleStore(other).list()).filter(row => !row.builtin).map(row => row.name)).toEqual(a.map(row => row.name).reverse());
  expect((await new IndexedTemplateStore(other).list()).filter(row => !row.builtin).map(row => row.name)).toEqual(b.map(row => row.name).reverse());
  const moved = (await styles.list())[0];
  await styles.save(moved.id, moved.revision, { name: '更新风格', description: '清晰排版' });
  expect((await styles.list())[0].id).toBe(moved.id);
  expect((await styles.list())[0].revision).toBe(moved.revision + 1);
});
