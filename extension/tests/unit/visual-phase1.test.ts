import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import type { Attachment } from '../../src/contracts/attachment';
import type { ChatRequestSnapshot } from '../../src/contracts/generation';
import { validateEvidencePlan, type EvidencePlan, type VisionAudit, type VisionStage } from '../../src/contracts/vision';
import { allocateVisualPlan, candidateTimes, completeHistory, explorationPlan, nearDuplicate, selectedHistory } from '../../src/generation/visual-selection';
import { captureEvidence } from '../../src/generation/capture-evidence';
import { runChat } from '../../src/generation/run-chat';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedAttachmentStore } from '../../src/data/attachment-store';
import { IndexedBackupStore } from '../../src/data/backup-store';
import { png } from '../fixtures/png';

const snapshot: ChatRequestSnapshot = { snapshotId: 'fixture', target: { kind: 'chat', workspaceId: 'w', chatId: 'c' }, input: '分析画面', outputType: 'chat', modelId: 'fixture', mediaDuration: 100, webEnabled: false, templateRevisionId: null, historyProjection: [], referenceSnapshotIds: [], attachmentIds: [] };
const item = (id = 'chart', anchor = 4): EvidencePlan['evidence'][number] => ({ id, need: '读取图例', reason: '相关字幕附近，允许音画偏移', priority: 'required', mode: 'single', reuseAttachmentIds: [], detailNeed: 'read-text', windows: [{ from: anchor - 1, to: anchor + 2, anchor, cueIds: [0], basis: 'subtitle' }] });
const plan = (evidence = [item()]): EvidencePlan => ({ version: 2, scope: 'focused', needsNewFrames: evidence.some(e => e.windows.length), evidence, unresolved: [] });
const cues = [{ from: 2, to: 8, content: '这两条线对应不同条件' }];
const auditFor = (p = plan(), s = snapshot, images: Attachment[] = []) => allocateVisualPlan(p, s, images, '完整规划字幕', '完整最终字幕');
const sample = (score = 20) => ({ sharpness: score, contrast: score * 2.4, luma: [10, 30, 60, 90] });
const frame = (time: number, score = 20) => ({ time, width: 2, height: 2, dataUrl: png(), sample: sample(score) });
const accept = async (frame: { time: number }, slot: VisionAudit['slots'][number], a: VisionAudit) => { a.frames.push({ slotKey: slot.key, attachmentId: crypto.randomUUID(), time: frame.time, detail: slot.detail }); return a; };

test('evidence windows accept subtitle uncertainty but reject invented references and half groups', () => {
  expect(validateEvidencePlan(plan(), 100, cues, [])).toEqual(plan());
  const invalid = [
    (p: EvidencePlan) => { p.evidence[0].windows[0].cueIds = [99]; },
    (p: EvidencePlan) => { p.evidence[0].windows[0].from = 9; p.evidence[0].windows[0].to = 12; p.evidence[0].windows[0].anchor = 10; },
    (p: EvidencePlan) => { p.evidence[0].windows[0].to = 100; },
    (p: EvidencePlan) => { p.evidence[0].mode = 'pair'; },
    (p: EvidencePlan) => { p.needsNewFrames = false; },
    (p: EvidencePlan) => { p.evidence[0].reuseAttachmentIds = [crypto.randomUUID()]; p.evidence[0].windows = []; p.needsNewFrames = false; },
    (p: EvidencePlan) => { p.evidence.push(structuredClone(p.evidence[0])); }
  ];
  for (const change of invalid) { const p = plan(); change(p); expect(() => validateEvidencePlan(p, 100, cues, [])).toThrow(); }
});

test('global allocation shares a window, keeps required groups atomic and records every budget omission', () => {
  const shared = auditFor(plan([item('legend'), item('axis')]));
  expect(shared.slots).toHaveLength(1); expect(shared.slots[0].evidenceIds).toEqual(['legend', 'axis']);
  const images = Array.from({ length: 5 }, (_, i) => ({ id: crypto.randomUUID(), bytes: 100, time: i } as Attachment));
  const p = plan([{ ...item('compare'), mode: 'pair', windows: [item('a', 4).windows[0], item('b', 20).windows[0]] }]);
  const a = auditFor(p, { ...snapshot, attachmentIds: images.map(i => i.id) }, images);
  expect(a.slots).toEqual([]); expect(a.unresolved.join('')).toContain('整组');
});

