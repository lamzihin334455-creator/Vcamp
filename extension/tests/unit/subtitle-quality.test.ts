import {expect,test} from 'vitest';
import {runSubtitle} from '../../src/generation/run-subtitle';
import type {SubtitleRequestSnapshot} from '../../src/contracts/generation';
import {applyTerminology} from '../../src/generation/subtitle-quality';
import {ProviderError} from '../../src/generation/provider-port';
import emptyVariants from '../fixtures/subtitle-empty-variants.json';

const snapshot:SubtitleRequestSnapshot={snapshotId:'fixture',target:{kind:'subtitle',workspaceId:'space',operation:'enhance'},source:{locator:'native',fingerprint:'fixture'},targetLanguage:null,requirements:'',modelId:'fixture',subtitleWorkflow:2,webEnabled:true,videoTitle:'Wiki 演讲'};
test('the actual failed terms response accepts correct names with empty variants without a paid repair',async()=>{
 const source=[{from:0,to:1,content:'领英 OpenAI 豆包 混元 快手 IBM；deep sick、cloud、KIMI。'}];
 const stages:string[]=[];
 const result=await runSubtitle({...snapshot,webEnabled:false},source,{async stream(_model,messages,_signal,delta){
  expect(messages).toHaveLength(2);
  const payload=JSON.parse(messages[1].content as string);stages.push(payload.stage??'batch');
  if(payload.stage==='reconcile'){
   for(const name of ['领英','OpenAI','豆包','混元','快手','IBM'])expect(payload.candidates).toContainEqual(expect.objectContaining({canonical:name}));
   expect(payload.candidates.find((term:any)=>term.canonical==='Kimi').variants).toEqual(['KIMI']);
   expect(payload.candidates.some((term:any)=>term.canonical==='可灵')).toBe(false);
  }
  await delta(JSON.stringify(payload.stage==='terms'?emptyVariants:payload.stage==='reconcile'?{terms:[{canonical:'OpenAI',variants:[]},{canonical:'DeepSeek',variants:['deep sick']},{canonical:'Claude',variants:['cloud']}]}:{changes:[]}));
 }},new AbortController().signal,async()=>{});
 expect(result).toEqual(source);
 expect(stages).toEqual(['terms','reconcile','batch']);
});

test('empty variants do not allow an unrelated name through the review',async()=>{
 let reviews=0;
 await expect(runSubtitle({...snapshot,webEnabled:false},[{from:0,to:1,content:'OpenAI'}],{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  if(payload.stage==='reconcile')reviews++;
  await delta(JSON.stringify({terms:[{canonical:payload.stage==='terms'?'OpenAI':'Fabricated Product',variants:[]}]}));
 }},new AbortController().signal,async()=>{})).rejects.toMatchObject({code:'protocol'});
 expect(reviews).toBe(2);
});

test('numeric ASR aliases are resolved in context rather than globally replacing quantities',()=>{
 const terms=[{canonical:'Qwen',variants:['千问','千万']}];
 expect(applyTerminology('千问模型，几千万个请求，三七千万的费用，千万别改观点。',terms)).toBe('Qwen模型，几千万个请求，三七千万的费用，千万别改观点。');
});

test('numeric aliases still reach the contextual batch model without corrupting the batch input',async()=>{
 const source=[{from:0,to:1,content:'搭千万系统。'},{from:1,to:2,content:'几千万个请求。'}];
 const result=await runSubtitle({...snapshot,webEnabled:false},source,{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  if(payload.stage==='correction-review'){await delta(JSON.stringify({approved:payload.edits.map((edit:any)=>edit.id)}));return;}
  if(!payload.stage){expect(payload.cues.map((cue:any)=>cue.content)).toEqual(source.map(cue=>cue.content));expect(payload.glossary[0].variants).toContain('千万');}
  await delta(JSON.stringify(payload.stage?{terms:[{canonical:'千问',variants:['千万']}]}:{changes:[{index:0,content:'搭千问系统。'}]}));
 }},new AbortController().signal,async()=>{});
 expect(result).toEqual([{...source[0],content:'搭千问系统。'},source[1]]);
});

