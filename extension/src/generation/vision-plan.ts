import {z,ZodError} from 'zod';
import type {Cue} from '../contracts/video';
import {evidencePlanSchema,parseVisionPlan, validateEvidencePlan, visionPlanFailureSchema, VisionPlanValidationError, type EvidencePlan, type VisionPlanFailure} from '../contracts/vision';

// Only the explanatory list may be omitted at the model boundary. Keep the
// canonical store/import schema strict, and record the omission as a gap rather
// than interpreting it as the model having confirmed that no gaps exist.
const proposalSchema=evidencePlanSchema.extend({unresolved:evidencePlanSchema.shape.unresolved.optional()});
const omittedUnresolved='规划响应未提供未解决项清单；这不表示所有视觉需求已覆盖，仍须依据实际取帧与核验结果判断。';
export const visionCueProposalLimit=64;
const canonicalCueLimit=8;
const cueWindow=z.object({cueIds:z.array(z.number().int().nonnegative()).min(1).max(visionCueProposalLimit),anchorCueId:z.number().int().nonnegative().optional()}).strict();
const directWindow=z.object({from:z.number().finite().nonnegative(),to:z.number().finite().nonnegative(),anchor:z.number().finite().nonnegative(),basis:z.enum(['user-time','chapter','explore'])}).strict();
const cueProposalSchema=z.object({version:z.literal(3),scope:evidencePlanSchema.shape.scope,
  evidence:z.array(z.object({need:z.string().trim().min(1).max(180),priority:z.enum(['required','optional']),mode:z.enum(['single','pair','sequence']),
    windows:z.array(z.union([cueWindow,directWindow])).max(3),reuseAttachmentIds:z.array(z.string().uuid()).max(10).optional(),
    detailNeed:z.enum(['overview','read-text']),readTargets:z.array(z.string().trim().min(1).max(60)).max(4).optional(),checkTargets:evidencePlanSchema.shape.evidence.element.shape.checkTargets,reason:z.string().trim().min(1).max(180)}).strict()).max(8),
  unresolved:evidencePlanSchema.shape.unresolved.optional()}).strict();

/** Version 3 asks the model for decisions, not duplicate arithmetic. Subtitle
 * windows and anchors are computed from the original, indexed cue timeline. */
function cueProposal(value:unknown,duration:number,cues:readonly Cue[],imageIds:readonly string[]){
  const raw=cueProposalSchema.parse(value);
  if(!Number.isFinite(duration)||duration<=0)throw new VisionPlanValidationError('invalid-duration',[]);
  const referenceNotes=new Map<string,string[]>();
  const evidence=raw.evidence.map((e,i)=>({...e,id:`e${i+1}`,reuseAttachmentIds:e.reuseAttachmentIds??[],windows:e.windows.map((w,j)=>{
    if(!('cueIds' in w))return {...w,cueIds:[]};
    const anchorId=w.anchorCueId??w.cueIds[Math.floor(w.cueIds.length/2)];
    if(new Set(w.cueIds).size!==w.cueIds.length||w.cueIds.some(id=>!cues[id])||!w.cueIds.includes(anchorId))throw new VisionPlanValidationError('invalid-cue',[`evidence.${i}.windows.${j}.cueIds`]);
    const selected=w.cueIds.map(id=>cues[id]),from=Math.min(...selected.map(c=>c.from)),to=Math.min(duration-.001,Math.max(...selected.map(c=>c.to)));
    const target=cues[anchorId],anchor=Math.min(to,(target.from+target.to)/2);
    let cueIds=w.cueIds;
    if(cueIds.length>canonicalCueLimit){
      // Validate ALL proposed references above before selecting compact stored
      // provenance. Preserve both boundary witnesses and the original anchor;
      // geometry is computed from the full proposal, never a truncated prefix.
      const ordered=[...cueIds].sort((a,b)=>cues[a].from-cues[b].from||cues[a].to-cues[b].to||a-b);
      const first=ordered[0],last=ordered.reduce((a,b)=>cues[b].to>cues[a].to?b:a);
      const kept=new Set([first,last,anchorId]);
      for(let k=0;k<canonicalCueLimit&&kept.size<canonicalCueLimit;k++)kept.add(ordered[Math.round(k*(ordered.length-1)/(canonicalCueLimit-1))]);
      for(const id of ordered){if(kept.size===canonicalCueLimit)break;kept.add(id);}
      cueIds=ordered.filter(id=>kept.has(id));
      const key=`e${i+1}`,notes=referenceNotes.get(key)??[];
      notes.push(`窗口${j+1}的${w.cueIds.length}条字幕编号全部通过校验，归并为${cueIds.length}条定位引用；原时间范围与锚点保持不变，不增加取帧。`);
      referenceNotes.set(key,notes);
    }
    return {from,to,anchor,cueIds,basis:'subtitle' as const};
  })}));
  const result=evidenceProposal({version:2,scope:raw.scope,needsNewFrames:evidence.some(e=>e.windows.length),evidence,unresolved:raw.unresolved},duration,cues,imageIds);
  const samplingNotes=evidence.map(e=>[...(result.samplingNotes??[]).filter(note=>note.startsWith(`${e.id}：`)),...(referenceNotes.get(e.id)??[])].join('；').slice(0,220)).filter(Boolean);
  return {...result,...(samplingNotes.length?{samplingNotes}:{}),cueGrounded:true as const};
}

