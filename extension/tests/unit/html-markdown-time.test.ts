import {expect,test} from 'vitest';
import {createTimeTools,videoTimeParts,timeLinkLabel} from '../../src/shared/time';
import {fixedPromptRules} from '../../src/prompts/fixed-rules';

const options={leading:false,standalone:true,markdownLinks:true};
test('HTML consumes complete Markdown time references and preserves the real fractional target',()=>{
  expect(videoTimeParts('引文 [27:56](vcamp-time:1676.23) 附近',options)).toEqual([{text:'引文 '},{text:'27:56',time:1676.23},{text:' 附近'}]);
  expect(videoTimeParts('[错误显示 01:07:48](vcamp-time:67.8)',options)).toEqual([{text:'错误显示 01:07:48',time:67.8}]);
  expect(videoTimeParts('[01:07:48](vcamp-time:67.8)',options)).toEqual([{text:'01:07',time:67.8}]);
  expect(videoTimeParts('[01:02:03](vcamp-time:3723.456)',options)).toEqual([{text:'01:02:03',time:3723.456}]);
});
test('interval and descriptive labels remain readable instead of collapsing to a single timestamp',()=>{
  expect(videoTimeParts('[27:56–28:27](vcamp-time:1676.23)',options)).toEqual([{text:'27:56–28:27',time:1676.23}]);
  expect(videoTimeParts('[返回原片](vcamp-time:0)',options)).toEqual([{text:'返回原片',time:0}]);
  expect(timeLinkLabel('[27:56](vcamp-time:1676.23)',1676.23)).toBe('27:56');
  expect(timeLinkLabel('[27:56–28:27](vcamp-time:1676.23)',1676.23)).toBe('27:56–28:27');
});
test('malformed or unsafe explicit targets are not partially turned into plausible rounded links',()=>{
  for(const href of ['vcamp-time:-1','vcamp-time:Infinity','vcamp-time:NaN','vcamp-time:360000','vcamp-time:1e3','vcamp-time:2?extra']){
    const raw=`[27:56](${href})`;expect(videoTimeParts(raw,options)).toEqual([{text:raw}]);
  }
  expect(createTimeTools().markdownTimeLink('[原片](javascript:alert)')).toBeNull();
  expect(createTimeTools().markdownTimeLink('[原片](https://example.test)')).toBeNull();
});
test('HTML protocol gives a concrete anchor example without adding mandatory time citations or changing internal planning',()=>{
  expect(fixedPromptRules['time-links'].text).toContain('<a href="vcamp-time:67.8">01:07</a>');
  expect(fixedPromptRules['time-links'].text).toContain('不得显示 Markdown 链接语法');
  expect(fixedPromptRules['time-links'].text).toContain('不强制附时间');
  expect(fixedPromptRules['time-links'].text.length).toBeLessThan(300);
});
