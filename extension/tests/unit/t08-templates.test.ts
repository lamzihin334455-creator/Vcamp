import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { IndexedTemplateStore } from '../../src/data/template-store';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { runChat } from '../../src/generation/run-chat';
import type { ChatRequestSnapshot, SubtitleBasis } from '../../src/contracts/generation';
import {composerEnterAction} from '../../src/app/composer-policy';

const fields = { name: '复习卡片', description: '概念与问题', requirements: '列出三个复习问题', outputType: 'chat' as const, defaultModelId: 'fixture' };
const source = { platform: 'bilibili' as const, videoId: 'BVtemplates', partId: '1', title: '模板测试' };
const basis: SubtitleBasis = { locator: 'fixture', fingerprint: 'fixture', language: 'zh', cueCount: 1, binding: { ...source, tabId: 1, documentId: 'doc', epoch: 1 } };
test('template edits version all five fields; old selected draft and request/retry keep their version and chosen model', async () => {
  const name = crypto.randomUUID(), templates = new IndexedTemplateStore(name), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  const created = await templates.create(fields);
  const a = await spaces.open(source), target = { kind: 'chat' as const, workspaceId: a.id, chatId: a.chatId };
  await spaces.save(a.id, 0, { ...a.draft, text: '结合视频', template: { templateId: created.id, revisionId: created.revisionId }, modelId: 'manual-model' });
  const edited = await templates.save(created.id, 1, { name: '新版模板', description: '新版说明', requirements: '新版要求', outputType: 'markdown', defaultModelId: 'other-model' });
  expect(edited).toMatchObject({ revision: 2, name: '新版模板', description: '新版说明', requirements: '新版要求', outputType: 'markdown', defaultModelId: 'other-model' });
  expect(await new IndexedTemplateStore(name).revision(created.id, created.revisionId)).toMatchObject(fields);
  expect((await spaces.read(a.id))!.draft).toMatchObject({ template: { revisionId: created.revisionId }, outputType: 'chat', modelId: 'manual-model' });
  const job = await tasks.freezeChat(target, 1, basis);
  expect(job.snapshot).toMatchObject({ templateRevisionId: created.revisionId, templateSnapshot: { ...fields, templateId: created.id, revisionId: created.revisionId }, modelId: 'manual-model', outputType: 'chat' });
  expect((await spaces.read(a.id))!.draft.template).toBeNull();
  await tasks.finish(job.jobId, job.attempts[0].attemptId, 'stopped');
  const retry = await tasks.retry(job.jobId);
  const inputs: unknown[] = [];
  const provider = { async stream(_model: string, messages: unknown) { inputs.push(messages); } };
  for (const snapshot of [job.snapshot, retry.snapshot]) await runChat(snapshot as ChatRequestSnapshot, [{ from: 0, to: 1, content: '完整字幕' }], provider, new AbortController().signal, async () => {});
  expect(inputs[0]).toEqual(inputs[1]); expect(JSON.stringify(inputs[0])).toContain('列出三个复习问题'); expect(JSON.stringify(inputs[0])).not.toContain('新版要求');
  await expect(templates.save(created.id, 1, fields)).rejects.toMatchObject({ code: 'revision-conflict' });
});

test('builtin output is enforced at freeze; current HTML is explicit and legacy HTML never falls back and a forged version is rejected', async () => {
  const name = crypto.randomUUID(), templates = new IndexedTemplateStore(name), spaces = new IndexedWorkspaceStore(name), tasks = new IndexedGenerationStore(name);
  const a = await spaces.open(source), target = { kind: 'chat' as const, workspaceId: a.id, chatId: a.chatId };
  const preset = (await templates.list()).find(row => row.outputType === 'html')!;
  await spaces.save(a.id, 0, { ...a.draft, modelId: 'fixture', template: { templateId: preset.id, revisionId: preset.revisionId } });
  await expect(tasks.freezeChat(target, 1, basis)).rejects.toMatchObject({ code: 'forbidden' });
  let draft = (await spaces.read(a.id))!.draft;
  await spaces.save(a.id, 1, { ...draft, outputType: 'html' });
  const knowledge = await tasks.freezeChat(target, 2, basis);
  expect(knowledge.snapshot).toMatchObject({outputType:'html',htmlFormat:1,templateRevisionId:preset.revisionId});
  expect((await tasks.view(target)).messages[0]).toMatchObject({role:'user',text:'',templateSnapshot:{name:'交互学习页',outputType:'html'}});
  await tasks.finish(knowledge.jobId,knowledge.attempts[0].attemptId,'stopped');
  draft = (await spaces.read(a.id))!.draft;
  await spaces.save(a.id, draft.revision, { ...draft, template: { templateId: 'forged', revisionId: preset.revisionId } });
  await expect(tasks.freezeChat(target, draft.revision+1, basis)).rejects.toMatchObject({ code: 'not-found' });
  const latest=(await spaces.read(a.id))!.draft;
  await spaces.save(a.id,latest.revision,{...latest,template:{templateId:preset.id,revisionId:'builtin-map:v1'},outputType:'html'});
  await expect(tasks.freezeChat(target,latest.revision+1,basis)).rejects.toMatchObject({code:'legacy-knowledge'});
  await expect(templates.save(preset.id, 1, fields)).rejects.toMatchObject({ code: 'revision-conflict' });
});

test('builtins are editable, copies independent, and deletion retains selected historical versions', async () => {
  const store = new IndexedTemplateStore(crypto.randomUUID()), builtin = (await store.list()).find(row => row.id === 'builtin-map')!;
  const edited = await store.save(builtin.id, builtin.revision, { ...fields, outputType: 'html', outputProtocol: 'html-page-v1' });
  expect((await store.list()).filter(row => row.id === builtin.id)).toHaveLength(1);
  expect(edited.revision).toBe(builtin.revision + 1);
  const copy = await store.create(fields);
  await expect(store.delete(builtin.id, builtin.revision)).rejects.toMatchObject({ code: 'revision-conflict' });
  await store.delete(builtin.id, edited.revision);
  expect((await store.list()).some(row => row.id === builtin.id)).toBe(false);
  expect((await store.list()).some(row => row.id === copy.id)).toBe(true);
  expect(await store.revision(builtin.id, builtin.revisionId)).toMatchObject({ requirements: builtin.requirements });
  expect(await store.revision(builtin.id, edited.revisionId)).toMatchObject({ requirements: fields.requirements });
  await expect(store.save(builtin.id, edited.revision, fields)).rejects.toMatchObject({ code: 'not-found' });
});

test('plain Enter submits, while Shift+Enter and IME composition remain text input',()=>{
  expect(composerEnterAction({key:'Enter',shiftKey:false,composing:false,keyCode:13,scribble:false})).toBe('send');
  expect(composerEnterAction({key:'Enter',shiftKey:false,composing:false,keyCode:13,scribble:true})).toBe('save-scribble');
  expect(composerEnterAction({key:'Enter',shiftKey:true,composing:false,keyCode:13,scribble:false})).toBeNull();
  expect(composerEnterAction({key:'Enter',shiftKey:false,composing:true,keyCode:229,scribble:false})).toBeNull();
});