test('model echoes cannot replace a source quantity with a product or discard other corrections',async()=>{
 const source=[{from:0,to:1,content:'几千万个 deep sick 请求。'},{from:1,to:2,content:'千万个请求，三七千万的费用。'}];
 const result=await runSubtitle({...snapshot,webEnabled:false},source,{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  if(payload.stage==='correction-review'){await delta(JSON.stringify({approved:payload.edits.map((edit:any)=>edit.id)}));return;}
  await delta(JSON.stringify(payload.stage?{terms:[{canonical:'Qwen',variants:['千万']},{canonical:'DeepSeek',variants:['deep sick']}]}:{changes:[{index:0,content:'几Qwen个 DeepSeek 请求。'},{index:1,content:'Qwen个请求，三七Qwen的费用。'}]}));
 }},new AbortController().signal,async()=>{});
 expect(result).toEqual([{...source[0],content:'几千万个 DeepSeek 请求。'},source[1]]);
});

test('quantity protection still allows a contextual numeric ASR correction',async()=>{
 const result=await runSubtitle({...snapshot,webEnabled:false},[{from:0,to:1,content:'2025年发布。'}],{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  if(payload.stage==='correction-review'){await delta(JSON.stringify({approved:payload.edits.map((edit:any)=>edit.id)}));return;}
  await delta(JSON.stringify(payload.stage?{terms:[{canonical:'2026',variants:['2025']}]}:{changes:[{index:0,content:'2026年发布。'}]}));
 }},new AbortController().signal,async()=>{});
 expect(result[0].content).toBe('2026年发布。');
});

test('translation terminology also accepts an already correct name with empty variants',async()=>{
 const result=await runSubtitle({...snapshot,webEnabled:false,target:{...snapshot.target,operation:'translate'},targetLanguage:'zh'},[{from:0,to:1,content:'OpenAI explains AI.'}],{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);expect(messages).toHaveLength(2);
  await delta(JSON.stringify(payload.stage?{terms:[{canonical:'OpenAI',variants:[]}]}:{cues:[{index:0,from:0,to:1,content:'OpenAI 解释 AI。'}]}));
 }},new AbortController().signal,async()=>{});
 expect(result[0].content).toBe('OpenAI 解释 AI。');
});

test('a structure repair identifies the failing field without copying subtitle contents',async()=>{
 let attempts=0;
 await runSubtitle({...snapshot,webEnabled:false},[{from:0,to:1,content:'私密正文'}],{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  if(payload.stage==='terms'){
   attempts++;
   if(attempts===1){await delta(JSON.stringify({terms:[{canonical:'私密正文',variants:null}]}));return;}
   expect(messages[3].content).toContain('terms.0.variants');expect(messages[3].content).not.toContain('私密正文');
  }
  await delta(JSON.stringify(payload.stage?{terms:[]}:{changes:[]}));
 }},new AbortController().signal,async()=>{});
 expect(attempts).toBe(2);
});
test('cross-batch proposals are reviewed against evidence and an unapproved rival guess stays original',async()=>{
 const source=Array.from({length:165},(_,i)=>({from:i*2,to:i*2+1,content:'CARP 介绍持久化 wiki。'}));
 const stages:string[]=[],phases:string[]=[];let searches=0;
 const result=await runSubtitle(snapshot,source,{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);stages.push(payload.stage??'process');
  if(payload.stage==='correction-review'){expect(payload.webMaterial).toContain('官方：Andrej Karpathy');await delta(JSON.stringify({approved:payload.edits.filter((edit:any)=>edit.to==='Karpathy').map((edit:any)=>edit.id)}));return;}
  const output=payload.stage==='terms'?{terms:[]}:payload.stage==='reconcile'?{terms:[{canonical:'Karpathy',variants:['CARP','Karpathy','Carpathia']}]}:{changes:payload.cues.map((cue:any)=>({index:cue.index,content:cue.index<160?'Karpathy 介绍持久化 wiki。':'Carpathia 介绍持久化 wiki。'}))};
  if(payload.stage==='reconcile')expect(payload.webMaterial).toContain('官方：Andrej Karpathy');
  await delta(JSON.stringify(output));
 }},new AbortController().signal,async()=>{},{async lookup(){searches++;return '官方：Andrej Karpathy';},async phase(phase){phases.push(phase);}});
 expect(searches).toBe(1);expect(stages.filter(stage=>stage==='process')).toHaveLength(2);expect(stages).toContain('correction-review');expect(phases.at(-1)).toBe('reconciling');
 expect(result).toEqual(source.map((cue,index)=>({...cue,content:index<160?'Karpathy 介绍持久化 wiki。':cue.content})));
});

