import type {Attachment} from '../contracts/attachment';
import type {ChatRequestSnapshot} from '../contracts/generation';
import type {Cue} from '../contracts/video';
import {validateEvidencePlan,validateVisionReview,visionReviewReplySchema,visionCheckSchema,evidenceChecks,checkedStatus,observationDisclaimsConfirmation,refinementWindows,type EvidencePlan,type VisionAudit,type VisionReview} from '../contracts/vision';
import {fixedPrompt} from '../prompts/fixed-rules';
import type {ProviderMessage} from './provider-port';
import {captureEvidence,type SampledFrame} from './capture-evidence';
import {frameBytes,visualPolicy,evidenceDetail} from './visual-selection';
import {z} from 'zod';

// Compact wire proposals let the host calculate subtitle times. Stored reviews
// remain version 1 and retain every existing reference/consistency check.
const cueRefinement=z.object({slotKey:z.string(),cueIds:z.array(z.number().int().nonnegative()).min(1).max(8),anchorCueId:z.number().int().nonnegative().optional()}).strict();
const compactReply=z.object({version:z.literal(2),results:z.array(visionReviewReplySchema.shape.results.element.omit({refinements:true}).extend({refinements:z.array(cueRefinement).max(2).default([])}).strict()).min(1).max(8)}).strict();
const checkedReply=z.object({version:z.literal(3),results:z.array(z.object({evidenceId:z.string(),checks:z.array(visionCheckSchema.omit({target:true})).min(1).max(4),refinements:z.array(cueRefinement.extend({checkIds:z.array(z.string()).min(1).max(4),reason:z.string().trim().min(1).max(120)}).strict()).max(2).default([])}).strict()).min(1).max(8)}).strict();

export function reviewRange(slot:{from:number;to:number},duration:number){
  const reach=Math.max(3,slot.to-slot.from);
  return {from:Math.max(0,slot.from-reach),to:Math.min(duration-.001,slot.to+reach)};
}

export function reviewRequest(snapshot:ChatRequestSnapshot,plan:EvidencePlan,audit:VisionAudit,images:readonly Attachment[],cues:readonly Cue[],duration:number,task:unknown){
  const important=plan.evidence.filter(e=>e.priority==='required'||evidenceDetail(e).detail==='original'||e.mode!=='single');
  const selected:Attachment[]=[],records:VisionReview['images']=[];
  const targets=important.flatMap(e=>{
    const own=audit.frames.filter(f=>audit.slots.find(s=>s.key===f.slotKey)?.evidenceIds.includes(e.id));
    const ids=[...new Set([...own.map(f=>f.attachmentId),...e.reuseAttachmentIds.filter(id=>audit.historyAttachmentIds.includes(id)||snapshot.attachmentIds.includes(id))])];
    const refs:string[]=[];
    for(const id of ids){
      const image=images.find(i=>i.id===id);if(!image)continue;
      let index=selected.findIndex(i=>i.id===id);
      if(index<0){index=selected.length;selected.push(image);const frame=own.find(f=>f.attachmentId===id);records.push({ref:`i${index}`,evidenceIds:[],time:image.time,...(frame?{slotKey:frame.slotKey}:{attachmentId:id})});}
      records[index].evidenceIds.push(e.id);refs.push(`i${index}`);
    }
    if(!refs.length)return [];
    return [{evidenceId:e.id,need:e.need,detailNeed:e.detailNeed,readTargets:e.readTargets??[],checks:evidenceChecks(e),mode:e.mode,imageRefs:refs,
      slots:audit.slots.filter(s=>s.evidenceIds.includes(e.id)).map(s=>({slotKey:s.key,window:{from:s.from,to:s.to,anchor:s.anchor},allowedRange:reviewRange(s,duration)}))}];
  });
  const relevant=cues.flatMap((cue,cueId)=>targets.some(t=>t.slots.some(s=>cue.from<=s.allowedRange.to&&cue.to>=s.allowedRange.from))?[{cueId,from:cue.from,to:cue.to,content:cue.content.slice(0,200)}]:[]).slice(0,96);
  const input={task,duration,checksVersion:snapshot.visionReview===2?1:undefined,targets,images:records,nearbySubtitles:relevant,subtitlesAreExcerpt:true,maxRefinements:2};
  const parts:Exclude<ProviderMessage['content'],string>=[{type:'text',text:JSON.stringify(input)}];
  for(const [index,image] of selected.entries())parts.push({type:'text',text:`实际图片 ${records[index].ref}，实际时间 ${image.time} 秒`},{type:'image_url',image_url:{url:image.dataUrl,detail:'original'}});
  const messages:ProviderMessage[]=[{role:'system',content:fixedPrompt({kind:'vision-review'})},{role:'user',content:parts}];
  const review:VisionReview={version:1,...(snapshot.visionReview===2?{checksVersion:1 as const}:{}),status:'checking',images:records,results:[],repairs:[]};
  return {messages,review,targets,allowedCueIds:new Set(relevant.map(c=>c.cueId))};
}

