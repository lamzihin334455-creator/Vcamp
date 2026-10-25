import {z} from 'zod';
import type {Cue} from '../contracts/video';
import type {SubtitleRequestSnapshot} from '../contracts/generation';
import {fixedPrompt} from '../prompts/fixed-rules';
import type {ProviderPort} from './provider-port';
import {subtitleResponse} from './subtitle-response';
import type {SubtitleTerm} from './subtitle-quality';

type Edit={id:string;index:number;start:number;end:number;from:string;to:string};
const semantic=(text:string)=>text.normalize('NFKC').replace(/[\p{P}\s]/gu,'').toLocaleLowerCase();
function tokens(text:string){
 return [...text.matchAll(/\p{Script=Latin}[\p{Script=Latin}\p{N}_]*(?:[.+-][\p{Script=Latin}\p{N}_]+)*|[\s\S]/gu)].map(match=>({start:match.index,end:match.index+match[0].length,key:semantic(match[0])})).filter(token=>token.key);
}
function languageSwap(from:string,to:string){
 const han=(text:string)=>/\p{Script=Han}/u.test(text),latin=(text:string)=>/\p{Script=Latin}/u.test(text);
 return han(from)&&!latin(from)&&latin(to)&&!han(to)||latin(from)&&!han(from)&&han(to)&&!latin(to);
}

// Diff against the untouched source, never a pre-normalized glossary result.
// Only replacements are candidates: omissions, sentence completion, repetition
// deletion, punctuation/case changes and language conversion cannot be approved.
export function subtitleCorrectionEdits(before:string,after:string,index:number):Edit[]{
 if(semantic(before)===semantic(after))return [];
 const a=tokens(before),b=tokens(after),width=b.length+1;
 if((a.length+1)*width>262144)return [];
 const lcs=new Uint16Array((a.length+1)*width);
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)lcs[i*width+j]=a[i].key===b[j].key?lcs[(i+1)*width+j+1]+1:Math.max(lcs[(i+1)*width+j],lcs[i*width+j+1]);
 const edits:Edit[]=[];let i=0,j=0;
 while(i<a.length||j<b.length){
  if(i<a.length&&j<b.length&&a[i].key===b[j].key){
   // Align after a deleted repetition so that a following misspelled word
   // can be corrected separately, preserving the original spoken repetition.
   if(i+1<a.length&&lcs[(i+1)*width+j]===lcs[i*width+j]){i++;continue;}
   i++;j++;continue;
  }
  const firstA=i,firstB=j;
  while(i<a.length||j<b.length){
   if(i<a.length&&j<b.length&&a[i].key===b[j].key)break;
   // Neither token can be an unchanged anchor later. Pair this replacement
   // before skipping words, so nearby repetition deletion cannot be bundled
   // into the same edit as a genuine misspelled name.
   if(i<a.length&&j<b.length&&!a.slice(i+1).some(token=>token.key===b[j].key)&&!b.slice(j+1).some(token=>token.key===a[i].key)){i++;j++;continue;}
   if(j>=b.length||(i<a.length&&lcs[(i+1)*width+j]>=lcs[i*width+j+1]))i++;else j++;
  }
  if(firstA===i||firstB===j)continue;
  const start=a[firstA].start,end=a[i-1].end,from=before.slice(start,end),to=after.slice(b[firstB].start,b[j-1].end);
  if(from.length>120||to.length>120||semantic(from)===semantic(to)||languageSwap(from,to))continue;
  edits.push({id:`${index}:${start}:${end}`,index,start,end,from,to});
 }
 return edits.length>32?[]:edits;
}

const reviewSchema=z.object({approved:z.array(z.string().min(1).max(40)).max(240)}).strict();
export async function reviewSubtitleCorrections(snapshot:SubtitleRequestSnapshot,source:readonly Cue[],proposed:readonly Cue[],terms:readonly SubtitleTerm[],webMaterial:string,provider:ProviderPort,signal:AbortSignal):Promise<Cue[]>{
 const accepted=new Map<number,Edit[]>();let group:Edit[]=[];const contexts=new Map<number,string>();
 async function flush(){
  if(!group.length)return;
  const ids=new Map(group.map(edit=>[edit.id,edit]));
  const approved=await subtitleResponse(provider,snapshot.modelId,[{role:'system',content:fixedPrompt({kind:'subtitle-correction-review'})},{role:'user',content:JSON.stringify({stage:'correction-review',videoTitle:snapshot.videoTitle??'',glossary:terms,webMaterial,context:[...contexts].map(([index,content])=>({index,content})),edits:group})}],signal,value=>{
   const result=reviewSchema.parse(value).approved;
   if(new Set(result).size!==result.length||result.some(id=>!ids.has(id)))throw new Error('invalid correction review');
   return result;
  });
  for(const id of approved){const edit=ids.get(id)!,edits=accepted.get(edit.index)??[];edits.push(edit);accepted.set(edit.index,edits);}
  group=[];contexts.clear();
 }
 for(let index=0;index<source.length;index++){
  signal.throwIfAborted();
  const edits=subtitleCorrectionEdits(source[index].content,proposed[index].content,index);
  if(!edits.length)continue;
  const context=source.slice(Math.max(0,index-1),index+2).map(cue=>cue.content).join('\n');
  if(group.length&&(group.length+edits.length>240||JSON.stringify([...group,...edits]).length+[...contexts.values(),context].join('').length>48000))await flush();
  group.push(...edits);contexts.set(index,context);
 }
 await flush();
 return source.map((cue,index)=>{
  let content=cue.content;
  for(const edit of (accepted.get(index)??[]).sort((a,b)=>b.start-a.start))content=content.slice(0,edit.start)+edit.to+content.slice(edit.end);
  return {...cue,content};
 });
}
