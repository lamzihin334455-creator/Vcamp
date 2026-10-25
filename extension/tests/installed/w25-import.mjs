import { chromium, expect } from '@playwright/test';
import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Fresh synthetic profiles only. Production background/observer and permissions
// are byte-identical; the additional fixture page only prepares saved history.
const output = resolve('../.tmp/w25-installed-' + Date.now());
await mkdir(output, { recursive: true });
const bundle = join(output, 'package'); await cp('dist', bundle, { recursive: true });
await mkdir(join(bundle, 'tests/installed'), { recursive: true });
await cp('dist-test/tests/installed/backup-seed.html', join(bundle, 'tests/installed/backup-seed.html'));
for (const file of await readdir('dist-test/assets')) if (file === 'backupSeed.js' || /-[\w-]+\.(js|css)$/.test(file)) await cp(join('dist-test/assets', file), join(bundle, 'assets', file));
const evidence = { at: new Date().toISOString(), pass: false, actualModelApiCalls: 0, modelPostsObserved: 0, blockedExternalRequests: 0, checks: [], productionHashes: {} };
async function verifyProduction(path = '') {
  for (const item of await readdir(join('dist', path), { withFileTypes: true })) {
    const relative = join(path, item.name);
    if (item.isDirectory()) await verifyProduction(relative);
    else { const data = await readFile(join('dist', relative)); assert.deepEqual(await readFile(join(bundle, relative)), data); evidence.productionHashes[relative] = createHash('sha256').update(data).digest('hex'); }
  }
}
await verifyProduction();
const html = `<!doctype html><meta charset="utf-8"><title>Synthetic video observer</title><video></video><script>
window.__INITIAL_STATE__={videoData:{bvid:'BVimportfix',title:'合成导入视频',pages:[{page:1,cid:101,part:'合成导入分P'}]}};
window.player={getVideoMessage:()=>({bvid:'BVimportfix',cid:101})};
const video=document.querySelector('video'), start=Date.now();
Object.defineProperty(video,'currentTime',{get:()=>120+(Date.now()-start)/1000});
setInterval(()=>video.dispatchEvent(new Event('timeupdate',{bubbles:true})),300);
</script>`;
const op = (page, operation) => page.evaluate(async operation => {
  const result = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation });
  if (!result.ok) throw Error(result.code); return result.view;
}, operation);
const exported = async session => JSON.parse((await op(session.panel, { type: 'library.backup.export' })).library.backup.file).payload;
const check = (name, detail = {}) => { evidence.checks.push({ name, ...detail }); console.log(name); };
async function open(profile) {
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 390, height: 850 }, acceptDownloads: true, args: [`--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`] });
  context.on('request', request => { if (request.method() === 'POST' && request.url().includes('/chat/completions')) evidence.modelPostsObserved++; });
  await context.route(/^https?:/, route => {
    if (route.request().url() === 'https://www.bilibili.com/video/BVimportfix') return route.fulfill({ contentType: 'text/html', body: html });
    evidence.blockedExternalRequests++; return route.abort();
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const proof = await context.newPage(); await proof.goto(`chrome-extension://${id}/tests/installed/backup-seed.html`); await proof.waitForFunction(() => !!window.backupProof);
  return { context, panel, proof, id };
}
async function storage(session) {
  await session.panel.bringToFront(); await session.panel.getByRole('button', { name: '资料库', exact: true }).click();
  await session.panel.getByRole('button', { name: '存储管理', exact: true }).click();
}
async function preview(session, file) {
  await session.panel.getByLabel('选择备份文件').setInputFiles(file);
  await expect(session.panel.getByRole('heading', { name: '合并导入概览' })).toBeVisible();
}
async function confirm(session) {
  await session.panel.getByRole('button', { name: '确认合并导入', exact: true }).click();
  await expect(session.panel.getByRole('status').filter({ hasText: '合并导入完成' })).toBeVisible();
}
async function observing(session, id, after = 0) {
  await expect.poll(async () => (await exported(session)).workspaces.find(w => w.id === id)?.watchPosition?.observedAt ?? 0, { timeout: 12000 }).toBeGreaterThan(after);
  return (await exported(session)).workspaces.find(w => w.id === id).watchPosition;
}
async function reader(session, workspaceId, key, id, text) {
  const page = await session.context.newPage(); await page.goto(`chrome-extension://${session.id}/reader.html?${new URLSearchParams({ library: '1', workspaceId, [key]: id })}`);
  await expect(page.locator('body')).toContainText(text); await page.close();
}
let source, target;
try {
  source = await open(join(output, 'source-profile')); evidence.browser = source.context.browser().version();
  const f = await source.proof.evaluate(() => window.backupProof.seedImport());
  await storage(source);
  const pending = source.panel.waitForEvent('download'); await source.panel.getByRole('button', { name: '下载资料备份' }).click();
  const file = join(output, 'synthetic-backup.json'); await (await pending).saveAs(file);
  const packet = JSON.parse(await readFile(file, 'utf8')); assert.equal(packet.manifest.formatVersion, 3); assert.equal(packet.manifest.databaseVersion, 8);
  check('UI download contains synthetic A, B revision 2, knowledge v1 and immutable dependencies', { jobs: packet.payload.jobs.length, revisions: packet.payload.noteRevisions.length });
  const profile = join(output, 'target-profile'); target = await open(profile);
  const local = await target.proof.evaluate(source => window.backupProof.openLocal(source), f.source);
  // The synthetic profile grants only the three already-declared optional
  // origins through Chrome's extension manager (no manifest modifications).
  const manager = await target.context.newPage(); await manager.goto(`chrome://extensions/?id=${target.id}`);
  await manager.evaluate(async id => {
    for (const host of ['https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://aisubtitle.hdslb.com/*']) await chrome.developerPrivate.addHostPermission(id, host);
  }, target.id);
  await manager.close();
  await target.panel.bringToFront();
  await target.panel.getByRole('button', { name: '授权读取 B 站', exact: true }).click();
  await expect.poll(() => target.panel.evaluate(() => chrome.permissions.contains({ origins: ['https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://aisubtitle.hdslb.com/*'] })) ).toBe(true);
  const video = await target.context.newPage(); await video.goto('https://www.bilibili.com/video/BVimportfix');
  const first = await observing(target, local.id);
  await storage(target); await preview(target, file);
  const atPreview = (await exported(target)).workspaces.find(w => w.id === local.id).watchPosition;
  const during = await observing(target, local.id, atPreview.observedAt);
  assert.equal((await exported(target)).artifacts.length, 0);
  await confirm(target);
  let restored = await exported(target), workspace = restored.workspaces.find(w => w.id === local.id);
  assert(workspace.watchPosition.observedAt >= during.observedAt); assert(workspace.watchPosition.time >= during.time); assert.equal(workspace.recentChatId, local.chatId);
  assert.equal(restored.noteRevisions.find(r => r.id === restored.artifacts.find(a => a.id === f.note.id).revisionId).content, '# 合成 B 编辑版 revision 2');
  check('production observer writes continue between UI preview and confirm; merge preserves latest local position and current Chat', { before: first, atPreview, during, after: workspace.watchPosition });
  await op(target.panel, { type: 'artifact.save', workspaceId: local.id, artifactId: f.note.id, expectedRevision: 2, content: '# 本机并发后保留的笔记' });
  await target.proof.evaluate(f => window.backupProof.mutate(f.a.id, f.a.chatId, '本机保留草稿'), f);
  await preview(target, file);
  const conflictPreview = (await exported(target)).workspaces.find(w => w.id === local.id).watchPosition;
  const beforeConflict = await observing(target, local.id, conflictPreview.observedAt);
  await target.panel.screenshot({ path: join(output, 'conflict-preview.png'), fullPage: true });
  await confirm(target);
  restored = await exported(target); workspace = restored.workspaces.find(w => w.id === local.id);
  const copy = workspace.chats.find(c => c.backupOriginalId === f.a.chatId); assert(copy);
  const copiedNote = restored.artifacts.find(a => a.sourceChatId === copy.id && a.type === 'markdown');
  const copiedKnowledge = restored.artifacts.find(a => a.sourceChatId === copy.id && a.type === 'html');
  assert.equal(workspace.chats.find(c => c.id === f.a.chatId).draft.text, '本机保留草稿');
  assert.equal(restored.artifacts.find(a => a.id === f.note.id).revision, 3);
  assert.equal(copiedNote.revision, 2); assert.deepEqual(copy.draft.referenceIds, [copiedNote.id]);
  assert.equal(copy.draft.references[0].sourceChatId, copy.id);
  assert.equal(copy.draft.knowledgeFollowup.artifactId, copiedKnowledge.id); assert.equal(copy.draft.knowledgeFollowup.revisionId, copiedKnowledge.revisionId);
  const copiedJob = restored.jobs.find(j => j.snapshot.target.chatId === copy.id && j.snapshot.outputType === 'html');
  assert.equal(copiedJob.snapshot.referenceSnapshots[0].artifactId, copiedNote.id);
  assert.equal(copiedJob.snapshot.referenceSnapshots[0].revisionId, copiedNote.revisionId);
  assert(copiedJob.snapshot.historyProjection.some(m => m.text === '合成 A 已保存回答'));
  assert(workspace.watchPosition.observedAt >= beforeConflict.observedAt); assert.equal(workspace.recentChatId, local.chatId);
  check('confirmed conflict copies remap Chat, edited note, knowledge selection, frozen references and history without overwriting local edits', { chatCopied: copy.id !== f.a.chatId, noteCopied: copiedNote.id !== f.note.id, knowledgeCopied: copiedKnowledge.id !== f.knowledge.id });
  await target.panel.screenshot({ path: join(output, 'import-complete.png'), fullPage: true });
  await target.context.close(); target = await open(profile);
  await reader(target, local.id, 'chatId', copy.id, '合成 A 已保存回答');
  await reader(target, local.id, 'artifactId', copiedNote.id, '合成 B 编辑版 revision 2');
  await reader(target, local.id, 'knowledgeId', copiedKnowledge.id, '合成知识 v1');
  const knowledge = (await op(target.panel, { type: 'knowledge.query', workspaceId: local.id, artifactId: copiedKnowledge.id })).knowledge.artifacts[0];
  assert.equal(knowledge.document.groups[0].items[0].body, '合成条目正文'); assert.equal(knowledge.sourceChatId, copy.id);
  check('browser restart reads exact imported Chat, revision 2 note and knowledge through production readers and service route');
  assert.equal(evidence.modelPostsObserved, 0);
  assert.equal(target.context.pages().some(page => page.url().includes('/executor.html')), false);
  evidence.pass = true;
} catch (error) { evidence.error = String(error.stack ?? error); throw error; }
finally {
  await source?.context.close(); await target?.context.close();
  await verifyProduction();
  await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ output, pass: evidence.pass, modelPostsObserved: evidence.modelPostsObserved }));
}
