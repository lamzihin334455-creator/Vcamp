// Test-only semantic migration material. This is not a claim of live capture.
import {seedBackup} from '../fixtures/t20-semantic';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedAttachmentStore} from '../../src/data/attachment-store';
const spaces=new IndexedWorkspaceStore(),tasks=new IndexedGenerationStore(),images=new IndexedAttachmentStore();
const frame=(time:number)=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=12;const c=canvas.getContext('2d')!;c.fillStyle=time?'#248f62':'#ca3020';c.fillRect(0,0,16,12);return {dataUrl:canvas.toDataURL('image/png'),width:16,height:12,time};};
const proof={
 seed:seedBackup,
 async images(workspaceId:string,chatId:string){
  const a=(await spaces.read(workspaceId,chatId))!;
  const binding={platform:a.source.platform,videoId:a.source.videoId,partId:a.source.partId,tabId:77,documentId:'t22-synthetic-document',epoch:1};
  const manual=await images.add({workspaceId,chatId},binding,a.draft.revision,frame(0));
  const auto=await spaces.createChat(workspaceId);
  await spaces.save(workspaceId,auto.draft.revision,{...auto.draft,text:'T22 已冻结自主PNG迁移样本',modelId:'synthetic-a'},auto.chatId);
  // Preserve the existing selected analysis identity in this semantic record.
  const {IndexedSubtitleStore}=await import('../../src/data/subtitle-store');const subs=new IndexedSubtitleStore();const selected=await subs.query(workspaceId);
  const basis={binding,locator:'t22-semantic',fingerprint:'t22-semantic',language:'zh',cueCount:1,...(selected.analysisSource.kind==='enhanced'?{subtitleVersionId:selected.analysisSource.versionId}:{})};
  const job=await tasks.freezeChat({kind:'chat',workspaceId,chatId:auto.chatId},auto.draft.revision+1,basis,true,true),attempt=job.attempts[0].attemptId;
  await tasks.attach(job.jobId,attempt,77);await tasks.claim(job.jobId,attempt,77);
  const captured=await tasks.visual(job.jobId,attempt,{phase:'capturing',plan:{times:[1],reason:'迁移用合成PNG，不是本轮实站取帧'},attachmentIds:[],resolution:'images'},frame(1));
  const frozen=await tasks.visual(job.jobId,attempt,{...captured.attempts[0].visual!,phase:'answering',frozen:true});
  await tasks.checkpoint(job.jobId,attempt,frozen.seq+1,'T22 自主PNG已保存；仅迁移验证',{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});
  await tasks.finish(job.jobId,attempt,'completed',null,crypto.randomUUID());
  await spaces.selectChat(workspaceId,chatId);
  return {manual,automaticId:captured.attempts[0].visual!.attachmentIds[0],automaticJobId:job.jobId,automaticChatId:auto.chatId};
 },
 async searching(workspaceId:string){
  const a=await spaces.createChat(workspaceId),binding={platform:a.source.platform,videoId:a.source.videoId,partId:a.source.partId,tabId:77,documentId:'t22-synthetic-document',epoch:1};
  await spaces.save(workspaceId,a.draft.revision,{...a.draft,text:'T22 导入中断检索',modelId:'synthetic-a',webEnabled:true},a.chatId);
  const {IndexedSubtitleStore}=await import('../../src/data/subtitle-store');const selected=await new IndexedSubtitleStore().query(workspaceId);
  const job=await tasks.freezeChat({kind:'chat',workspaceId,chatId:a.chatId},a.draft.revision+1,{binding,locator:'t22-semantic',fingerprint:'t22-semantic',language:'zh',cueCount:1,...(selected.analysisSource.kind==='enhanced'?{subtitleVersionId:selected.analysisSource.versionId}:{})});
  const attempt=job.attempts[0].attemptId;await tasks.attach(job.jobId,attempt,77);await tasks.claim(job.jobId,attempt,77);
  await tasks.webEvidence(job.jobId,attempt,{version:1,status:'searching',retrievedAt:new Date().toISOString(),executionLinked:false,sources:[],references:[],excludedSources:0,usage:{}});
  return {jobId:job.jobId,chatId:a.chatId,attemptId:attempt};
 }
};
(window as unknown as {t22Proof:typeof proof}).t22Proof=proof;
