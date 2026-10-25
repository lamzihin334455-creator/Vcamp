// Paid qualification of user-supplied real PNGs through production review and
// final-answer modules. This does not acquire a media lease or capture a video.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {attachmentSchema,type Attachment} from '../../src/contracts/attachment';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import {validateEvidencePlan,type EvidencePlan} from '../../src/contracts/vision';
import {createProviderPort,type ProviderPort} from '../../src/generation/provider-port';
import {allocateVisualPlan,requestTokenBound,visualPolicy} from '../../src/generation/visual-selection';
import {reviewRequest,parseReview} from '../../src/generation/vision-review';
import {runChat} from '../../src/generation/run-chat';
import {fixedPromptVersion} from '../../src/prompts/fixed-rules';
import {purposePolicy} from '../../src/generation/purpose-policy';

export async function runRealImages(directory:string,key:string){
  const ledgerPath=resolve(directory,'call-ledger.json'),ledger=JSON.parse(await readFile(ledgerPath,'utf8'));
  if(![20,30].includes(ledger.authorizedLimit)||!Number.isSafeInteger(ledger.requestsUsed)||ledger.requestsUsed<0||!Array.isArray(ledger.requests))throw Error('invalid-ledger');
  const metadata=[
    {path:resolve(directory,'input-01.png'),time:155,name:'用户手动截图 02:35'},
    {path:resolve(directory,'input-02.png'),time:167,name:'用户手动截图 02:47'}
  ];
  const images:Attachment[]=await Promise.all(metadata.map(async m=>{
    const bytes=await readFile(m.path);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('not-png');
    return attachmentSchema.parse({id:randomUUID(),workspaceId:'manual-user-images',chatId:'manual',mimeType:'image/png',bytes:bytes.length,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),dataUrl:`data:image/png;base64,${bytes.toString('base64')}`,sha256:createHash('sha256').update(bytes).digest('hex'),time:m.time,createdAt:Date.now(),uploadName:m.name,source:{platform:'bilibili',videoId:'BV1SYnz61Enp',partId:'1'}});
  }));
  const snapshot:ChatRequestSnapshot={snapshotId:randomUUID(),target:{kind:'chat',workspaceId:'manual-user-images',chatId:'manual'},input:'请逐张说明这两张用户手动截图展示的设置页、可读选项与可确认的勾选状态。然后用一句话概括两页的区别。只根据实际图片；没有提供完整视频或字幕，读不清的小字请保留不确定，不推断操作效果。',outputType:'chat',modelId:'deepseek-flash',videoTitle:'有了AI，终于不用忍受满是广告的电视界面了',mediaDuration:266.8773333333333,webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:images.map(i=>i.id),visionOnly:true,visionReview:1};
  const plan:EvidencePlan=validateEvidencePlan({version:2,scope:'focused',needsNewFrames:false,evidence:images.map((image,i)=>({id:`e${i+1}`,need:`核对用户第${i+1}张截图的设置页、选项和勾选状态`,priority:'required',mode:'single',reuseAttachmentIds:[image.id],windows:[],detailNeed:'read-text',readTargets:['设置页名称','可读选项','当前勾选状态'],reason:'用户要求核对实际图片'})),unresolved:['仅有用户手动提供的两张离散截图，无法确认操作过程或完整视频内容。']},snapshot.mediaDuration!,[],images.map(i=>i.id));
  const audit=allocateVisualPlan(plan,snapshot,images,'','');
  const request=reviewRequest(snapshot,plan,audit,images,[],snapshot.mediaDuration!,{request:snapshot.input});
  let currentDiagnostic:unknown;
  const port=createProviderPort(key,fetch,undefined,async d=>{currentDiagnostic=d;});
  const provider:ProviderPort={async stream(...args){
    if(ledger.requestsUsed>=ledger.authorizedLimit)throw Error('authorized-call-limit-reached');
    ledger.requestsUsed++;ledger.completionCalls++;
    const entry:Record<string,unknown>={purpose:args[4]??'answer',status:'started',promptVersion:fixedPromptVersion,startedAt:new Date().toISOString()};ledger.requests.push(entry);await writeFile(ledgerPath,JSON.stringify(ledger,null,2));currentDiagnostic=undefined;
    try{await port.stream(...args);entry.status='complete';}catch(error){entry.status='failed';throw error;}
    finally{entry.diagnostic=currentDiagnostic;await writeFile(ledgerPath,JSON.stringify(ledger,null,2));}
  }};
  let reviewText='';const signal=AbortSignal.timeout(60000);
  await provider.stream(snapshot.modelId,request.messages,signal,async d=>{reviewText+=d;},'vision-review');
  await writeFile(resolve(directory,'real-images-review-response.json'),reviewText);
  const review=parseReview(reviewText,request,plan,audit,snapshot.mediaDuration!,[],images.map(i=>i.id));
  const report:Record<string,unknown>={format:'vcamp-real-images-qualification-v1',promptVersion:fixedPromptVersion,scope:'user-supplied-real-PNGs -> production review -> production answer; no video capture or installed-extension UI',images:images.map(({dataUrl,...image})=>image),review,diagnostics:[currentDiagnostic],answerStatus:'not-run'};
  const reportPath=resolve(directory,'real-images-result.json');await writeFile(reportPath,JSON.stringify(report,null,2));
  if(review.status!=='complete')throw Error('real-image-review-did-not-pass');
  const reviewBound=requestTokenBound(request.messages)+purposePolicy['vision-review'].maxTokens;
  let answer='';
  await runChat(snapshot,[],provider,AbortSignal.timeout(60000),async text=>{answer=text;},images,undefined,[],`本次图片由用户手动上传，未由本测试从视频取帧。以下是对实际图片的有限核验，最终仍以图片为准：${JSON.stringify(review.results)}。仅有两张离散图片，无法确认连续操作或完整视频。`,undefined,{history:[],detailById:Object.fromEntries(images.map(i=>[i.id,'original' as const])),tokenAllowance:visualPolicy.tokenCeiling-reviewBound});
  await writeFile(resolve(directory,'real-images-answer.md'),answer);
  Object.assign(report,{answerStatus:'complete',answerChars:answer.length,diagnostics:[...(report.diagnostics as unknown[]),currentDiagnostic],requestsUsed:ledger.requestsUsed});await writeFile(reportPath,JSON.stringify(report,null,2));
  process.stdout.write(`Real image review: ${review.status}; answer: complete; total authorized requests used: ${ledger.requestsUsed}/${ledger.authorizedLimit}\n`);
}
