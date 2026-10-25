import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { runSubtitle } from '../../src/generation/run-subtitle';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { generationCommandSchema, type SubtitleRequestSnapshot } from '../../src/contracts/generation';
import type { ProviderMessage } from '../../src/generation/provider-port';
import {subtitleBasis} from '../../src/generation/subtitle-context';

test('translation processes every segment without summaries, atomically saves a typed independent version and keeps native text out of persistent jobs', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'translate', partId: '1', title: '翻译' }, a = await spaces.open(source);
  await spaces.removeChat(a.id, a.chatId);
  const cues = Array.from({ length: 45 }, (_, i) => ({ from: i * 2, to: i * 2 + 1, content: `原生秘密 ${i}` }));
  const snapshot: SubtitleRequestSnapshot = { snapshotId: crypto.randomUUID(), target: { kind: 'subtitle', workspaceId: a.id, operation: 'translate' }, source: { locator: 'source', fingerprint: 'native-fixture' }, targetLanguage: 'en', requirements: '', modelId: 'fixture' };
  const basis = { locator: 'source', fingerprint: 'native-fixture', language: 'zh', cueCount: 45, binding: { ...source, tabId: 1, documentId: 'doc', epoch: 1 } };
  const job = await tasks.freezeSubtitle(snapshot, basis), attemptId = job.attempts[0].attemptId;
  await tasks.attach(job.jobId, attemptId, 1); let seq = (await tasks.claim(job.jobId, attemptId, 1))!.seq;
  const requests: readonly ProviderMessage[][] = [];
  const seen: number[] = [];
  const translated = await runSubtitle(snapshot, cues, { async stream(_model, messages, _signal, delta) {
    (requests as ProviderMessage[][]).push([...messages]);
    const payload = JSON.parse(messages.at(-1)!.content as string);
    seen.push(...payload.cues.map((cue: { index: number }) => cue.index));
    await delta(JSON.stringify({ cues: payload.cues.map((cue: { index: number; from: number; to: number }) => ({ ...cue, content: `Translated ${cue.index}` })) }));
  } }, new AbortController().signal, async (text, coverage) => { seq = (await tasks.checkpoint(job.jobId, attemptId, seq + 1, text, coverage)).seq; });
  expect(seen).toEqual(Array.from({ length: 45 }, (_, i) => i)); expect(requests.length).toBeGreaterThan(1);
  await tasks.finish(job.jobId, attemptId, 'completed', null, 'version-one', { kind: 'subtitle', cues: translated });
  await tasks.finish(job.jobId, attemptId, 'completed', null, 'version-two', { kind: 'subtitle', cues: translated });
  expect(await tasks.subtitleVersions(a.id)).toMatchObject([{ id: 'version-one', workspaceId: a.id, language: 'en', type: 'translate', sourceFingerprint: 'native-fixture', alignment: 'exact' }]);
  expect((await tasks.subtitleVersions(a.id))[0].cues).toHaveLength(45); expect((await tasks.subtitleVersions(a.id))[0].cues[0]).toEqual({ from: 0, to: 1, content: 'Translated 0' });
  expect((await tasks.view(snapshot.target)).messages).toEqual([]);
  expect(await spaces.emptySpace(a.id)).toMatchObject({ id: a.id });
  expect(JSON.stringify(await tasks.list())).not.toContain('原生秘密');
});

