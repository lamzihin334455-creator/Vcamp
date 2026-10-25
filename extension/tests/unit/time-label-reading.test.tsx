import {expect,test} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {TimedMarkdown} from '../../src/workbench/TimedMarkdown';

test('explicit video links retain ranges, descriptions and emphasis while plain timestamps stay canonical',()=>{
 const render=(content:string)=>renderToStaticMarkup(<TimedMarkdown content={content} duration={300} seek={()=>{}}/>);
 expect(render('[01:00–02:00](vcamp-time:60)')).toContain('>01:00–02:00</button>');
 expect(render('[**关键演示** 01:00–02:00](vcamp-time:60.25)')).toContain('<strong>关键演示</strong> 01:00–02:00');
 expect(render('[1:00](vcamp-time:60.25)')).toContain('>01:00</button>');
 expect(render('[查看片段](vcamp-time:400)')).toContain('时间超出视频时长');
 expect(render('简短回答，不附时间。')).not.toContain('answer-time');
});
