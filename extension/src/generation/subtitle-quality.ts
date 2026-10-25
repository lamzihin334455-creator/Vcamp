import {z} from 'zod';
import type {Cue} from '../contracts/video';
import type {SubtitleRequestSnapshot} from '../contracts/generation';
import {ProviderError,type ProviderPort} from './provider-port';
import {fixedPrompt} from '../prompts/fixed-rules';
import {subtitleResponse} from './subtitle-response';
import {reviewSubtitleCorrections} from './subtitle-corrections';

const termSchema=z.object({canonical:z.string().trim().min(1).max(120),variants:z.array(z.string().trim().min(1).max(120)).max(32),target:z.string().trim().min(1).max(120).optional()}).strict();
const termsSchema=z.object({terms:z.array(termSchema).max(500)}).strict();
export type SubtitleTerm=z.infer<typeof termSchema>;
export type SubtitlePhase='terms'|'searching'|'processing'|'reconciling';
export interface SubtitleQualityPort{lookup?:(question:string,signal:AbortSignal)=>Promise<string>;phase?:(phase:SubtitlePhase)=>Promise<void>}
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const numericSpelling=/^[$￥¥€£\d零〇一二两三四五六七八九十百千万亿兆点.,%％]+$/u;
// Already-correct names are useful context even when the model found no ASR
// variants. Keep only spellings actually present in this source/translation.
function sourceVariants(term:SubtitleTerm,contains:(value:string)=>boolean){
 return [...new Set([...term.variants,term.canonical])].filter(contains);
}

// One pass, longest match first. Latin aliases require word boundaries; this
// prevents replacing CARP inside SCARPATHY or cascading one entity into another.
export function applyTerminology(text:string,terms:readonly SubtitleTerm[],translated=false){
 const names=new Map<string,string>();
 for(const term of terms)for(const variant of [...term.variants,term.canonical]){
  const canonical=translated?term.target??term.canonical:term.canonical;
  if(names.has(variant)&&names.get(variant)!==canonical)throw new ProviderError('protocol');
  names.set(variant,canonical);
 }
 if(!names.size)return text;
 // A numeric homophone such as 千万 may denote a product in one cue and a
 // quantity in another. Leave it to the contextual batch model, never a global
 // string substitution (which could turn 几千万 into 几Qwen).
 const automatic=[...names.keys()].filter(value=>!numericSpelling.test(value));
 if(!automatic.length)return text;
 const pattern=automatic.sort((a,b)=>b.length-a.length||a.localeCompare(b)).map(value=>`${/^[\p{L}\p{N}_]/u.test(value)&&/^[\x00-\x7f]/.test(value)?'(?<![\\p{L}\\p{N}_])':''}${escape(value)}${/[\p{L}\p{N}_]$/u.test(value)&&/[\x00-\x7f]$/.test(value)?'(?![\\p{L}\\p{N}_])':''}`).join('|');
 return text.replace(new RegExp(pattern,'gu'),match=>names.get(match)!);
}

// A model may echo a numeric alias as a product even after global replacement
// is disabled. Restore only the exact polluted quantity from the source cue;
// keep other corrections and names in that cue, and never apply to translation.
function preserveQuantities(source:string,output:string,terms:readonly SubtitleTerm[]){
 const numericAliases=terms.filter(term=>!numericSpelling.test(term.canonical)).flatMap(term=>term.variants.filter(variant=>numericSpelling.test(variant)).map(variant=>({variant,canonical:term.canonical})));
 if(!numericAliases.length||source===output)return output;
 for(const match of source.matchAll(/[数几上成]?[$￥¥€£\d零〇一二两三四五六七八九十百千万亿兆点.,%％]+/gu)){
  const quantity=match[0].replace(/[.,]+$/,''),hasUnit=/^(?:个|条|次|元|块|人|年|月|日|天|小时|分钟|秒)/.test(source.slice(match.index+quantity.length));
  for(const {variant,canonical} of numericAliases)if(quantity.includes(variant)&&(quantity!==variant||hasUnit)){
   const polluted=quantity.replaceAll(variant,canonical);
   output=output.replaceAll(polluted,quantity);
  }
 }
 return output;
}

async function requestTerms(stage:'subtitle-terms'|'subtitle-reconcile',payload:unknown,snapshot:SubtitleRequestSnapshot,provider:ProviderPort,signal:AbortSignal,validate?:(terms:SubtitleTerm[])=>void){
 return subtitleResponse(provider,snapshot.modelId,[{role:'system',content:fixedPrompt({kind:stage})},{role:'user',content:JSON.stringify(payload)}],signal,value=>{const terms=termsSchema.parse(value).terms;validate?.(terms);return terms;});
}

function examples(cues:readonly Cue[],variants:readonly string[]){
 const result:string[]=[];
 for(let i=0;i<cues.length&&result.length<3;i++)if(variants.some(variant=>cues[i].content.includes(variant))){const text=cues.slice(Math.max(0,i-1),i+2).map(cue=>cue.content).join(' '),position=Math.min(...variants.map(variant=>text.indexOf(variant)).filter(index=>index>=0));result.push(text.slice(Math.max(0,position-180),Math.max(0,position-180)+600));}
 return result;
}