test('terminology replacement is literal, boundary-aware, non-cascading and refuses conflicting identities',()=>{
 expect(applyTerminology('CARP SCARP A+B A+B2',[{canonical:'Karpathy',variants:['CARP']},{canonical:'C++',variants:['A+B']}])).toBe('Karpathy SCARP C++ A+B2');
 expect(()=>applyTerminology('CARP',[{canonical:'Karpathy',variants:['CARP']},{canonical:'Carpathia',variants:['CARP']}])).toThrow();
});

test('uncertain conflict preserves the source consistently instead of publishing rival guesses',async()=>{
 const source=Array.from({length:165},(_,i)=>({from:i*2,to:i*2+1,content:'CARP 介绍 wiki。'}));
 const result=await runSubtitle({...snapshot,webEnabled:false},source,{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  if(payload.stage==='correction-review'){await delta('{"approved":[]}');return;}
  await delta(JSON.stringify(payload.stage?{terms:[]}:{changes:payload.cues.map((cue:any)=>({index:cue.index,content:cue.index<160?'Karpathy 介绍 wiki。':'Carpathia 介绍 wiki。'}))}));
 }},new AbortController().signal,async()=>{});
 expect(result).toEqual(source);
});

test('translation reviews inconsistent proper names across batches without changing alignment or ordinary text',async()=>{
 const source=Array.from({length:165},(_,i)=>({from:i*2,to:i*2+1,content:'Karpathy explains wiki.'}));
 const result=await runSubtitle({...snapshot,target:{...snapshot.target,operation:'translate'},targetLanguage:'zh',webEnabled:false},source,{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  if(payload.stage==='reconcile')expect(JSON.stringify(payload.candidates)).toContain('本轮结果：');
  const term={canonical:'Karpathy',variants:['卡帕西','卡尔帕西'],target:'卡帕西'};
  await delta(JSON.stringify(payload.stage==='terms'?{terms:[]}:payload.stage?{terms:[term]}:{cues:payload.cues.map((cue:any)=>({...cue,content:(cue.index<160?'卡帕西':'卡尔帕西')+' 解释 wiki。'}))}));
 }},new AbortController().signal,async()=>{});
 expect(result).toEqual(source.map(cue=>({...cue,content:'卡帕西 解释 wiki。'})));
});

test('invalid sources are rejected before any model request',async()=>{
 let calls=0;await expect(runSubtitle(snapshot,[{from:1,to:0,content:'invalid'}],{async stream(){calls++;}},new AbortController().signal,async()=>{})).rejects.toMatchObject({code:'invalid-message'});expect(calls).toBe(0);
});

