import {createRoot} from 'react-dom/client';
import {ChatMessages} from '../../src/workbench/ChatMessages';
import type {ApplicationClient} from '../../src/contracts/application';
import type {GenerationView} from '../../src/contracts/generation';

const template={templateId:'builtin-map',revisionId:'builtin-map:v4',revision:4,name:'交互学习页',description:'生成 HTML 页面',requirements:'按需求生成页面',outputType:'html' as const,defaultModelId:null,outputProtocol:'html-page-v1' as const};
const initial:GenerationView['messages']=[
  {messageId:'user',contentVersionId:'snapshot',role:'user',text:'',referenceSnapshotIds:[],attachmentIds:[],templateSnapshot:template,jobId:'00000000-0000-4000-8000-000000000001',attemptId:null,state:'completed'},
  {messageId:'note',contentVersionId:'note:1',role:'assistant',text:'',referenceSnapshotIds:[],attachmentIds:[],jobId:'00000000-0000-4000-8000-000000000002',attemptId:'00000000-0000-4000-8000-000000000012',state:'completed',outputType:'markdown',artifactId:'note-ready'},
  {messageId:'page',contentVersionId:'page:1',role:'assistant',text:'',referenceSnapshotIds:[],attachmentIds:[],jobId:'00000000-0000-4000-8000-000000000003',attemptId:'00000000-0000-4000-8000-000000000013',state:'completed',outputType:'html',artifactId:'page-ready'}
];
const pendingUser:GenerationView['messages'][number]={messageId:'pending-user',contentVersionId:'pending-snapshot',role:'user',text:'生成复习页',referenceSnapshotIds:[],attachmentIds:[],jobId:'00000000-0000-4000-8000-000000000004',attemptId:null,state:'completed'};
const pendingAssistant=(state:'committing'|'completed'):GenerationView['messages'][number]=>({messageId:'pending',contentVersionId:`pending:${state}`,role:'assistant',text:'',referenceSnapshotIds:[],attachmentIds:[],jobId:'00000000-0000-4000-8000-000000000004',attemptId:'00000000-0000-4000-8000-000000000014',state,outputType:'markdown',...(state==='completed'?{artifactId:'note-pending'}:{})});
const evidence:NonNullable<GenerationView['jobs'][number]['evidence']>={version:1,planningMode:'planned',plan:{version:1,interpretedIntent:'生成复习页',additionalSources:[],outputRequirements:['生成 Markdown 笔记']},includedSources:[],unavailableSources:[]};
const pendingJob=(state:'committing'|'completed')=>({jobId:'00000000-0000-4000-8000-000000000004',attemptId:'00000000-0000-4000-8000-000000000014',target:{kind:'chat' as const,workspaceId:'workspace',chatId:'chat'},seq:4,state,text:'',error:null,coverage:{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]},evidence});
let messages=initial,jobs:GenerationView['jobs']=[],pendingReady=false;
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const client:ApplicationClient={
  query:async()=>({mode:'interactive',workspaceId:'workspace',chatId:'chat',title:'test',draft:null}),
  command:async()=>({mode:'interactive',workspaceId:'workspace',chatId:'chat',title:'test',draft:null}),
  subscribe:()=>()=>{},
  artifacts:async()=>{await delay(300);return {artifacts:[
    {id:'note-ready',workspaceId:'workspace',sourceChatId:'chat',type:'markdown',title:'旧笔记',revision:1,revisionId:'note-rev',content:'# 旧笔记',sourceDeleted:false},
    ...(pendingReady?[{id:'note-pending',workspaceId:'workspace',sourceChatId:'chat',type:'markdown' as const,title:'新笔记',revision:1,revisionId:'pending-rev',content:'# 新笔记',sourceDeleted:false}]:[])
  ]};},
  knowledge:async()=>{await delay(300);return {artifacts:[{id:'page-ready',workspaceId:'workspace',sourceChatId:'chat',type:'html-page',pageVersion:1,title:'页面',revisionId:'page-rev',source:'<!doctype html><html><head><title>页面</title></head><body>页面</body></html>',sourceDeleted:false}]};}
};
const opened=document.createElement('output');opened.id='opened';document.body.append(opened);
const root=createRoot(document.getElementById('root')!);
const render=()=>root.render(<ChatMessages client={client} target={{workspaceId:'workspace',chatId:'chat'}} messages={messages} jobs={jobs} readonly={false} taskCommand={()=>{}} openNote={id=>{opened.textContent=id;}} openKnowledge={id=>{opened.textContent=id;}} openScribble={()=>{}}/>);
(window as any).startCommit=()=>{messages=[...initial,pendingUser,pendingAssistant('committing')];jobs=[pendingJob('committing')];render();};
(window as any).completePending=()=>{messages=[...initial,pendingUser,pendingAssistant('completed')];jobs=[pendingJob('completed')];render();};
(window as any).makePendingReady=()=>{pendingReady=true;};
render();