export async function prepareSubtitleGlossary(snapshot:SubtitleRequestSnapshot,cues:readonly Cue[],provider:ProviderPort,signal:AbortSignal,quality:SubtitleQualityPort){
 await quality.phase?.('terms');
 const candidates:SubtitleTerm[]=[];let group:{index:number;content:string}[]=[],chars=0;
 async function flush(){if(!group.length)return;const found=await requestTerms('subtitle-terms',{stage:'terms',operation:snapshot.target.operation,videoTitle:snapshot.videoTitle??'',cues:group},snapshot,provider,signal);for(const term of found){const variants=sourceVariants(term,variant=>group.some(cue=>cue.content.includes(variant)));if(variants.length)candidates.push({...term,variants});}const unique=[...new Map(candidates.map(term=>[JSON.stringify(term),term])).values()];candidates.splice(0,candidates.length,...unique);group=[];chars=0;if(candidates.length>1000)throw new ProviderError('context-limit');}
 for(let index=0;index<cues.length;index++){const row={index,content:cues[index].content},size=JSON.stringify(row).length;if(chars+size>150000)await flush();group.push(row);chars+=size;}
 await flush();
 let webMaterial='';
 if(snapshot.webEnabled){if(!quality.lookup)throw new ProviderError('web-unsupported');await quality.phase?.('searching');
  const names=[...new Set(candidates.flatMap(term=>[term.canonical,...term.variants]))].join('、').slice(0,5000);
  const context=candidates.slice(0,12).flatMap(term=>examples(cues,term.variants).slice(0,1)).join('\n').slice(0,4500);
  webMaterial=await quality.lookup(`核对字幕中的人名、产品名称、技术专名及明显 ASR 误识别。按视频语境消歧，优先官方来源，不纠正说话者观点。\n视频：${snapshot.videoTitle??''}\n候选：${names||'请核对视频主题涉及的主要名称'}\n语境：${context}`,signal);
 }
 if(!candidates.length)return {terms:[] as SubtitleTerm[],webMaterial};
 const terms=await reviewTerms(candidates,cues,snapshot,provider,signal,webMaterial);
 return {terms,webMaterial};
}

async function reviewTerms(candidates:readonly SubtitleTerm[],cues:readonly Cue[],snapshot:SubtitleRequestSnapshot,provider:ProviderPort,signal:AbortSignal,webMaterial:string){
 const compact=[...new Map(candidates.map(term=>[JSON.stringify(term),term])).values()];
 if(compact.length>500)throw new ProviderError('context-limit');
 const exampleChars=Math.max(60,Math.floor(60000/Math.max(1,compact.length*2)));
 const allowed=new Set(compact.flatMap(term=>[term.canonical,...term.variants,...(term.target?[term.target]:[])]));
 return requestTerms('subtitle-reconcile',{
  stage:'reconcile',operation:snapshot.target.operation,videoTitle:snapshot.videoTitle??'',targetLanguage:snapshot.targetLanguage,
  candidates:compact.map(term=>({...term,examples:examples(cues,term.variants).slice(0,2).map(text=>text.slice(0,exampleChars))})),webMaterial
 },snapshot,provider,signal,result=>{
  // A reviewed identity must refer to an actual candidate. Its newly verified
  // spelling may be repeated in variants; unrelated aliases remain forbidden.
  if(result.some(term=>![term.canonical,...term.variants].some(variant=>allowed.has(variant))||term.variants.some(variant=>!allowed.has(variant)&&variant!==term.canonical&&variant!==term.target)))throw new ProviderError('protocol');
  applyTerminology('',result);
 });
}

export async function reconcileSubtitleTerms(snapshot:SubtitleRequestSnapshot,source:readonly Cue[],result:readonly Cue[],terms:readonly SubtitleTerm[],provider:ProviderPort,signal:AbortSignal,quality:SubtitleQualityPort,webMaterial:string){
 await quality.phase?.('reconciling');
 if(snapshot.target.operation==='enhance')return reviewSubtitleCorrections(snapshot,source,result.map((cue,index)=>({...cue,content:preserveQuantities(source[index].content,cue.content,terms)})),terms,webMaterial,provider,signal);
 const conflicts:SubtitleTerm[]=[];
 // Translation gets a second terminology pass over every batch: extract only
 // names/spellings from the actual translated output, never rewrite whole cues.
 if(snapshot.target.operation==='translate'){
  let group:{index:number;source:string;translated:string}[]=[],chars=0;
  async function flush(){if(!group.length)return;const found=await requestTerms('subtitle-terms',{stage:'translation-terms',targetLanguage:snapshot.targetLanguage,glossary:terms,cues:group},snapshot,provider,signal);for(const term of found){const variants=sourceVariants(term,variant=>group.some(cue=>cue.translated.includes(variant)));if(variants.length)conflicts.push({...term,variants});}group=[];chars=0;}
  for(let i=0;i<result.length;i++){const row={index:i,source:source[i].content,translated:result[i].content},size=JSON.stringify(row).length;if(chars+size>150000)await flush();group.push(row);chars+=size;}
  await flush();
 }
 if(!conflicts.length)return result.map(cue=>({...cue,content:applyTerminology(cue.content,terms,snapshot.target.operation==='translate')}));
 const context=source.map((cue,index)=>({...cue,content:`原文：${cue.content}\n本轮结果：${result[index].content}`}));
 const reviewed=await reviewTerms([...terms,...conflicts],context,snapshot,provider,signal,webMaterial);
 // A reviewed conflict replaces its old mappings; other confirmed terms remain.
 const aliases=new Set(reviewed.flatMap(term=>[term.canonical,...term.variants]));
 const combined=[...terms.filter(term=>![term.canonical,...term.variants].some(alias=>aliases.has(alias))),...reviewed];
 return result.map(cue=>({...cue,content:applyTerminology(cue.content,combined,true)}));
}
