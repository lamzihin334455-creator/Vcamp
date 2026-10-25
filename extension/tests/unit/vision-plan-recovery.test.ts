import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import {parseEvidenceProposal} from '../../src/generation/vision-plan';
import {visionStageSchema,type EvidencePlan} from '../../src/contracts/vision';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {failureFeedback} from '../../src/workbench/failure-feedback';
import {jobView} from '../../src/contracts/generation';

const cues=[{from:1,to:3,content:'原字幕'}];
const base=():EvidencePlan=>({version:2,scope:'focused',needsNewFrames:true,evidence:[{id:'e1',need:'读取菜单',priority:'required',mode:'single',reuseAttachmentIds:[],detailNeed:'read-text',readTargets:['选项名称'],reason:'字幕定位',windows:[{from:1,to:3,anchor:2,cueIds:[0],basis:'subtitle'}]}],unresolved:[]});
const parse=(p:unknown)=>parseEvidenceProposal(JSON.stringify(p),10,cues,[]);

test('real proposal parser keeps strict valid and historical envelopes without inventing repairs',()=>{
  expect(parse(base())).toEqual({plan:base()});
  expect(parseEvidenceProposal('```json\n'+JSON.stringify(base())+'\n```',10,cues,[])).toEqual({plan:base()});
  expect(parseEvidenceProposal('{"times":[2],"reason":"核对画面"}',10,cues,[])).toMatchObject({plan:{version:2,evidence:[{windows:[{anchor:2}]}]}});
  for(const text of ['{"version":2','说明 '+JSON.stringify(base()),'```json\n{}\n``` trailing'])expect(parseEvidenceProposal(text,10,cues,[])).toMatchObject({failure:{code:'invalid-json',fields:[],syntax:{kind:expect.stringMatching(/^(syntax|unexpected-end)$/)}}});
  for(const value of [null,[],12,{},'plan'])expect(parse(value)).toEqual({failure:{code:'invalid-schema',fields:[]}});
  expect(parse({...base(),version:'2'})).toEqual({failure:{code:'unsupported-version',fields:['version']}});
  const noFrames={version:2,scope:'focused',needsNewFrames:false,evidence:[],unresolved:[]};
  expect(parse(noFrames)).toEqual({plan:noFrames});
});

test('native JSON syntax locations retain only numbers and fixed causes, with no guessed repair',()=>{
  const text='{\n"version":2,\n"PRIVATE_KEY":"PRIVATE_VALUE",\n}';
  const result=parseEvidenceProposal('```json\n'+text+'\n```',10,cues,[]);
  expect(result).toEqual({failure:{code:'invalid-json',fields:[],syntax:{kind:'syntax',offset:text.length-1,line:4,column:1}}});
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|Expected|Unexpected|JSON at/);
  expect(parseEvidenceProposal('{',10,cues,[])).toMatchObject({failure:{code:'invalid-json'}});
  expect(parseEvidenceProposal('{"version":2,"scope":"focused","needsNewFrames":false,"evidence":[],"unresolved":[],}',10,cues,[])).toMatchObject({failure:{code:'invalid-json'}});
});

test('structural diagnostics report allowlisted paths without model text, unknown keys or Zod messages',()=>{
  const p=base() as any;p.evidence[0].readTargets=null;p.evidence[0].PRIVATE_INJECTED_KEY='PRIVATE_VALUE';
  const result=parse(p);
  expect(result).toEqual({failure:{code:'invalid-schema',fields:['evidence.0.readTargets','evidence.0']}});
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|Unrecognized|received|expected/);
  const long=base();long.evidence[0].need='私'.repeat(181);
  expect(parse(long)).toEqual({failure:{code:'invalid-schema',fields:['evidence.0.need']}});
});