test('global allocation considers temporal coverage and predicted bytes instead of reserving six maximum-sized PNGs', () => {
  const p = { ...plan([item('start', 4), item('near', 5), item('end', 90), item('middle', 50), item('later', 70), item('earlier', 25)]), scope: 'whole-video' as const };
  const a = auditFor(p);
  expect(a.slots).toHaveLength(6); expect(a.slots.slice(0, 2).map(s => s.anchor)).toEqual([4, 90]);
  expect(a.budget.imageTokensUpperBound).toBe(6144);
  expect(a.budget.finalOutputReserved).toBeGreaterThan(0);
  expect(() => allocateVisualPlan(p, snapshot, [], '字'.repeat(1500000), '字'.repeat(1500000))).toThrow('visual-token-budget');
});

test('candidate timestamps preserve precise anchors and never leave the proposed window', () => {
  const slot = auditFor().slots[0];
  const point = { ...slot, from: 1.234567, to: 1.234567, anchor: 1.234567 };
  expect(candidateTimes(point, 3)).toEqual([1.234567]);
  expect(candidateTimes(slot, 2)).toHaveLength(2);
  expect(candidateTimes(slot, 3).every(t => t >= slot.from && t <= slot.to)).toBe(true);
});

test('window selection adopts a clearer delayed frame and strips local pixel samples before persistence', async () => {
  const p = plan(), a = auditFor(p), saved: any[] = [];
  const done = await captureEvidence(p, a, async t => frame(t, t === 5 ? 20 : 1), async (f, s, a) => { saved.push(f); return accept(f, s, a); }, async () => {}, new AbortController().signal, () => 0);
  expect(done.candidates.filter(c => c.decision === 'selected').map(c => c.time)).toEqual([5]);
  expect(saved[0].time).toBe(5); expect(saved[0].sample).toBeUndefined(); expect(done.budget.captures).toBe(3);
});

test('local appearance comparison protects tiny changed cells and identical before/after states', async () => {
  expect(nearDuplicate(sample(), { ...sample(), luma: [10, 30, 60, 95] })).toBe(false);
  const p = plan([{ ...item(), mode: 'pair', windows: [item('a', 4).windows[0], item('b', 20).windows[0]] }]);
  const done = await captureEvidence(p, auditFor(p), async t => frame(t), accept, async () => {}, new AbortController().signal, () => 0);
  expect(done.frames).toHaveLength(2); expect(done.candidates.filter(c => c.decision === 'selected')).toHaveLength(2);
});

test('low-texture legal frames are retained with an uncertainty record instead of classified as capture failures', async () => {
  const p = plan();
  const done = await captureEvidence(p, auditFor(p), async t => frame(t, 0), accept, async () => {}, new AbortController().signal, () => 0);
  expect(done.frames).toHaveLength(1); expect(done.unresolved.join('')).toContain('低纹理');
});

test('overlapping state windows cannot select a sharper frame that reverses the actual before/after order', async () => {
  const p = plan([{ ...item(), mode: 'pair', windows: [item('a', 4).windows[0], item('b', 4.1).windows[0]] }]);
  const done = await captureEvidence(p, auditFor(p), async t => frame(t, Math.abs(t - 5) < .01 || t < 3.2 ? 20 : 1), accept, async () => {}, new AbortController().signal, () => 0);
  expect(done.frames.map(f => f.time)).toEqual([5, 5.1]);
});

test('total media deadline discards a whole unfinished group and never sends its historical half', async () => {
  const old = crypto.randomUUID(), p = plan([{ ...item(), mode: 'sequence', reuseAttachmentIds: [old], windows: [item('a', 4).windows[0], item('b', 20).windows[0]] }]);
  const a = auditFor(p, { ...snapshot, historyProjection: [{ messageId: 'm', contentVersionId: 'v', role: 'assistant', text: '前状态', referenceSnapshotIds: [], attachmentIds: [old] }] }, [{ id: old, bytes: 100 } as Attachment]);
  a.budget.maxCaptures = 2;
  let elapsed = 0, saved = 0;
  const done = await captureEvidence(p, a, async t => { elapsed = 30000; return frame(t); }, async (f, s, a) => { saved++; return accept(f, s, a); }, async () => {}, new AbortController().signal, () => elapsed);
  expect(saved).toBe(0); expect(done.stopReason).toBe('budget'); expect(done.unresolved.join('')).toContain('未发送半组');
  expect(completeHistory(p, done, [])).toEqual([]);
});

test('abort prevents all late frame commits', async () => {
  const controller = new AbortController(); let saved = false;
  await expect(captureEvidence(plan(), auditFor(), async t => { controller.abort(); return frame(t); }, async (_, __, a) => { saved = true; return a; }, async () => {}, controller.signal, () => 0)).rejects.toThrow();
  expect(saved).toBe(false);
});

