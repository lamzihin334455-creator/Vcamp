// Test build only: synthetic model response through real provider/runChat/store.
// No credentials or network; runs only in a disposable browser profile.
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedKnowledgeStore} from '../../src/data/knowledge-store';
import {runChat} from '../../src/generation/run-chat';
import {createProviderPort} from '../../src/generation/provider-port';
import type {ChatRequestSnapshot} from '../../src/contracts/generation';

async function seed(){
  const source={platform:'bilibili' as const,videoId:'BVhtmlCompat',partId:'1',title:'外层格式兼容夹具'};
  await chrome.storage.local.set({'vcamp.test.video':source});
  const spaces=new IndexedWorkspaceStore(),tasks=new IndexedGenerationStore(),pages=new IndexedKnowledgeStore();
  const a=await spaces.open(source),target={kind:'chat' as const,workspaceId:a.id,chatId:a.chatId};
  await spaces.save(a.id,0,{...a.draft,text:'生成交互学习页',outputType:'html',modelId:'local-fixture'},a.chatId);
  const job=await tasks.freezeChat(target,1,{binding:{...source,tabId:99,documentId:'fixture',epoch:1},locator:'local',fingerprint:'local',language:'zh',cueCount:1}),attempt=job.attempts[0].attemptId;
  await tasks.attach(job.jobId,attempt,99);await tasks.claim(job.jobId,attempt,99);
  const html='<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>格式兼容学习页</title><style>body{margin:20px;font:17px/1.7 system-ui;color:#203b36;background:#faf9f4}button{font:inherit;padding:10px}button:focus-visible{outline:3px solid #8e4c22}</style></head><body><h1>记忆与依据</h1><p>本地合成夹具。叙述的自信程度不等于证据充分。</p><button id="expand">展开解释</button><p id="explanation" hidden>比较叙述时，应核查独立依据。</p><script>document.querySelector("#expand").onclick=()=>document.querySelector("#explanation").hidden=false;</script></body></html>';
  const wrapped='以下为可交互学习页。\r\n```HTML\r\n'+html+'\r\n```\r\n点击按钮展开解释。';
  let calls=0;
  const provider=createProviderPort('LOCAL_SYNTHETIC_TOKEN',async()=>{
    calls++;return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:wrapped},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  },undefined,async d=>{await tasks.diagnostic(job.jobId,attempt,d);});
  await runChat(job.snapshot as ChatRequestSnapshot,[{from:0,to:1,content:'叙述的自信程度不等于证据充分。'}],provider,new AbortController().signal,async(text,coverage)=>{
    const current=(await tasks.get(job.jobId))!;await tasks.checkpoint(job.jobId,attempt,current.seq+1,text,coverage);
  });
  const pageId=crypto.randomUUID();await tasks.finish(job.jobId,attempt,'completed',null,pageId);
  const saved=(await pages.list(a.id,pageId,true))[0],finished=(await tasks.get(job.jobId))!;
  document.querySelector('#status')!.textContent=JSON.stringify({workspaceId:a.id,pageId,state:finished.attempts[0].state,diagnostic:finished.attempts[0].diagnostics?.[0],sourceExact:saved.type==='html-page'&&saved.source===html,calls,externalModelCalls:0});
}
void seed().catch(e=>{document.querySelector('#status')!.textContent='fixture failed: '+String(e);});