test('no Chat subtitle command shares the real queue, allows a parallel Chat, and cancels only the queued job', async () => {
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  const source = { platform: 'bilibili' as const, videoId: 'queue', partId: '1', title: 'queue' }, a = await spaces.open(source);
  await spaces.removeChat(a.id, a.chatId);
  const binding = { platform: source.platform, videoId: source.videoId, partId: source.partId, tabId: 1, documentId: 'doc', epoch: 1 };
  const { createTaskService } = await import('../../src/generation/task-service');
  const opened = new Set<number>(); let serial = 10;
  const service = createTaskService(tasks, spaces, { async command() { return { providerId: 'deepseek', revision: 1, hasKey: true, models: [{ id: 'fixture', name: 'Fixture', text: 'declared', vision: 'unknown', web: 'unknown' }], defaultModelId: 'fixture', status: 'ready' }; } }, async () => ({ binding, status: 'ready', language: 'zh', cues: [{ from: 0, to: 1, content: '原文' }] }), { async create() { const id = ++serial; opened.add(id); return id; }, async navigate() {}, async exists(id) { return opened.has(id); }, async close(id) { opened.delete(id); } }, 'extension', () => {}, new (await import('../../src/data/subtitle-store')).IndexedSubtitleStore(name));
  const command = (language: string) => generationCommandSchema.parse({ type: 'generation.subtitle.send', target: { kind: 'subtitle', workspaceId: a.id, operation: 'translate' }, binding, targetLanguage: language, requirements: '', modelId: 'fixture' });
  const first = await service.command(command('en'));
  expect(first.messages).toEqual([]); expect(first.jobs[0].state).toBe('preparing');
  const second = await service.command(command('ja'));
  const queued = second.jobs.find(job => job.state === 'queued')!;
  expect(queued).toBeDefined(); expect(opened.size).toBe(1);
  const chat = await spaces.createChat(a.id);
  await spaces.save(a.id, 0, { ...chat.draft, text: '并行问题', modelId: 'fixture' });
  const chatView = await service.command({ type: 'generation.send', target: { kind: 'chat', workspaceId: a.id, chatId: chat.chatId }, expectedRevision: 1, binding });
  expect(chatView.jobs[0].state).toBe('preparing'); expect(opened.size).toBe(2);
  await service.command({ type: 'generation.stop', jobId: queued.jobId });
  expect((await tasks.view(first.target)).jobs.find(job => job.jobId === queued.jobId)?.state).toBe('stopped');
  expect((await tasks.get(first.jobs[0].jobId))!.attempts[0].state).toBe('preparing'); expect((await tasks.view(chatView.target)).jobs[0].state).toBe('preparing');
  expect(await tasks.subtitleVersions(a.id)).toEqual([]);
});


test('missing, reordered, shifted and truncated structured results fail without committing partial versions', async () => {
  const cues = [{ from: 0, to: 1, content: 'secret first' }, { from: 1, to: 2, content: 'secret last' }];
  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  const space = await spaces.open({ platform: 'bilibili', videoId: 'format', partId: '1', title: 'format' });
  const binding = { platform: 'bilibili' as const, videoId: 'format', partId: '1', tabId: 1, documentId: 'doc', epoch: 1 };
  const basis = await (await import('../../src/generation/subtitle-context')).subtitleBasis(binding, 'zh', cues);
  const snapshot: SubtitleRequestSnapshot = { snapshotId: crypto.randomUUID(), target: { kind: 'subtitle', workspaceId: space.id, operation: 'translate' }, source: { locator: basis.locator, fingerprint: basis.fingerprint }, targetLanguage: 'en', requirements: '', modelId: 'fixture' };
  const rows = cues.map((cue, index) => ({ ...cue, index, content: `translated ${index}` }));
  for (const text of [JSON.stringify({ cues: rows.slice(0, 1) }), JSON.stringify({ cues: [...rows].reverse() }), JSON.stringify({ cues: rows.map(row => ({ ...row, from: row.from + 1 })) }), '{"cues":[']) {
    const job = await tasks.freezeSubtitle(snapshot, basis), id = job.attempts[0].attemptId;
    await tasks.attach(job.jobId, id, 1); let seq = (await tasks.claim(job.jobId, id, 1))!.seq;
    await expect(runSubtitle(snapshot, cues, { async stream(_model, _messages, _signal, delta) { await delta(text); } }, new AbortController().signal, async (value, coverage) => { seq = (await tasks.checkpoint(job.jobId, id, seq + 1, value, coverage)).seq; })).rejects.toMatchObject({ code: 'protocol' });
    await tasks.finish(job.jobId, id, 'failed', 'protocol');
    expect(await tasks.subtitleVersions(space.id)).toEqual([]);
  }
  const job = await tasks.freezeSubtitle(snapshot, basis), id = job.attempts[0].attemptId;
  await tasks.attach(job.jobId, id, 1); const claimed = (await tasks.claim(job.jobId, id, 1))!;
  await tasks.checkpoint(job.jobId, id, claimed.seq + 1, '', { total: 1, covered: 1, ranges: [{ firstCue: 0, lastCue: 1 }] });
  await expect(tasks.finish(job.jobId, id, 'completed', null, 'bad-receipt', { kind: 'subtitle', cues: cues.map(cue => ({ ...cue, from: cue.from + .1 })) })).rejects.toMatchObject({ code: 'invalid-message' });
  expect(await tasks.subtitleVersions(space.id)).toEqual([]); expect((await tasks.get(job.jobId))!.attempts[0].state).toBe('running');
  await tasks.finish(job.jobId, id, 'stopped');
  expect(await tasks.subtitleVersions(space.id)).toEqual([]); expect(JSON.stringify(await tasks.list())).not.toContain('secret first');
});

