import {expect,test} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {TimedMarkdown} from '../../src/workbench/TimedMarkdown';
import {videoTimeParts} from '../../src/shared/time';

const render=(content:string)=>renderToStaticMarkup(<TimedMarkdown content={content} duration={1927} seek={()=>{}}/>);

test('screenshot subtitle second ranges render as readable video times instead of raw decimal offsets',()=>{
  for(const [content,start,end] of [
    ['AI 对就业的冲击[25–56.93]','00:25','00:56'],
    ['任务思维[106.76–158.78]','01:46','02:38'],
    ['英文原声[108.789–114.61]','01:48','01:54'],
    ['广告部分[1186–1312]','19:46','21:52'],
    ['结尾配乐[1884–1926]','31:24','32:06']
  ]){
    const html=render(content);
    expect(html.match(/class="answer-time"/g),content).toHaveLength(2);
    expect(html).toContain(`>${start}</button>`);
    expect(html).toContain(`>${end}</button>`);
    expect(html).not.toContain('时间超出视频时长');
  }
});

test('explicit second-range link labels are formatted while their fractional target is kept',()=>{
  const html=render('广告（[1186–1312](vcamp-time:1186)）与[108.789–114.61](vcamp-time:108.789)');
  expect(html).toContain('>19:46–21:52</button>');
  expect(html).toContain('>01:48–01:54</button>');
  expect(html.match(/class="answer-time"/g)).toHaveLength(2);
});

test('real out-of-duration model reference stays rejected, while neighbouring valid references remain usable',()=>{
  const html=render('[105:22](vcamp-time:6312.76) [1884–1926](vcamp-time:1884.97)');
  expect(html).toContain('class="invalid-answer-time"');
  expect(html).toContain('01:45:12');
  expect(html).toContain('32:07');
  expect(html).toContain('>31:24–32:06</button>');
  expect(html.match(/class="answer-time"/g)).toHaveLength(1);
});

test('plain and explicit ranges retain exact seconds, including across an hour boundary',()=>{
  expect(videoTimeParts('英文原声[108.789–114.61]')).toEqual([{text:'英文原声'},{text:'01:48',time:108.789},{text:'–'},{text:'01:54',time:114.61}]);
  expect(videoTimeParts('[3599.5–3601.25]')).toEqual([{text:'59:59',time:3599.5},{text:'–'},{text:'01:00:01',time:3601.25}]);
});

test('ordinary numbers, calendar ranges, external links and code do not become video references',()=>{
  const content='就业率37%–50%，25岁以下，视频年份[2024–2025]，视频中参数[0–1]，版本[1.2–2.0]，1186–1312毫克。`[106.76–158.78]`，[1186–1312](https://example.test/article)。';
  const html=render(content);
  expect(html).not.toContain('answer-time');
  expect(html).toContain('<code>[106.76–158.78]</code>');
  expect(html).toContain('href="https://example.test/article"');
  for(const raw of ['[158.78–106.76]','[-1–10]','[NaN–1]','[1e3–1100]','[360000–360001]'])expect(render(raw)).not.toContain('answer-time');
});
