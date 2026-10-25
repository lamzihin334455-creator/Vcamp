import {expect,test} from 'vitest';
import {htmlEnvelope,parseHtmlPage} from '../../src/contracts/html-page';
import {runChat} from '../../src/generation/run-chat';
import {createProviderPort} from '../../src/generation/provider-port';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';
import type {GenerationDiagnostic} from '../../src/contracts/generation-diagnostic';

const page='<!doctype html><html><head><title>学习页</title></head><body><button>展开</button></body></html>';
const snapshot:ChatRequestSnapshot={snapshotId:'fixture',target:{kind:'chat',workspaceId:'w',chatId:'c'},input:'生成学习页',outputType:'html',htmlFormat:1,modelId:'local-text',webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[]};

test('short explanation and one explicit HTML fence use the same provider diagnostic and saved-page parser',async()=>{
  const response='下面是学习页。\n```html\n'+page+'\n```\n可在页内展开解释。';
  const diagnostics:GenerationDiagnostic[]=[];let output='';
  await runChat(snapshot,[{from:0,to:1,content:'字幕夹具'}],createProviderPort('LOCAL_FIXTURE_TOKEN',async()=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:response},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}),undefined,async d=>{diagnostics.push(d);}),new AbortController().signal,async value=>{output=value;});
  expect.soft(diagnostics[0]).toMatchObject({purpose:'html-page',cause:'stop',htmlEnvelope:'complete'});
  expect(parseHtmlPage(output)).toEqual({source:page,title:'学习页'});
});

test.each([
  ['direct',page,page],
  ['whole fence','```html\n'+page+'\n```',page],
  ['whole fence blank lines','```html\n\n'+page+'\n\n```',page],
  ['CRLF and case','说明\r\n```HTML\r\n'+page.toUpperCase()+'\r\n```\r\n结束',page.toUpperCase()],
  ['original interior whitespace','前言\n```html\n'+page.replace('<body>','<body>\r\n  ')+'\n```',page.replace('<body>','<body>\r\n  ')],
  ['outside bound inclusive','x'.repeat(1023)+'\n```html\n'+page+'\n```',page],
  ['total bound inclusive',page.replace('<body>','<body>'+'x'.repeat(4000000-page.length)),page.replace('<body>','<body>'+'x'.repeat(4000000-page.length))],
])('%s preserves the extracted source',(_name,input,source)=>{
  expect(htmlEnvelope(input)).toBe('complete');expect(parseHtmlPage(input).source).toBe(source);
});

test.each([
  ['two fences','```html\n'+page+'\n```\n```html\n'+page+'\n```'],
  ['two documents in one fence','```html\n'+page+page+'\n```'],
  ['two direct documents',page+page],
  ['extra code block','```js\nlet n=1;\n```\n```html\n'+page+'\n```'],
  ['extra outside document',page+'\n```html\n'+page+'\n```'],
  ['missing tail','说明\n```html\n'+page.replace('</body></html>','')+'\n```'],
  ['missing head',page.replace(/<head>.*<\/head>/,'')],
  ['missing title',page.replace('<title>学习页</title>','')],
  ['title outside head',page.replace('<title>学习页</title>','').replace('<body>','<body><title>假标题</title>')],
  ['no HTML','说明文字'],
  ['wrong language fence','```javascript\n'+page+'\n```'],
  ['unfinished fence','说明\n```html\n'+page],
  ['malformed close','```html\n'+page+'\n``'],
  ['inline fence','说明 ```html\n'+page+'\n```'],
  ['outside too long','x'.repeat(1024)+'\n```html\n'+page+'\n```'],
  ['total too long',page+' '.repeat(4000001-page.length)],
  ['wrapper cannot hide total limit','x\n```html\n'+page.replace('<body>','<body>'+'x'.repeat(4000000-page.length))+'\n```'],
])('%s is refused consistently',(_name,input)=>{
  expect(htmlEnvelope(input)).not.toBe('complete');expect(()=>parseHtmlPage(input)).toThrowError('html-format');
});