test('captionless exploration prioritizes user time and explicitly disclaims whole-video absence conclusions', () => {
  const p = explorationPlan({ ...snapshot, input: '看一下00:35的设置' }, 100);
  expect(p.evidence.map(e => e.windows[0].anchor)).toEqual([35]); expect(p.scope).toBe('focused');
  expect(p.unresolved.join('')).toContain('不能以未发现');
  expect(explorationPlan({ ...snapshot, input: '看3分12秒的图' }, 300).evidence[0].windows[0].anchor).toBe(192);
});

test('final request sends only selected frozen images, preserves all subtitle cues and applies image detail', async () => {
  const id = crypto.randomUUID(), skip = crypto.randomUUID();
  const s = { ...snapshot, historyProjection: [{ messageId: 'm', contentVersionId: 'v', role: 'assistant' as const, text: '前一轮文字仍保留', referenceSnapshotIds: [], attachmentIds: [id, skip] }] };
  const images: Attachment[] = [id, skip].map(id => ({ ...frame(4), id, bytes: 77, mimeType: 'image/png', sha256: '0'.repeat(64), createdAt: 1, workspaceId: 'w', chatId: 'c', source: { platform: 'bilibili', videoId: 'v', partId: 'p' } }));
  let sent: any;
  await runChat(s, cues, { async stream(_, messages, __, delta) { sent = messages; await delta('完成'); } }, new AbortController().signal, async () => {}, images, undefined, [], '', undefined, { history: selectedHistory(s, [id]), detailById: { [id]: 'original' }, tokenAllowance: 1048576 });
  const parts = sent.flatMap((m: any) => typeof m.content === 'string' ? [] : m.content);
  expect(parts.filter((p: any) => p.type === 'image_url')).toEqual([{ type: 'image_url', image_url: { url: png(), detail: 'original' } }]);
  expect(JSON.stringify(sent)).toContain(cues[0].content); expect(JSON.stringify(sent)).toContain('前一轮文字仍保留');
  let called = false;
  await expect(runChat(s, cues, { async stream() { called = true; } }, new AbortController().signal, async () => {}, images, undefined, [], '', undefined, { history: [], detailById: {}, tokenAllowance: 1 })).rejects.toMatchObject({ code: 'context-limit' });
  expect(called).toBe(false);
});

test('window-based atomic storage binds actual time, frozen retry and backup conflict remapping', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), jobs = new IndexedGenerationStore(name);
  const ws = await spaces.open({ platform: 'bilibili', videoId: 'BVfixture', partId: '20', title: 'fixture' });
  const target = { kind: 'chat' as const, workspaceId: ws.id, chatId: ws.chatId }, draft = (await spaces.read(ws.id, ws.chatId))!.draft;
  await spaces.save(ws.id, 0, { ...draft, text: '读取设置', modelId: 'fixture' }, ws.chatId);
  const job = await jobs.freezeChat(target, 1, { binding: { platform: 'bilibili', videoId: 'BVfixture', partId: '20', tabId: 1, documentId: 'doc', epoch: 1 }, locator: 'original', fingerprint: 'original', language: 'zh', cueCount: 1, mediaDuration: 100 }, true, true);
  const id = job.attempts[0].attemptId;
  await jobs.attach(job.jobId, id, 5); await jobs.claim(job.jobId, id, 5);
  const p = plan([{...item(),readTargets:['图例名称']}]), a = auditFor(p, job.snapshot as ChatRequestSnapshot), v: VisionStage = { phase: 'capturing', resolution: 'images', attachmentIds: [], plan: { times: [4], reason: '窗口择帧' }, evidencePlan: p, audit: a };
  await jobs.visual(job.jobId, id, v);
  await expect(jobs.visual(job.jobId, id, v, { ...frame(40), sample: undefined } as any, a.slots[0].key)).rejects.toMatchObject({ code: 'invalid-message' });
  const { sample: _sample, ...captured } = frame(5);
  const stored = await jobs.visual(job.jobId, id, v, captured, a.slots[0].key), visual = stored.attempts[0].visual!;
  expect(visual.audit!.frames[0]).toMatchObject({ time: 5, detail: 'original' });
  const frozen = { ...visual, phase: 'answering' as const, frozen: true };
  await jobs.visual(job.jobId, id, frozen); await jobs.finish(job.jobId, id, 'failed', 'network');
  expect((await jobs.retry(job.jobId)).attempts[1].visual).toEqual(frozen);
  const dest = crypto.randomUUID(), importer = new IndexedBackupStore(dest), file = await new IndexedBackupStore(name).export();
  const first = await importer.preview(file); await importer.execute(first.planId, first.checksum);
  const other = new IndexedWorkspaceStore(dest), local = (await other.read(ws.id, ws.chatId))!;
  await other.save(ws.id, local.draft.revision, { ...local.draft, text: '本机新内容' }, ws.chatId);
  const conflict = await importer.preview(file); await importer.execute(conflict.planId, conflict.checksum);
  const mapped = (value: string) => conflict.mapping.find(m => m.from === value)!.to;
  const copy = (await new IndexedGenerationStore(dest).get(mapped(job.jobId)))!;
  expect(copy.attempts[1].visual!.evidencePlan!.evidence[0].readTargets).toEqual(['图例名称']);
  expect(copy.attempts[1].visual!.audit!.qualityVersion).toBe('local-v2');
  expect(copy.attempts[1].visual!.audit!.slots[0].detailReason).toContain('图例名称');
  expect(copy.attempts[1].visual!.audit!.frames[0].attachmentId).toBe(mapped(visual.attachmentIds[0]));
  expect((await new IndexedAttachmentStore(dest).read({ ...target, chatId: mapped(ws.chatId) }, copy.attempts[1].visual!.attachmentIds, true))[0].time).toBe(5);
});

