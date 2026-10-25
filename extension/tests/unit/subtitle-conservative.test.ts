import {expect,test} from 'vitest';
import {runSubtitle} from '../../src/generation/run-subtitle';
import type {SubtitleRequestSnapshot} from '../../src/contracts/generation';
import {subtitleCorrectionEdits} from '../../src/generation/subtitle-corrections';

const snapshot:SubtitleRequestSnapshot={snapshotId:'conservative',target:{kind:'subtitle',workspaceId:'space',operation:'enhance'},source:{locator:'native',fingerprint:'fixture'},targetLanguage:null,requirements:'',modelId:'fixture',subtitleWorkflow:2,webEnabled:false,videoTitle:'原话保留'};
test('preserves oral wording and valid Chinese names while applying only approved ASR spelling corrections',async()=>{
 const source=['她说的未来的三个最火的行业','但现在这最火的岗位','如果字节系的企业','那时候还是梁子呢','领英的 CEO','deep sick 在这里','制算中心开始空转了'].map((content,index)=>({from:index,to:index+1,content}));
 const proposed=['她说的未来三个最火的行业','但现在这三个最火的岗位','如果字节的企业','那时候还是梁文锋呢','LinkedIn 的 CEO','DeepSeek 在这里','智算中心开始空转了'];
 const result=await runSubtitle(snapshot,source,{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  const terms={terms:[{canonical:'LinkedIn',variants:['领英']}]};
  if(payload.stage==='correction-review'){await delta(JSON.stringify({approved:payload.edits.filter((edit:any)=>edit.index>=5).map((edit:any)=>edit.id)}));return;}
  await delta(JSON.stringify(payload.stage?terms:{changes:proposed.map((content,index)=>({index,content}))}));
 }},new AbortController().signal,async()=>{});
 expect(result).toEqual(source.map((cue,index)=>({...cue,content:index>=5?proposed[index]:cue.content})));
});

test('a terminology glossary alone never rewrites the original correction input or output',async()=>{
 const source=[{from:0,to:1,content:'领英和千问，小梁和梁子，都保留原来的称呼。'}];
 const result=await runSubtitle(snapshot,source,{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  if(!payload.stage)expect(payload.cues[0].content).toBe(source[0].content);
  await delta(JSON.stringify(payload.stage?{terms:[{canonical:'LinkedIn',variants:['领英']},{canonical:'Qwen',variants:['千问']},{canonical:'梁文锋',variants:['小梁','梁子']}]}:{changes:[]}));
 }},new AbortController().signal,async()=>{});
 expect(result).toEqual(source);
});

test('mixed suggestions keep repetitions and original punctuation while correcting just an approved name',async()=>{
 const source=[{from:0,to:1,content:'她她用 deep sick 的时候就是就是这样。'}];
 const result=await runSubtitle(snapshot,source,{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  if(payload.stage==='correction-review'){
   expect(payload.context[0].content).toBe(source[0].content);expect(payload.edits).toHaveLength(1);
   expect(payload.edits[0]).toMatchObject({from:'deep sick',to:'DeepSeek'});
   await delta(JSON.stringify({approved:[payload.edits[0].id]}));return;
  }
  await delta(JSON.stringify(payload.stage?{terms:[]}:{changes:[{index:0,content:'她用 DeepSeek 的时候就是这样！'}]}));
 }},new AbortController().signal,async()=>{});
 expect(result).toEqual([{...source[0],content:'她她用 DeepSeek 的时候就是就是这样。'}]);
});

test.each([
 ['她说的未来的三个最火的行业','她说的未来三个最火的行业'],
 ['但现在这最火的岗位','但现在这三个最火的岗位'],
 ['如果字节系的企业','如果字节的企业'],
 ['腾讯系的怎么可能搭豆包呢','腾讯的怎么可能搭豆包呢'],
 ['那我之前所为我的这个模型所所搭配搭配起来','那我之前为我的这个模型所搭配起来'],
 ['领英和千问','LinkedIn和Qwen'],
 ['小梁那个阶段呢','梁文锋那个阶段呢'],
 ['他他给公司里边搭的还是cloud呢','他给公司里边搭的还是cloud呢'],
 ['比如说像c dance是吧','比如说像可灵是吧'],
 ['KIMI，codex。','Kimi、Codex！']
])('cannot publish mechanical rewriting: %s', (before,after)=>{
 expect(subtitleCorrectionEdits(before,after,0)).toEqual([]);
});

test.each(['foreign','duplicate','content'] as const)('a %s review response never writes a partial or invented correction',async kind=>{
 let reviews=0;
 await expect(runSubtitle(snapshot,[{from:0,to:1,content:'制算中心。'}],{async stream(_model,messages,_signal,delta){
  const payload=JSON.parse(messages[1].content as string);
  if(payload.stage==='correction-review'){
   reviews++;const id=payload.edits[0].id;
   await delta(JSON.stringify(kind==='content'?{approved:[id],content:'补充的新内容'}:{approved:kind==='foreign'?['999:0:1']:[id,id]}));return;
  }
  await delta(JSON.stringify(payload.stage?{terms:[]}:{changes:[{index:0,content:'智算中心。'}]}));
 }},new AbortController().signal,async()=>{})).rejects.toMatchObject({code:'protocol'});
 expect(reviews).toBe(2);
});

test('large diff work is bounded and leaves an uncertain long cue unchanged',()=>{
 expect(subtitleCorrectionEdits('甲'.repeat(1500),'乙'.repeat(1500),0)).toEqual([]);
});

test('an English repetition is preserved separately from the following misspelled name',()=>{
 expect(subtitleCorrectionEdits('yes yes remousion','yes Remotion',0)).toEqual([{id:'0:8:17',index:0,start:8,end:17,from:'remousion',to:'Remotion'}]);
});

test('nickname expansion cannot merge into a nearby proper-name replacement',()=>{
 const edits=subtitleCorrectionEdits('小梁说 remousion 就是就是可以制作动画。','梁文锋说 Remotion 就是可以制作动画。',0);
 expect(edits.map(({from,to})=>({from,to}))).toEqual([{from:'remousion',to:'Remotion'}]);
});