// Extract only a native parser's numeric position. Its message may quote model
// text, so neither that message nor an excerpt is durable failure metadata.
function jsonFailure(error:unknown,source:string):VisionPlanFailure{
  const message=error instanceof SyntaxError?error.message:'';
  const ended=/^Unexpected end of JSON input$/.test(message);
  const position=/\bin JSON at position (\d+)(?: \(line \d+ column \d+\))?$/.exec(message);
  const offset=ended?source.length:position?Number(position[1]):undefined;
  const located=offset!==undefined&&Number.isSafeInteger(offset)&&offset>=0&&offset<=source.length;
  const before=located?source.slice(0,offset):'',lines=before.split('\n');
  return {code:'invalid-json',fields:[],syntax:{kind:ended?'unexpected-end':'syntax',...(located?{offset,line:lines.length,column:lines.at(-1)!.length+1}:{})}};
}

/** A continuous process interval is an explicit request for multiple states,
 * not a video clip. Expand only that unambiguous form into two still samples.
 * Canonical capture/store validation remains strict for every final window. */
function evidenceProposal(value:unknown,duration:number,cues:readonly Cue[],imageIds:readonly string[]):{plan:EvidencePlan;samplingNotes?:string[]}{
  const parsed=proposalSchema.parse(value);
  const proposal:EvidencePlan={...parsed,unresolved:parsed.unresolved??[omittedUnresolved]};
  const interval=(e:EvidencePlan['evidence'][number])=>e.mode==='sequence'&&e.windows.length===1&&!e.reuseAttachmentIds.length;
  if(!proposal.evidence.some(interval))return {plan:validateEvidencePlan(proposal,duration,cues,imageIds)};
  // Check every original cue, range, anchor, reuse and frame flag before changing
  // sampling. A one-window shadow checks geometry without the group mismatch.
  validateEvidencePlan({...proposal,evidence:proposal.evidence.map(e=>interval(e)?{...e,mode:'single' as const}:e)},duration,cues,imageIds);
  const samplingNotes:string[]=[];
  for(const e of proposal.evidence.filter(interval)){
    const w=e.windows[0],span=w.to-w.from,first=w.from+span/4,last=w.from+span*3/4;
    // Keep the historical 0.2-second separation floor. An instant or too-short
    // interval still needs explicit state windows; never invent another scene.
    if(last-first<.2)continue;
    e.windows=[{...w,anchor:first},{...w,anchor:last}];
    samplingNotes.push(`${e.id}：连续区间 ${w.from}—${w.to} 秒按前后两处取样，锚点 ${first}、${last} 秒（原锚点 ${w.anchor} 秒）；每处独立择帧，两张计入预算并成组保留。静帧只能比较可见状态，不能确认连续动作或流畅度。`.slice(0,220));
  }
  return {plan:validateEvidencePlan(proposal,duration,cues,imageIds),...(samplingNotes.length?{samplingNotes}:{})};
}

/** Failure metadata contains allowlisted paths, never model values. */
export function parseEvidenceProposal(output:string,duration:number,cues:readonly Cue[],imageIds:readonly string[]):{plan:EvidencePlan;samplingNotes?:string[];cueGrounded?:true}|{failure:VisionPlanFailure}{
  let json:unknown;
  const source=output.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1');
  try{json=JSON.parse(source);}
  catch(error){return {failure:jsonFailure(error,source)};}
  try{
    if(json&&typeof json==='object'&&!Array.isArray(json)){
      const version=(json as {version?:unknown}).version;
      if(version===3)return cueProposal(json,duration,cues,imageIds);
      if(version===2)return evidenceProposal(json,duration,cues,imageIds);
      if(version!==undefined)return {failure:{code:'unsupported-version',fields:['version']}};
      // Only the historical {times,reason} envelope qualifies for compatibility.
      if('times' in json){
        const old=parseVisionPlan(output,duration,6);
        return {plan:{version:2,scope:'focused',needsNewFrames:old.times.length>0,
          unresolved:['兼容旧时间点计划；缺少逐项证据与窗口语境，画面语义未核验。'],
          evidence:old.times.map((time,index)=>({id:`legacy_${index}`,need:old.reason.slice(0,180),reason:'兼容旧计划，只检查所给时间。',priority:'required',mode:'single',detailNeed:'read-text',reuseAttachmentIds:[],windows:[{from:time,to:time,anchor:time,cueIds:[],basis:'explore'}]}))}};
      }
    }
    return {failure:{code:'invalid-schema',fields:[]}};
  }catch(error){
    if(error instanceof VisionPlanValidationError)return {failure:error.failure};
    if(error instanceof ZodError){
      const fields=[...new Set(error.issues.map(issue=>issue.path.join('.')).filter(path=>visionPlanFailureSchema.shape.fields.element.safeParse(path).success))].slice(0,8);
      return {failure:{code:'invalid-schema',fields}};
    }
    // Legacy time validation uses the older fixed error vocabulary.
    return {failure:{code:'invalid-window',fields:['times']}};
  }
}