test('a canonical spelling may appear in its variants but does not automatically rewrite correction cues',async()=>{
 const source=[{from:0,to:1,content:'remousion 可以制作动画。'}];
 const result=await runSubtitle({...snapshot,webEnabled:false},source,{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  await delta(JSON.stringify(payload.stage==='terms'?{terms:[{canonical:'remousion',variants:['remousion']}]}:payload.stage==='reconcile'?{terms:[{canonical:'Remotion',variants:['remousion','Remotion']}]}:{changes:[]}));
 }},new AbortController().signal,async()=>{});
 expect(result).toEqual(source);
});

test('complete fenced JSON is accepted and a malformed batch gets one local protocol repair',async()=>{
 const source=[{from:0,to:1,content:'remousion 可以制作动画。'}];let calls=0;
 const result=await runSubtitle({...snapshot,webEnabled:false},source,{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);calls++;
  if(payload.stage==='correction-review'){await delta(JSON.stringify({approved:payload.edits.map((edit:any)=>edit.id)}));return;}
  if(payload.stage){await delta('```json\n{"terms":[]}\n```');return;}
  if(messages.length===2){await delta('{"changes":[');return;}
  expect(messages).toHaveLength(4);expect(messages[2]).toEqual({role:'assistant',content:'{"changes":['});
  await delta(JSON.stringify({changes:[{index:0,content:'Remotion 可以制作动画。'}]}));
 }},new AbortController().signal,async()=>{});
 expect(result[0].content).toBe('Remotion 可以制作动画。');expect(calls).toBe(4);
});

test('protocol repair never accepts foreign indexes, fabricated aliases or modified translation timing',async()=>{
 const source=[{from:0,to:1,content:'remousion 制作动画。'}];
 for(const kind of ['index','alias','timing'] as const){
  let attempts=0;
  const run=runSubtitle({...snapshot,webEnabled:false,target:{...snapshot.target,operation:kind==='timing'?'translate':'enhance'},targetLanguage:kind==='timing'?'en':null},source,{async stream(_model,messages,_signal,delta){
   const payload=JSON.parse(messages[1].content as string);
   const output=payload.stage==='terms'?{terms:kind==='alias'?[{canonical:'remousion',variants:['remousion']}]:[]}:payload.stage==='reconcile'?{terms:[{canonical:'Remotion',variants:['remousion','unrelated']}]}:kind==='index'?{changes:[{index:999,content:'Remotion 制作动画。'}]}:{cues:[{index:0,from:0,to:9,content:'Remotion makes animation.'}]};
   if(payload.stage==='reconcile'||!payload.stage)attempts++;
   await delta(JSON.stringify(output));
  }},new AbortController().signal,async()=>{});
  await expect(run).rejects.toMatchObject({code:'protocol'});expect(attempts).toBe(2);
 }
});

test('single-letter official names remain valid context without changing a Chinese phonetic name',async()=>{
 const result=await runSubtitle({...snapshot,webEnabled:false},[{from:0,to:1,content:'阿尔语言用于统计。'}],{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  await delta(JSON.stringify(payload.stage?{terms:[{canonical:'R',variants:['阿尔','R']}]}:{changes:[]}));
 }},new AbortController().signal,async()=>{});
 expect(result[0].content).toBe('阿尔语言用于统计。');
});

test.each(['network','auth','rate-limit','output-limit'] as const)('does not retry a %s failure as a JSON repair',async code=>{
 let calls=0;
 await expect(runSubtitle(snapshot,[{from:0,to:1,content:'内容'}],{async stream(){calls++;throw new ProviderError(code);}},new AbortController().signal,async()=>{})).rejects.toMatchObject({code});expect(calls).toBe(1);
});

test('cancellation before validation prevents any protocol repair',async()=>{
 let calls=0;const abort=new AbortController();
 await expect(runSubtitle(snapshot,[{from:0,to:1,content:'内容'}],{async stream(_model,_messages,_signal,delta){calls++;await delta('{');abort.abort();}},abort.signal,async()=>{})).rejects.toMatchObject({name:'AbortError'});expect(calls).toBe(1);
});