test('subtitle correction requests only necessary edits and merges sparse changes locally', async () => {
  const cues = [
    { from: 0, to: 1, content: '保持原句' },
    { from: 1, to: 2, content: 'chat gbt突然火到出圈' },
    { from: 2, to: 3, content: 'Web coding' },
    { from: 3, to: 4, content: '配置好mini max的API' },
    { from: 4, to: 5, content: '埃隆马斯科介绍了产品' }
  ];
  const snapshot: SubtitleRequestSnapshot = {
    snapshotId: crypto.randomUUID(),
    target: { kind: 'subtitle', workspaceId: 'correction', operation: 'enhance' },
    source: { locator: 'source', fingerprint: 'fingerprint' },
    targetLanguage: null,
    requirements: '',
    modelId: 'fixture'
  };
  let prompt = '';
  const corrected = await runSubtitle(snapshot, cues, {
    async stream(_model, messages, _signal, delta) {
      prompt = messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n');
      await delta(JSON.stringify({ changes: [
        { index: 0, content: '保持原句。' },
        { index: 1, content: 'ChatGPT突然火到出圈' },
        { index: 2, content: 'Web Coding' },
        { index: 3, content: '配置好 MiniMax 的 API' },
        { index: 4, content: '埃隆·马斯克介绍了产品' }
      ] }));
    }
  }, new AbortController().signal, async () => {});
  expect(prompt).toContain('只返回确实需要修改的段落');
  expect(prompt).toContain('ASR');
  expect(prompt).toContain('专有名词');
  expect(prompt).toContain('人名');
  expect(prompt).toContain('标点、空格和大小写不重要');
  expect(corrected).toEqual([
    cues[0],
    { from: 1, to: 2, content: 'ChatGPT突然火到出圈' },
    cues[2],
    cues[3],
    { from: 4, to: 5, content: '埃隆·马斯克介绍了产品' }
  ]);
});

test('a completed AI subtitle correction becomes the main subtitle and every later artifact request freezes that corrected version',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),tasks=new IndexedGenerationStore(name);
  const source={platform:'bilibili' as const,videoId:'correct-main',partId:'1',title:'修正后主字幕'},a=await spaces.open(source);
  const binding={...source,tabId:1,documentId:'doc',epoch:1};
  const original=[{from:0,to:1,content:'chat gbt'},{from:1,to:2,content:'埃隆马斯科'}];
  const corrected=[{from:0,to:1,content:'ChatGPT'},{from:1,to:2,content:'埃隆·马斯克'}];
  const nativeBasis=await subtitleBasis(binding,'zh',original);
  const snapshot:SubtitleRequestSnapshot={snapshotId:crypto.randomUUID(),target:{kind:'subtitle',workspaceId:a.id,operation:'enhance'},source:{locator:nativeBasis.locator,fingerprint:nativeBasis.fingerprint},targetLanguage:null,requirements:'',modelId:'fixture'};
  const correction=await tasks.freezeSubtitle(snapshot,nativeBasis),attempt=correction.attempts[0].attemptId;
  await tasks.attach(correction.jobId,attempt,1);const claimed=(await tasks.claim(correction.jobId,attempt,1))!;
  await tasks.checkpoint(correction.jobId,attempt,claimed.seq+1,'',{total:1,covered:1,ranges:[{firstCue:0,lastCue:1}]});
  await tasks.finish(correction.jobId,attempt,'completed',null,'enhanced-main',{kind:'subtitle',cues:corrected});
  expect(await tasks.subtitleStore.query(a.id)).toMatchObject({analysisSource:{kind:'version',versionId:'enhanced-main'},sourceRevision:1,sourceValid:true});
  await expect(tasks.subtitleStore.select(a.id,0,{kind:'enhanced',versionId:'enhanced-main'})).resolves.toBeUndefined();
  expect((await tasks.subtitleStore.query(a.id)).sourceRevision).toBe(1);
  const selectedBasis={...await subtitleBasis(binding,'zh',corrected),subtitleVersionId:'enhanced-main'};
  for(const outputType of ['chat','markdown','html'] as const){
    const current=(await spaces.read(a.id,a.chatId))!;
    await spaces.save(a.id,current.draft.revision,{...current.draft,text:`生成${outputType}`,outputType,modelId:'fixture'},a.chatId);
    const job=await tasks.freezeChat({kind:'chat',workspaceId:a.id,chatId:a.chatId},current.draft.revision+1,selectedBasis);
    expect(job.basis.subtitleVersionId).toBe('enhanced-main');
    expect(job.snapshot).toMatchObject({analysisSource:{kind:'version',versionId:'enhanced-main',fingerprint:selectedBasis.fingerprint}});
    await tasks.finish(job.jobId,job.attempts[0].attemptId,'stopped');
  }
});
