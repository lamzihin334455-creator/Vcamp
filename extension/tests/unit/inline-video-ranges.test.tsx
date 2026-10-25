import {expect,test} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {TimedMarkdown} from '../../src/workbench/TimedMarkdown';

const render=(content:string,duration=435)=>renderToStaticMarkup(<TimedMarkdown content={content} duration={duration} seek={()=>{}}/>);
const buttons=(html:string)=>[...html.matchAll(/class="answer-time"[^>]*>(.*?)<\/button>/g)].map(m=>m[1]);

test('user supplied assessment renders all four inline intervals with both endpoints',()=>{
 const text=readFileSync(new URL('../fixtures/inline-video-ranges.md',import.meta.url),'utf8');
 const html=render(text);
 expect(buttons(html)).toEqual(['00:00','07:15','04:40','04:55','05:17','05:20','01:34','01:47']);
 expect(html).toContain('综合评分：88 / 100');expect(html).toContain('10–15 个 wiki 页面');
});

test.each(['–','—','-','~','～','至','到'])('inline interval separator %s works in parentheses and emphasis',separator=>{
 expect(buttons(render(`举例（**04:40${separator}04:55**），以及 [05:17${separator}05:20]。`))).toEqual(['04:40','04:55','05:17','05:20']);
});

test('multiline timestamps and ranges do not depend on text-node position',()=>{
 expect(buttons(render('01:00–02:00 步骤一\n02:00–03:00 步骤二\n视频 03:00–04:00 结果'))).toEqual(['01:00','02:00','02:00','03:00','03:00','04:00']);
});

test('hour-long, multiple and table ranges retain endpoints',()=>{
 expect(buttons(render('依据（01:02:03–01:03:05），对照（66:32–67:10）。',7200))).toEqual(['01:02:03','01:03:05','01:06:32','01:07:10']);
 expect(buttons(render('| 章节 | 时间 |\n| --- | --- |\n| 方法 | 04:40–04:55 |'))).toEqual(['04:40','04:55']);
});

test('ranges do not hijack code, URLs, ratios, dates, ordinary clock labels or existing links',()=>{
 const text='`04:40–04:55`\n\n```text\n04:40–04:55\n```\n\nhttps://example.com/04:40–04:55\n\n[外部链接 04:40–04:55](https://example.com)\n\n会议时间 12:30，比例 4:3，日期 2026-10-22，数量 10–15。\n\n[关键片段 04:40–04:55](vcamp-time:280)';
 expect(buttons(render(text))).toEqual(['关键片段 04:40–04:55']);
 expect(buttons(render('会议时间 12:30–13:00，营业时间：08:00–18:00。',86400))).toEqual([]);
});

test('invalid or reversed intervals never partially become apparently valid references',()=>{
 expect(buttons(render('依据（04:60–05:10）、（05:00–04:00）、（1234:20–1234:40）、（1:2–2:3）。'))).toEqual([]);
});

test('duration validation still rejects an interval endpoint beyond the video',()=>{
 const html=render('重点（07:00–08:00）');
 expect(buttons(html)).toEqual(['07:00']);expect(html).toContain('时间超出视频时长');
});
