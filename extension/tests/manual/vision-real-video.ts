import {visualEvidenceNote} from '../../src/generation/visual-evidence-note';
// Independent real-media qualification. Uses a locally downloaded public
// stream in a fresh browser, not the user's browser/profile or installed UI.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import type {Attachment} from '../../src/contracts/attachment';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import {validateEvidencePlan,validateVisionAudit} from '../../src/contracts/vision';
import {validateImage} from '../../src/data/image-validation';
import {parseEvidenceProposal} from '../../src/generation/vision-plan';
import {visionPlanningInput} from '../../src/generation/vision-planning';
import {createProviderPort,type ProviderPort} from '../../src/generation/provider-port';
import {allocateVisualPlan,requestTokenBound,visualPolicy} from '../../src/generation/visual-selection';
import {captureEvidence} from '../../src/generation/capture-evidence';
import {reviewRequest,parseReview} from '../../src/generation/vision-review';
import {reviewVisualEvidence} from '../../src/generation/vision-reviewing';
import {runChat} from '../../src/generation/run-chat';
import {fixedPrompt,fixedPromptVersion} from '../../src/prompts/fixed-rules';
import {purposePolicy} from '../../src/generation/purpose-policy';

export async function runRealVideo(directory:string,key:string,resume=false,options?:{planResponse:string;outputDirectory:string}){
  const out=options?.outputDirectory??resolve(directory,'real-video');await mkdir(out,{recursive:true});
  const input=JSON.parse((await readFile(resolve(directory,'input.json'),'utf8')).replace(/^\uFEFF/,''));
  // Freeze a previously accepted actual model proposal, not a hand-picked time
  // list. Includes three required pages and a two-state optional comparison.
  const sourceReply=await readFile(options?.planResponse??resolve(directory,'response-22.txt'),'utf8');
  const parsed=parseEvidenceProposal(sourceReply,input.duration,input.cues,[]);
  if(!('plan' in parsed))throw Error('accepted-plan-no-longer-valid');
  const plan=validateEvidencePlan(parsed.plan,input.duration,input.cues,[]);
  process.stdout.write('Real video: accepted proposal loaded\n');
  const snapshot:ChatRequestSnapshot={snapshotId:randomUUID(),target:{kind:'chat',workspaceId:'manual-real-video',chatId:'manual'},input:input.task.template.requirements,outputType:'chat',modelId:input.modelId,videoTitle:input.task.videoTitle,mediaDuration:input.duration,webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[],visionReview:1};
  const planningText=visionPlanningInput(input.task,input.cues),system=fixedPrompt({kind:'vision-plan',duration:input.duration,maxFrames:6,preauthorized:true});
  const planningBound=requestTokenBound([{role:'system',content:system},{role:'user',content:planningText}])+purposePolicy['vision-plan'].maxTokens;
  let audit=allocateVisualPlan(plan,snapshot,[],system+planningText,JSON.stringify(snapshot)+input.cues.map((c:any)=>c.content).join('\n'));
  audit.budget.maxCaptures=12;
  const images:Attachment[]=[];
  let mediaMetadata:unknown;
  if(resume){
    const saved=JSON.parse(await readFile(resolve(out,'capture.json'),'utf8'));audit=saved.audit;mediaMetadata=saved.mediaMetadata;
    for(const meta of saved.images){const slot=audit.frames.find(f=>f.attachmentId===meta.id)!;const bytes=await readFile(resolve(out,`${slot.slotKey}.png`));const image={...meta,dataUrl:`data:image/png;base64,${bytes.toString('base64')}`};await validateImage(image);images.push(image);}
  }else{
  const media=await readFile(resolve(directory,'public-video-480p.mp4'));
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const page=await browser.newPage();
    await page.route('**/*',async route=>{const url=route.request().url();if(url==='http://vcamp-local.test/video.mp4'){
      const range=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range??'');
      if(range){const start=Number(range[1]),end=range[2]?Math.min(media.length-1,Number(range[2])):media.length-1;return route.fulfill({status:206,body:media.subarray(start,end+1),contentType:'video/mp4',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${media.length}`}});}
      return route.fulfill({body:media,contentType:'video/mp4',headers:{'accept-ranges':'bytes'}});
    }if(url==='http://vcamp-local.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><video src="/video.mp4" preload="auto"></video>'});return route.abort();});
    await page.goto('http://vcamp-local.test/');await page.locator('video').evaluate(async(v:HTMLVideoElement)=>{if(v.readyState<2)await new Promise<void>(resolve=>v.addEventListener('loadeddata',()=>resolve(),{once:true}));});
    mediaMetadata=await page.locator('video').evaluate((v:HTMLVideoElement)=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration}));
    audit=await captureEvidence(plan,audit,async(time,detail)=>page.locator('video').evaluate(async(v:HTMLVideoElement,{time,detail})=>{
      v.pause();if(Math.abs(v.currentTime-time)>.0001){v.currentTime=time;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('local-seek-timeout')),5000);v.addEventListener('seeked',()=>{clearTimeout(timer);resolve();},{once:true});});}
      if(v.readyState<2||Math.abs(v.currentTime-time)>.01)throw Error(`local-media-not-ready:${v.readyState},${v.currentTime},${time}`);
      const canvas=document.createElement('canvas'),scale=Math.min(1,(detail==='low'?768:1920)/v.videoWidth);canvas.width=Math.floor(v.videoWidth*scale);canvas.height=Math.floor(v.videoHeight*scale);
      const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(v,0,0,canvas.width,canvas.height);
      const small=document.createElement('canvas');small.width=64;small.height=36;const context=small.getContext('2d',{willReadFrequently:true})!;context.drawImage(canvas,0,0,64,36);
      const thumbnail=context.getImageData(0,0,64,36).data,luma:number[]=[];for(let i=0;i<thumbnail.length;i+=4)luma.push(Math.round(.299*thumbnail[i]+.587*thumbnail[i+1]+.114*thumbnail[i+2]));
      small.width=256;small.height=144;context.drawImage(canvas,0,0,256,144);const rgba=context.getImageData(0,0,256,144).data,gray:number[]=[];for(let i=0;i<rgba.length;i+=4)gray.push(Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]));
      const mean=gray.reduce((n,x)=>n+x,0)/gray.length;let edges=0;for(let y=1;y<143;y++)for(let x=1;x<255;x++){const i=y*256+x;edges+=Math.abs(4*gray[i]-gray[i-1]-gray[i+1]-gray[i-256]-gray[i+256]);}
      return {time:v.currentTime,width:canvas.width,height:canvas.height,dataUrl:canvas.toDataURL('image/png'),sample:{luma,sharpness:edges/(142*254),contrast:Math.sqrt(gray.reduce((n,x)=>n+(x-mean)**2,0)/gray.length)}};
    },{time,detail}),async(frame,slot,a)=>{
      const measured=await validateImage(frame),image:Attachment={...frame,...measured,id:randomUUID(),workspaceId:snapshot.target.workspaceId,chatId:snapshot.target.chatId,mimeType:'image/png',createdAt:Date.now(),source:{platform:'bilibili',videoId:'BV1N6ph6dEec',partId:'1'}};
      images.push(image);a.frames.push({slotKey:slot.key,attachmentId:image.id,time:image.time,detail:slot.detail});await writeFile(resolve(out,`${slot.key}.png`),Buffer.from(frame.dataUrl.slice(22),'base64'));return a;
    },async()=>{},AbortSignal.timeout(45000));
  }finally{await browser.close();}
  }
  audit.budget.maxCaptures=18;validateVisionAudit(audit,plan,images.map(i=>i.id),input.duration,[]);
  await writeFile(resolve(out,'capture.json'),JSON.stringify({promptVersion:fixedPromptVersion,acceptedPlanFromRequest:options?'current workflow plan':22,mediaMetadata,plan,audit,images:images.map(({dataUrl,...i})=>i),scope:'public 480p stream in an independent local browser; canvas adapter + production selection/PNG validation; not installed-extension capture'},null,2));
  if(images.length!==audit.slots.length||!images.length)throw Error('incomplete-real-capture');
  const ledgerPath=resolve(directory,'call-ledger.json'),ledger=JSON.parse((await readFile(ledgerPath,'utf8')).replace(/^\uFEFF/,''));
  if(ledger.authorizedLimit!==59||ledger.currentBatch?.additionalLimit!==30||ledger.currentBatch?.startRequestsUsed!==29||!Number.isSafeInteger(ledger.requestsUsed)||ledger.requestsUsed>59)throw Error('invalid-ledger');
  let diagnostic:unknown;
  const port=createProviderPort(key,fetch,undefined,async d=>{diagnostic=d;});
  const provider:ProviderPort={async stream(...args){if(ledger.requestsUsed>=ledger.authorizedLimit)throw Error('authorized-call-limit');ledger.requestsUsed++;ledger.completionCalls++;const entry:Record<string,unknown>={purpose:args[4],status:'started',scope:'real-video-independent',startedAt:new Date().toISOString(),promptVersion:fixedPromptVersion};ledger.requests.push(entry);await writeFile(ledgerPath,JSON.stringify(ledger,null,2));diagnostic=undefined;try{await port.stream(...args);entry.status='complete';}catch(error){entry.status='failed';throw error;}finally{entry.diagnostic=diagnostic;await writeFile(ledgerPath,JSON.stringify(ledger,null,2));}}};
  const request=reviewRequest(snapshot,plan,audit,images,input.cues,input.duration,input.task);let reviewBound=requestTokenBound(request.messages)+purposePolicy['vision-review'].maxTokens;
  if(audit.budget.apiTokensUpperBound+reviewBound>visualPolicy.tokenCeiling)throw Error('review-budget');
  let raw='';if(resume){raw=await readFile(resolve(out,'review-response.json'),'utf8');diagnostic=JSON.parse(await readFile(resolve(out,'result.json'),'utf8')).reviewDiagnostic;}
  const rejected:string[]=[];
  const checked=resume?undefined:await reviewVisualEvidence({provider,modelId:input.modelId,request,plan,audit,duration:input.duration,cues:input.cues,imageIds:[],signal:AbortSignal.timeout(60000),tokenAllowance:visualPolicy.tokenCeiling-audit.budget.apiTokensUpperBound,onInvalid:async output=>{rejected.push(output);await writeFile(resolve(out,'rejected-reviews.json'),JSON.stringify(rejected,null,2));}});
  const review=checked?.review??parseReview(raw,request,plan,audit,input.duration,input.cues,[]);reviewBound=checked?.tokenBound??reviewBound;
  await writeFile(resolve(out,'accepted-review.json'),JSON.stringify(review,null,2));
  // No second media round in this test: retain any gaps explicitly, rather
  // than claiming a proposed repair was captured or independently verified.
  review.repairs.forEach(r=>{r.state='declined';});
  const report:Record<string,unknown>={promptVersion:fixedPromptVersion,mediaMetadata,realImages:images.length,review,reviewDiagnostic:diagnostic,answerStatus:'not-run',scope:'actual video + real subtitles + real API; independent capture adapter, no installed-extension UI, no web search'};
  await writeFile(resolve(out,'result.json'),JSON.stringify(report,null,2));
  let answer='';await runChat(snapshot,input.cues,provider,AbortSignal.timeout(60000),async text=>{answer=text;},images,undefined,images.map(i=>i.id),visualEvidenceNote({phase:'answering',resolution:'images',attachmentIds:images.map(i=>i.id),evidencePlan:plan,audit,review}),undefined,{history:[],detailById:Object.fromEntries(audit.frames.map(f=>[f.attachmentId,f.detail])),tokenAllowance:visualPolicy.tokenCeiling-planningBound-reviewBound});
  await writeFile(resolve(out,'answer.md'),answer);Object.assign(report,{answerStatus:'complete',answerDiagnostic:diagnostic,requestsUsed:ledger.requestsUsed});await writeFile(resolve(out,'result.json'),JSON.stringify(report,null,2));process.stdout.write(`Real video: ${images.length} actual frames; review: ${review.status}; answer: complete; cumulative requests: ${ledger.requestsUsed}/${ledger.authorizedLimit}\n`);
}