export function parseReview(output:string,request:ReturnType<typeof reviewRequest>,plan:EvidencePlan,audit:VisionAudit,duration:number,cues:readonly Cue[],allowedImages:readonly string[]):VisionReview{
  let json:unknown;
  const refinementNotes:string[]=[],repairReasons=new Map<string,string>();
  const evidenceRank=(key:string)=>plan.evidence.findIndex(e=>audit.slots.find(s=>s.key===key)?.evidenceIds.includes(e.id));
  try{json=JSON.parse(output.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'));}
  catch{return {...request.review,status:'failed',failure:'json'};}
  if(request.review.checksVersion&&(json as {version?:unknown})?.version!==3)return {...request.review,status:'failed',failure:'schema'};
  if((json as {version?:unknown})?.version===3){
    const parsed=checkedReply.safeParse(json);
    if(!parsed.success)return {...request.review,status:'failed',failure:'schema'};
    try{
      const proposals=parsed.data.results.flatMap(r=>r.refinements);
      if(new Set(proposals.map(f=>f.slotKey)).size!==proposals.length)throw Error();
      const results=parsed.data.results.map(r=>{
        const target=request.targets.find(t=>t.evidenceId===r.evidenceId);
        if(!target||r.checks.length!==target.checks.length||new Set(r.checks.map(c=>c.checkId)).size!==r.checks.length)throw Error();
        const checks=r.checks.map(c=>{
          const t=target.checks.find(t=>t.checkId===c.checkId);if(!t)throw Error();
          return {...c,target:t.need,...(c.status==='confirmed'&&observationDisclaimsConfirmation(c.observation)?{status:'uncertain' as const,observation:`本地降为无法确定：${c.observation}`.slice(0,180)}:{})};
        });
        const labels={unreadable:'看不清','not-visible':'未出现',uncertain:'无法确定',confirmed:'已确认'};
        const refinements=r.refinements.flatMap(f=>{
          if(new Set(f.checkIds).size!==f.checkIds.length||f.checkIds.some(id=>!checks.some(c=>c.checkId===id&&c.status!=='confirmed')))throw Error();
          const slot=target.slots.find(s=>s.slotKey===f.slotKey);
          // Validate even a proposal we may choose not to spend money on.
          if(!slot||new Set(f.cueIds).size!==f.cueIds.length||f.cueIds.some(id=>!request.allowedCueIds.has(id))||f.anchorCueId!==undefined&&!f.cueIds.includes(f.anchorCueId))throw Error();
          const from=Math.max(slot.allowedRange.from,Math.min(...f.cueIds.map(id=>cues[id].from))),to=Math.min(slot.allowedRange.to,Math.max(...f.cueIds.map(id=>cues[id].to)));
          if(from>to||f.cueIds.some(id=>cues[id].from>to||cues[id].to<from))throw Error();
          const anchorId=f.anchorCueId??f.cueIds[Math.floor(f.cueIds.length/2)],anchor=(cues[anchorId].from+cues[anchorId].to)/2;
          const existing=audit.frames.find(frame=>frame.slotKey===f.slotKey),detail=audit.slots.find(s=>s.key===f.slotKey)?.detail;
          const skip=plan.evidence.find(e=>e.id===r.evidenceId)?.priority!=='required'?'补充项缺口，保留不确定，不追加补图':existing&&detail==='original'&&Math.abs(anchor-existing.time)<.2?'原图已保留清晰细节且补图锚点未变，未安排重复取图':undefined;
          if(skip){refinementNotes.push(`${r.evidenceId}：${skip}。`);return [];}
          repairReasons.set(f.slotKey,f.reason);
          return [{slotKey:f.slotKey,cueIds:f.cueIds,...(f.anchorCueId!==undefined?{anchorCueId:f.anchorCueId}:{})}];
        });
        return {evidenceId:r.evidenceId,checks,status:checkedStatus(checks),imageRefs:[...new Set(checks.flatMap(c=>c.imageRefs))],observations:checks.filter(c=>c.status==='confirmed').slice(0,2).map(c=>c.observation),missing:checks.filter(c=>c.status!=='confirmed').map(c=>`${c.target}：${labels[c.status]}`).join('；').slice(0,180),refinements};
      });
      // Suggestions are not capture authorization. Validate every suggestion
      // first, remove optional/no-op work, then cap the executable batch. An
      // excess suggestion must not erase otherwise valid image findings.
      const useful=results.flatMap(r=>r.refinements).sort((a,b)=>evidenceRank(a.slotKey)-evidenceRank(b.slotKey));
      const selected=new Set(useful.slice(0,2).map(f=>f.slotKey));
      if(useful.length>2)refinementNotes.unshift('本地按核心目标顺序保留最多2个补图建议；其余缺口仍保留为未确认。');
      for(const result of results)result.refinements=result.refinements.filter(f=>selected.has(f.slotKey));
      json={version:2,results};
    }catch{return {...request.review,status:'failed',failure:'references'};}
  }
  if(json&&typeof json==='object'&&(json as {version?:unknown}).version===2){
    const wire=compactReply.safeParse(json);
    if(!wire.success)return {...request.review,status:'failed',failure:'schema'};
    try{
      json={version:1,results:wire.data.results.map(result=>({...result,refinements:result.refinements.map(r=>{
        const slot=request.targets.find(t=>t.evidenceId===result.evidenceId)?.slots.find(s=>s.slotKey===r.slotKey);
        if(!slot||new Set(r.cueIds).size!==r.cueIds.length||r.cueIds.some(id=>!request.allowedCueIds.has(id)))throw Error();
        const anchorId=r.anchorCueId??r.cueIds[Math.floor(r.cueIds.length/2)];
        if(!r.cueIds.includes(anchorId))throw Error();
        const from=Math.max(slot.allowedRange.from,Math.min(...r.cueIds.map(id=>cues[id].from)));
        const to=Math.min(slot.allowedRange.to,Math.max(...r.cueIds.map(id=>cues[id].to)));
        const anchor=Math.max(from,Math.min(to,(cues[anchorId].from+cues[anchorId].to)/2));
        if(from>to||r.cueIds.some(id=>cues[id].from>to||cues[id].to<from))throw Error();
        return {slotKey:r.slotKey,window:{from,to,anchor,cueIds:r.cueIds,basis:'subtitle'}};
      })}))};
    }catch{return {...request.review,status:'failed',failure:'references'};}
  }
  const parsed=visionReviewReplySchema.safeParse(json);
  if(!parsed.success)return {...request.review,status:'failed',failure:'schema'};
  // Build tentative repairs separately. A later validation failure must not
  // mutate the empty request baseline returned by the failure path.
  const review:VisionReview={...request.review,status:'complete',results:parsed.data.results,repairs:[],...(refinementNotes.length?{refinementNotes:refinementNotes.slice(0,2)}:{})};
  try{
    if(review.results.length!==request.targets.length||review.results.some(r=>!request.targets.some(t=>t.evidenceId===r.evidenceId)))throw Error();
    for(const result of review.results)for(const refinement of result.refinements){
      const slot=audit.slots.find(s=>s.key===refinement.slotKey)!,range=reviewRange(slot,duration),w=refinement.window;
      if(w.from<range.from||w.to>range.to||w.cueIds.some(id=>!request.allowedCueIds.has(id)||cues[id].from>w.to||cues[id].to<w.from))throw Error();
      if(review.repairs.some(r=>r.slotKey===slot.key))throw Error();
      const original=plan.evidence.find(e=>e.id===slot.group)!.windows.find(w=>w.anchor===slot.anchor&&w.from===slot.from&&w.to===slot.to)!;
      review.repairs.push({slotKey:slot.key,window:w,originalWindow:original,originalTime:audit.frames.find(f=>f.slotKey===slot.key)?.time,...(repairReasons.has(slot.key)?{reason:repairReasons.get(slot.key)}:{}),state:'pending'});
    }
    review.repairs.sort((a,b)=>Number(plan.evidence.find(e=>e.id===audit.slots.find(s=>s.key===b.slotKey)?.group)?.priority==='required')-Number(plan.evidence.find(e=>e.id===audit.slots.find(s=>s.key===a.slotKey)?.group)?.priority==='required')||evidenceRank(a.slotKey)-evidenceRank(b.slotKey));
    const proposal=refinementWindows(plan,audit,review.repairs);
    validateEvidencePlan(proposal.plan,duration,cues,allowedImages);
    validateVisionReview(review,plan,audit,duration,allowedImages,cues.length);
    return review;
  }catch{return {...request.review,status:'failed',failure:'references'};}
}

/** Collect at most one repair round in memory. All adopted replacements are
 * committed together by the store, so a failed comparison cannot publish half. */
export async function captureRefinements(plan:EvidencePlan,audit:VisionAudit,review:VisionReview,images:readonly Attachment[],capture:(time:number,detail:'low'|'original')=>Promise<SampledFrame>,signal:AbortSignal){
  const repairs=review.repairs.filter(r=>r.state==='pending'),next=refinementWindows(plan,audit,repairs);
  const keys=new Set(repairs.map(r=>r.slotKey)),priorMs=audit.budget.mediaMs,started=performance.now();
  const temp=structuredClone(next.audit),frames:{slotKey:string;frame:Omit<SampledFrame,'sample'>}[]=[];
  temp.slots=temp.slots.filter(s=>keys.has(s.key));temp.frames=[];
  temp.budget.imageBytes-=audit.frames.filter(f=>keys.has(f.slotKey)).reduce((n,f)=>n+(images.find(i=>i.id===f.attachmentId)?.bytes??0),0);
  temp.budget.maxMediaMs=Math.max(0,audit.budget.maxMediaMs-priorMs);
  const finish=()=>{
    const result=structuredClone(audit);result.candidates=temp.candidates;result.budget.captures=temp.budget.captures;
    result.budget.mediaMs=priorMs+Math.round(performance.now()-started);
    return result;
  };
  try{
    await captureEvidence(next.plan,temp,capture,async(frame,slot,a)=>{frames.push({slotKey:slot.key,frame});a.frames.push({slotKey:slot.key,attachmentId:crypto.randomUUID(),time:frame.time,detail:slot.detail});return a;},async()=>{},signal);
    const result=finish();
    result.budget.imageBytes=audit.budget.imageBytes-frames.reduce((n,f)=>{const old=audit.frames.find(old=>old.slotKey===f.slotKey);return n+(images.find(i=>i.id===old?.attachmentId)?.bytes??0);},0)+frames.reduce((n,f)=>n+frameBytes(f.frame),0);
    const useful=frames.filter(({slotKey,frame})=>{
      const prior=audit.frames.find(f=>f.slotKey===slotKey),image=images.find(i=>i.id===prior?.attachmentId);
      return !(prior?.detail==='original'&&image&&Math.abs(frame.time-prior.time)<.2&&frame.dataUrl===image.dataUrl);
    });
    // Keep the real capture/time costs even when an identical PNG is rejected.
    return {audit:result,frames:useful};
  }catch(error){signal.throwIfAborted();return {audit:finish(),frames:[],error};}
}

export function canRefine(audit:VisionAudit){return audit.budget.captures<audit.budget.maxCaptures&&audit.budget.mediaMs+visualPolicy.candidateReserveMs+visualPolicy.restoreReserveMs<audit.budget.maxMediaMs;}
