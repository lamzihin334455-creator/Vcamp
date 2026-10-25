import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedScribbleStore} from '../../src/data/scribble-store';
// Local fixtures only. No credentials, provider, HTTP or generation execution.
async function seed(){
const source={platform:'bilibili' as const,videoId:'BVrectifyLocal',partId:'101',title:'本地夹具 · 阅读与互动'};
const spaces=new IndexedWorkspaceStore(),tasks=new IndexedGenerationStore(),notes=new IndexedScribbleStore();
const a=await spaces.open(source),target={kind:'chat' as const,workspaceId:a.id,chatId:a.chatId};
await chrome.storage.local.set({'vcamp.test.video':source});
const html=`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>理解不同的叙述</title><style>*{box-sizing:border-box}body{margin:0;padding:20px;color:#203b36;background:#faf9f4;font:17px/1.8 system-ui;overflow-wrap:anywhere}h1{font:700 30px/1.3 Georgia,serif;margin:8px 0 20px}h2{font-size:21px;margin-top:30px}small{color:#43685a}button,select{font:inherit;padding:8px;color:#174e3d;background:#edf2e9;border:1px solid #9daea5;border-radius:5px}button:focus-visible,select:focus-visible{outline:3px solid #8e4c22}details{border-block:1px solid #b5c1b8;padding:12px 0}summary{cursor:pointer}p{margin:16px 0}</style></head><body><small>本地合成夹具 · 非真实模型成果</small><h1>同一件事，为何会有不同叙述？</h1><label>内容筛选 <select id="filter"><option value="all">全部内容</option><option value="video">视频观点</option><option value="explanation">补充解释</option></select></label><section data-basis="video"><h2>叙述与记忆</h2><p>不同叙述可能彼此矛盾。记忆和偏见会影响回忆；个体真诚的描述仍可能偏离事实。</p><details><summary>展开理解</summary><p>比较叙述时，先找出共同信息，再核查分歧的依据，而不是仅按讲述者的自信程度判断。</p></details></section><section data-basis="explanation"><h2>补充解释</h2><p>承认记忆存在局限，并不意味着所有观点都同样正确。独立证据和可核实的细节仍有价值。</p></section><h2>情境自测</h2><p>两个人都确信自己的记忆，就说明两种矛盾描述都是真实事实吗？</p><button id="answer">不一定</button><p id="feedback" aria-live="polite"></p><script>document.querySelector('#filter').onchange=e=>document.querySelectorAll('[data-basis]').forEach(s=>s.hidden=e.target.value!=='all'&&s.dataset.basis!==e.target.value);document.querySelector('#answer').onclick=()=>document.querySelector('#feedback').textContent='正确。真诚与准确是两个问题，需要进一步核查证据。';</script></body></html>`;
async function save(text:string,legacy=false){
 const row=(await spaces.read(a.id,a.chatId))!;await spaces.save(a.id,row.draft.revision,{...row.draft,text:'本地 HTML 夹具',outputType:'html',modelId:'fixture',template:legacy?{templateId:'builtin-map',revisionId:'builtin-map:v2'}:null},a.chatId);
 const job=await tasks.freezeChat(target,row.draft.revision+1,{binding:{...source,tabId:99,documentId:'fixture',epoch:1},locator:'local',fingerprint:'local',language:'zh',cueCount:1});
 const id=job.attempts[0].attemptId;await tasks.attach(job.jobId,id,99);const claimed=(await tasks.claim(job.jobId,id,99))!;await tasks.checkpoint(job.jobId,id,claimed.seq+1,text,{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});const artifactId=crypto.randomUUID();await tasks.finish(job.jobId,id,'completed',null,artifactId);return artifactId;
}
const pageId=await save(html);
await save(JSON.stringify({version:1,title:'旧知识兼容夹具',summary:'保留旧资料',groups:[{id:'g',title:'旧分类',items:[{id:'i',title:'旧条目',body:'旧资料正文继续可读。',basis:'video',question:'进一步理解'}]}],concepts:[],relations:[],questions:[]}),true);
await notes.create(a.id,'较晚的随笔',30);await notes.create(a.id,'最早的随笔',5);await notes.create(a.id,'中间的随笔',16);await notes.create(a.id,'没有时间的旧式记录',null);
document.querySelector('#status')!.textContent=JSON.stringify({workspaceId:a.id,pageId,chatId:a.chatId});

}void seed().catch(()=>{document.querySelector('#status')!.textContent='fixture failed';});
