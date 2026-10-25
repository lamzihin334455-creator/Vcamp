import { chromium, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const output = resolve(`../.tmp/t20-backup-${Date.now()}`); await mkdir(output, { recursive: true });
const bundle = join(output, 'package'); await cp(resolve('dist'), bundle, { recursive: true });
await mkdir(join(bundle, 'tests/installed'), { recursive: true });
await cp('dist-test/tests/installed/backup-seed.html', join(bundle, 'tests/installed/backup-seed.html'));
for (const file of await readdir('dist-test/assets')) if (file === 'backupSeed.js' || /-[\w-]+\.(js|css)$/.test(file)) await cp(join('dist-test/assets', file), join(bundle, 'assets', file));
const result = { date: new Date().toISOString(), actualModelApiCalls: 0, modelPostsObserved: 0, checks: [], productionHashes: {}, pass: false };
for (const file of await readdir('dist/assets')) {
  const original = await readFile(join('dist/assets', file)); assert.deepEqual(await readFile(join(bundle, 'assets', file)), original);
  result.productionHashes[file] = createHash('sha256').update(original).digest('hex');
}
assert.deepEqual(await readFile(join(bundle, 'manifest.json')), await readFile('dist/manifest.json'));
let source, target;
const open = async profile => {
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 360, height: 800 }, acceptDownloads: true, args: [`--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`] });
  // Inspect only the worker URL; no worker/executor DevTools attachment.
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  context.on('request', request => { if (request.method() === 'POST' && request.url().includes('/chat/completions')) result.modelPostsObserved++; });
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const proof = await context.newPage(); await proof.goto(`chrome-extension://${id}/tests/installed/backup-seed.html`); await proof.waitForFunction(() => !!window.backupProof);
  return { context, panel, proof, id };
};
const op = (page, operation) => page.evaluate(async operation => {
  const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation });
  if (!response.ok) throw Error(response.code); return response.view;
}, operation);
const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log(name); };
const storage = async session => {
  await session.panel.bringToFront();
  await session.panel.getByRole('button', { name: '资料库', exact: true }).click();
  await session.panel.getByRole('button', { name: '存储管理', exact: true }).click();
  await expect(session.panel.getByRole('heading', { name: '备份与导入' })).toBeVisible();
};
const selectFile = async (session, path) => {
  // Actual browser file input, not injecting JSON into component state.
  await session.panel.getByLabel('选择备份文件').setInputFiles(path);
  await expect(session.panel.getByRole('heading', { name: '合并导入概览' })).toBeVisible();
};
const commit = async session => { await session.panel.getByRole('button', { name: '确认合并导入', exact: true }).click(); await expect(session.panel.getByRole('status').filter({ hasText: '合并导入完成' })).toBeVisible(); };
const shot = async (session, name) => {
  await session.panel.screenshot({ path: join(output, name + '.png'), fullPage: true });
  assert.equal(await session.panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
};
const reader = async (session, workspaceId, key, id, content) => {
  const page = await session.context.newPage(), params = new URLSearchParams({ library: '1', workspaceId, [key]: id });
  await page.goto(`chrome-extension://${session.id}/reader.html?${params}`);
  await expect(page.locator('body')).toContainText(content); await page.close();
};
const exported = session => op(session.panel, { type: 'library.backup.export' }).then(v => JSON.parse(v.library.backup.file));
try {
  const sourceProfile = await mkdtemp(join(output, 'source-profile-')), targetProfile = await mkdtemp(join(output, 'target-profile-'));
  source = await open(sourceProfile); result.browser = source.context.browser().version();
  const f = await source.proof.evaluate(() => window.backupProof.seed());
  await source.proof.evaluate(() => window.backupProof.cache());
  await op(source.panel, { type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key: 'SYNTHETIC_CREDENTIAL_NOT_BACKED' });
  await storage(source);
  const downloadEvent = source.panel.waitForEvent('download'); await source.panel.getByRole('button', { name: '下载资料备份' }).click();
  const download = await downloadEvent, filePath = join(output, 'semantic-backup.json'); await download.saveAs(filePath);
  const text = await readFile(filePath, 'utf8'), packet = JSON.parse(text);
  assert.equal(text.includes('SYNTHETIC_CREDENTIAL_NOT_BACKED'), false); assert.equal(text.includes('SYNTHETIC_CACHE_NOT_BACKED'), false);
  assert.equal(text.includes('fixture-document'), false); assert.equal(text.includes('"executor"'), false);
  assert.equal(packet.payload.workspaces.length, 3); assert.equal(packet.payload.noteRevisions.length, 3);
  await shot(source, 'download-360');
  check('actual download from production management UI; synthetic credentials/cache/browser capabilities excluded', { bytes: Buffer.byteLength(text), workspaces: 3 });
  target = await open(targetProfile); await storage(target);
  const before = await exported(target); await selectFile(target, filePath); await shot(target, 'preview-360');
  await target.panel.getByRole('button', { name: '确认合并导入', exact: true }).scrollIntoViewIfNeeded(); await shot(target, 'preview-confirm-360');
  assert.deepEqual((await exported(target)).payload, before.payload);
  check('file chooser preview in empty profile does not mutate business data');
  await commit(target); await shot(target, 'result-360');
  assert.equal((await op(target.panel, { type: 'provider.query' })).provider.hasKey, false);
  const job = await target.proof.evaluate(id => window.backupProof.job(id), f.runningId);
  assert.equal(job.attempts[0].state, 'interrupted'); assert.equal(job.attempts[0].executor, null); assert.equal(job.basis.binding.tabId, -1);
  assert.equal((await op(target.panel, { type: 'generation.query', target: { kind: 'chat', workspaceId: f.a.id, chatId: f.second.chatId } })).generation.messages.find(m => m.role === 'assistant').state, 'interrupted');
  check('confirmed merge preserves current types, interrupts imported tasks, does not transfer provider configuration');
  await target.context.close(); target = await open(targetProfile);
  await reader(target, f.a.id, 'artifactId', f.note.id, '已编辑最新版');
  await reader(target, f.a.id, 'scribbleId', f.scribble.id, '导入的具体随笔');
  await reader(target, f.a.id, 'subtitleVersionId', f.subtitleId, '保留的 AI 增强字幕');
  await reader(target, f.a.id, 'subtitleVersionId', f.translationId, 'Saved translation from enhanced source');
  await reader(target, f.a.id, 'chatId', f.a.chatId, '保留历史投影');
  await reader(target, f.b.id, 'artifactId', f.bNote.id, '来源对话已删除');
  check('browser restart opens exact Markdown/scribble/AI subtitle/Chat and deleted-source readers');
  await storage(target); await selectFile(target, filePath);
  await expect(target.panel.getByLabel('导入概览')).toContainText('新增 0 条'); await commit(target);
  check('same downloaded package is deduplicated after restart');
  // Real UI stale-plan abort. Mutate one target through the public data adapter,
  // then verify confirmation imports no additional rows or relations.
  await selectFile(target, filePath);
  await target.proof.evaluate(f => window.backupProof.mutate(f.a.id, f.a.chatId, '预览之后的草稿修改'), f);
  const changed = (await exported(target)).payload;
  await target.panel.getByRole('button', { name: '确认合并导入', exact: true }).click();
  await expect(target.panel.getByRole('alert')).toContainText('预览已过期');
  assert.deepEqual((await exported(target)).payload, changed);
  check('stale confirmation abort leaves the full graph unchanged');
  await target.panel.getByRole('button', { name: '返回资料库', exact: true }).click();
  await target.panel.getByRole('button', { name: '回收站', exact: true }).click();
  const parent = (await op(target.panel, { type: 'library.trash.query' })).library.trash.entries.find(e => e.target.id === f.p2.id);
  await op(target.panel, { type: 'library.trash.restore', target: parent.target, expectedRevision: parent.revision });
  await expect(target.panel.getByText('先删子项再删空间', { exact: true })).toBeVisible();
  assert((await op(target.panel, { type: 'library.trash.query' })).library.trash.entries.some(e => e.target.id === f.deletedChild.id));
  check('restoring imported parent preserves independently deleted child');
  await source.proof.evaluate(f => window.backupProof.conflict(f), f);
  const localJobBefore = await source.proof.evaluate(id => window.backupProof.job(id), f.runningId);
  await selectFile(source, filePath);
  const mergePlan = (await op(source.panel, { type: 'library.backup.preview', file: text })).library.backup.plan;
  await commit(source);
  const mappedChat = mergePlan.mapping.find(m => m.from === f.a.chatId).to, mappedNote = mergePlan.mapping.find(m => m.from === f.note.id).to;
  await reader(source, f.a.id, 'artifactId', f.note.id, '本机冲突正文');
  await reader(source, f.a.id, 'artifactId', mappedNote, '已编辑最新版');
  const importedDraft = await source.proof.evaluate(({ id, chatId }) => window.backupProof.space(id, chatId), { id: f.a.id, chatId: mappedChat });
  assert.equal(importedDraft.draft.text, '主对话未发送草稿'); assert.deepEqual(importedDraft.draft.referenceIds, [mappedNote]); assert.equal(importedDraft.draft.references[0].sourceChatId, mappedChat);
  const refJob = await source.proof.evaluate(id => window.backupProof.job(id), mergePlan.mapping.find(m => m.from === f.referenceJobId).to);
  assert.equal(refJob.snapshot.target.chatId, mappedChat); assert.equal(refJob.snapshot.referenceSnapshots[0].artifactId, mappedNote); assert.equal(refJob.snapshot.referenceSnapshots[0].content, '# 导入原文\n旧版笔记');
  assert.deepEqual(await source.proof.evaluate(id => window.backupProof.job(id), f.runningId), localJobBefore);
  assert.equal((await op(source.panel, { type: 'provider.query' })).provider.hasKey, true);
  const library = (await op(source.panel, { type: 'library.query' })).library; assert(library.favorites.some(v => v.target.id === mappedNote));
  await source.panel.bringToFront(); await shot(source, 'conflict-result-360');
  check('existing profile conflicts retain local/imported contents, draft, frozen references, template versions, favorites and local task state');
  assert.equal((await op(source.panel, { type: 'library.backup.preview', file: text })).library.backup.plan.added, 0);
  assert.equal(result.modelPostsObserved, 0); assert.equal(source.context.pages().some(p => p.url().includes('executor.html')), false); assert.equal(target.context.pages().some(p => p.url().includes('executor.html')), false);
  check('no imported executor or automatic model POST'); result.pass = true;
} catch (error) { result.error = String(error.stack ?? error); throw error; }
finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
  if (source) await source.context.close(); if (target) await target.context.close();
  console.log('Evidence:', output);
}