test('historical reuse remains frozen and remaps both planned and selected IDs on backup conflict', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), jobs = new IndexedGenerationStore(name);
  const ws = await spaces.open({ platform: 'bilibili', videoId: 'BVreuse', partId: '1', title: 'fixture' });
  const target = { kind: 'chat' as const, workspaceId: ws.id, chatId: ws.chatId };
  const basis = { binding: { platform: 'bilibili' as const, videoId: 'BVreuse', partId: '1', tabId: 1, documentId: 'doc', epoch: 1 }, locator: 'original', fingerprint: 'original', language: 'zh', cueCount: 1, mediaDuration: 100 };
  const freeze = async () => {
    const draft = (await spaces.read(ws.id, ws.chatId))!.draft;
    await spaces.save(ws.id, draft.revision, { ...draft, text: '比较刚才的设置', modelId: 'fixture' }, ws.chatId);
    const job = await jobs.freezeChat(target, draft.revision + 1, basis, true, true), id = job.attempts[0].attemptId;
    await jobs.attach(job.jobId, id, 5); await jobs.claim(job.jobId, id, 5); return { job, id };
  };
  const first = await freeze(), oldStage: VisionStage = { phase: 'capturing', resolution: 'images', attachmentIds: [], plan: { times: [1], reason: '之前的设置' } };
  const old = await jobs.visual(first.job.jobId, first.id, oldStage, { dataUrl: png(), width: 2, height: 2, time: 1 });
  const oldVisual = old.attempts[0].visual!, oldId = oldVisual.attachmentIds[0];
  const ready = await jobs.visual(first.job.jobId, first.id, { ...oldVisual, phase: 'answering', frozen: true });
  await jobs.checkpoint(first.job.jobId, first.id, ready.seq + 1, '已读取的设置', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 0 }] });
  await jobs.finish(first.job.jobId, first.id, 'completed', null, crypto.randomUUID());
  const next = await freeze(), s = next.job.snapshot as ChatRequestSnapshot;
  expect(s.historyProjection.flatMap(h => h.attachmentIds)).toContain(oldId);
  const p = plan([{ ...item(), windows: [], reuseAttachmentIds: [oldId] }]);
  const a = auditFor(p, s, await new IndexedAttachmentStore(name).forSnapshot(s));
  expect(a.historyAttachmentIds).toEqual([oldId]);
  await jobs.visual(next.job.jobId, next.id, { phase: 'answering', resolution: 'images', attachmentIds: [], plan: { times: [], reason: '复用冻结历史' }, evidencePlan: p, audit: a, frozen: true });
  await jobs.finish(next.job.jobId, next.id, 'failed', 'network');
  const file = await new IndexedBackupStore(name).export(), dest = crypto.randomUUID(), backup = new IndexedBackupStore(dest);
  const imported = await backup.preview(file); await backup.execute(imported.planId, imported.checksum);
  const other = new IndexedWorkspaceStore(dest), local = (await other.read(ws.id, ws.chatId))!;
  await other.save(ws.id, local.draft.revision, { ...local.draft, text: '本机修改' }, ws.chatId);
  const conflict = await backup.preview(file); await backup.execute(conflict.planId, conflict.checksum);
  const mapped = (value: string) => conflict.mapping.find(m => m.from === value)!.to;
  const copy = (await new IndexedGenerationStore(dest).get(mapped(next.job.jobId)))!.attempts[0].visual!;
  expect(copy.evidencePlan!.evidence[0].reuseAttachmentIds).toEqual([mapped(oldId)]);
  expect(copy.audit!.historyAttachmentIds).toEqual([mapped(oldId)]);
});
