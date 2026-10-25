import {expect,test} from 'vitest';
import {segmentSubtitles,subtitleLines} from '../../src/generation/subtitle-context';
import {fixedPromptRules} from '../../src/prompts/fixed-rules';
import {runChat} from '../../src/generation/run-chat';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';

test('answer context supplies a copyable range with original fractional target instead of requiring time arithmetic',()=>{
  const text=segmentSubtitles([{from:106.76,to:158.78,content:'任务思维原文'}])[0].text;
  expect(text).toContain('[01:46–02:38](vcamp-time:106.76)');
  expect(text).toContain('startSeconds=106.76');
  expect(text).toContain('endSeconds=158.78');
  expect(text).toContain('任务思维原文');
});

test('actual answer request carries the readable media bound and forbids recalculating citation destinations',async()=>{
  const snapshot:ChatRequestSnapshot={snapshotId:'s',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'评估资料适用度',outputType:'chat',modelId:'fixture',templateRevisionId:null,webEnabled:false,autoVision:false,mediaDuration:1927,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[]};
  let calls=0,context:any;
  await runChat(snapshot,[{from:106.76,to:158.78,content:'任务思维原文'}],{stream:async(_,messages,__,delta)=>{
    calls++;context=JSON.parse(String(messages[1].content).split('\n').slice(1).join('\n'));
    expect(messages[0].content).toContain('原样复制');
    await delta('已按字幕评估。');
  }},new AbortController().signal,async()=>{});
  expect(context.videoTimeline).toMatchObject({durationSeconds:1927,durationLabel:'32:07'});
  expect(context.subtitle.content).toContain('[01:46–02:38](vcamp-time:106.76)');
  expect(calls).toBe(1);
  expect(fixedPromptRules['time-links'].text).toContain('不换算链接目标');
});

test('long subtitle compaction preserves every cue and precise bound without adding an unbounded citation catalogue',()=>{
  const cues=Array.from({length:1800},(_,index)=>({from:index+0.125,to:index+0.75,content:`第${index}条完整字幕内容`}));
  const compact=subtitleLines(cues);
  expect(compact.header).toContain('时间单位为秒');
  expect(compact.lines).toHaveLength(cues.length);
  expect(compact.lines[0]).toBe('[0.125,0.75] 第0条完整字幕内容');
  expect(compact.lines.at(-1)).toBe('[1799.125,1799.75] 第1799条完整字幕内容');
  expect(subtitleLines([cues[0]],true).lines[0]).toContain('[cueId=0; startSeconds=0.125; endSeconds=0.75]');
});