test('semantic diagnostics distinguish references, windows, group counts and frame flags',()=>{
  const variants:[string,(p:EvidencePlan)=>void,string[]][]=[
    ['invalid-cue',p=>{p.evidence[0].windows[0].cueIds=[99];},['evidence.0.windows.0.cueIds']],
    ['invalid-cue',p=>{p.evidence[0].windows[0]={from:4,to:6,anchor:5,cueIds:[0],basis:'subtitle'};},['evidence.0.windows.0.cueIds']],
    ['invalid-cue',p=>{p.evidence[0].windows[0].cueIds=[0,0];},['evidence.0.windows.0.cueIds']],
    ['invalid-window',p=>{p.evidence[0].windows[0].to=10;},['evidence.0.windows.0']],
    ['invalid-window',p=>{p.evidence[0].windows[0].anchor=4;},['evidence.0.windows.0']],
    ['invalid-group',p=>{p.evidence[0].mode='pair';},['evidence.0.mode','evidence.0.windows','evidence.0.reuseAttachmentIds']],
    ['invalid-reuse',p=>{p.evidence[0].reuseAttachmentIds=[crypto.randomUUID()];p.evidence[0].windows=[];p.needsNewFrames=false;},['evidence.0.reuseAttachmentIds']],
    ['duplicate-id',p=>{p.evidence.push(structuredClone(p.evidence[0]));},['evidence']],
    ['inconsistent-flags',p=>{p.needsNewFrames=false;},['needsNewFrames','evidence.0.windows']]
  ];
  for(const [code,change,fields] of variants){const p=base();change(p);expect(parse(p)).toEqual({failure:{code,fields}});}
});

test('planning recovery persists through decision, frozen retry and backup without enabling capture',async()=>{
  const name=crypto.randomUUID(),spaces=new IndexedWorkspaceStore(name),jobs=new IndexedGenerationStore(name);
  const ws=await spaces.open({platform:'bilibili',videoId:'BVrecovery',partId:'1',title:'测试'});
  const draft=(await spaces.read(ws.id,ws.chatId))!.draft;
  await spaces.save(ws.id,draft.revision,{...draft,text:'查看画面',modelId:'fixture'},ws.chatId);
  const job=await jobs.freezeChat({kind:'chat',workspaceId:ws.id,chatId:ws.chatId},draft.revision+1,{binding:{platform:'bilibili',videoId:'BVrecovery',partId:'1',tabId:1,documentId:'doc',epoch:1},locator:'original',fingerprint:'original',language:'zh',cueCount:1,mediaDuration:10},true,true);
  const id=job.attempts[0].attemptId;await jobs.attach(job.jobId,id,5);await jobs.claim(job.jobId,id,5);
  const stage=visionStageSchema.parse({phase:'permission',issue:'plan',attachmentIds:[],planningFailure:{code:'invalid-json',fields:[],syntax:{kind:'syntax',offset:41,line:3,column:2}},planningCorrection:{firstFailure:{code:'invalid-schema',fields:['unresolved']},outcome:'failed'},planningTokensUpperBound:12345});
  await jobs.visual(job.jobId,id,stage);
  await expect(jobs.decideVisual(job.jobId,'images')).rejects.toMatchObject({code:'unsupported-capability'});
  const chosen=await jobs.decideVisual(job.jobId,'subtitle');
  const frozen={...chosen.attempts[0].visual!,phase:'answering' as const,frozen:true};
  await jobs.visual(job.jobId,id,frozen);await jobs.finish(job.jobId,id,'failed','network');
  expect((await jobs.retry(job.jobId)).attempts[1].visual).toEqual(frozen);
  const file=await new IndexedBackupStore(name).export(),dest=crypto.randomUUID(),backup=new IndexedBackupStore(dest);
  const preview=await backup.preview(file);await backup.execute(preview.planId,preview.checksum);
  expect((await new IndexedGenerationStore(dest).get(job.jobId))!.attempts[0].visual).toEqual(frozen);
  const feedback=JSON.parse(failureFeedback(jobView((await jobs.get(job.jobId))!),'test'));
  expect(feedback.visual).toMatchObject({planningCorrection:stage.planningCorrection,planningTokensUpperBound:12345});expect(JSON.stringify(feedback)).not.toContain('查看画面');
});
