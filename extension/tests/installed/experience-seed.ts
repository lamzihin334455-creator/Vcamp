// Synthetic fixtures through public semantic stores, in a disposable profile.
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';
import {IndexedGenerationStore} from '../../src/data/generation-store';
import {IndexedScribbleStore} from '../../src/data/scribble-store';
import {IndexedArtifactStore} from '../../src/data/artifact-store';
import {IndexedAttachmentStore} from '../../src/data/attachment-store';
async function seed(){
  const spaces=new IndexedWorkspaceStore(),tasks=new IndexedGenerationStore();
  const source={platform:'bilibili' as const,videoId:'BVexperience',partId:'11',title:'体验修复本地夹具',videoTitle:'体验修复本地夹具',pageNumber:1,partCount:2,partTitle:'第一部分',coverUrl:'https://i0.hdslb.com/bfs/archive/fixture.png'};
  const a=await spaces.open(source),b=await spaces.open({...source,partId:'12',pageNumber:2,partTitle:'第二部分'});
  const other=await spaces.open({...source,videoId:'BVotherVideo',partId:'51',partCount:1,title:'其他视频',videoTitle:'其他视频'});await new IndexedScribbleStore().create(other.id,'其他视频私有资料',1);
  const basis={binding:{platform:source.platform,videoId:source.videoId,partId:source.partId,tabId:99,documentId:'fixture',epoch:1},locator:'local',fingerprint:'local',language:'zh-CN',cueCount:1};
  const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const paint=canvas.getContext('2d')!;paint.fillStyle='#2f8f62';paint.fillRect(0,0,2,2);
  await new IndexedAttachmentStore().add({workspaceId:a.id,chatId:a.chatId},basis.binding,0,{dataUrl:canvas.toDataURL('image/png'),width:2,height:2,time:1.234});
  async function save(outputType:'chat'|'markdown'|'html',text:string){
    const row=(await spaces.read(a.id,a.chatId))!;await spaces.save(a.id,row.draft.revision,{...row.draft,text:'夹具请求 '+outputType,outputType,modelId:'local-fixture'},a.chatId);
    if(outputType==='markdown'&&text.startsWith('# 阅读与定位'))await new IndexedAttachmentStore().add({workspaceId:a.id,chatId:a.chatId},basis.binding,row.draft.revision+1,{dataUrl:canvas.toDataURL('image/png'),width:2,height:2,time:1.234});
    const savedDraft=(await spaces.read(a.id,a.chatId))!;
    const job=await tasks.freezeChat({kind:'chat',workspaceId:a.id,chatId:a.chatId},savedDraft.draft.revision,basis,true),attempt=job.attempts[0].attemptId;
    await tasks.attach(job.jobId,attempt,99);const claimed=(await tasks.claim(job.jobId,attempt,99))!;
    await tasks.checkpoint(job.jobId,attempt,claimed.seq+1,text,{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});const id=crypto.randomUUID();await tasks.finish(job.jobId,attempt,'completed',null,id);return id;
  }
  await save('chat','视频依据 [00:01]。代码 `[00:05]` 不转链接。');
  const noteId=await save('markdown','# 阅读与定位 [00:01]\n\n## 依据\n\n- 列表 [00:02] **关键解释**\n- 普通比率 4:3、钟点 12:30 不跳转\n\n正文 [现有链接](vcamp-time:3.25)，视频 00:04。\n\n> 引用说明与来源区分。\n\n```js\nconst time = "[00:05]";\n```\n\nhttps://example.com/[00:06]\n\n| 视频依据 | 补充解释 |\n| --- | --- |\n| 原材料陈述 | 解释需区分来源 |');
  const wrappedId=await save('markdown','```markdown\n# 包装笔记\n\n## 层级\n\n正文 [00:02] 与 **加粗**。\n```');
  const html=`<!doctype html><html><head><title>本地导航页面</title><style>body{font:17px/1.7 sans-serif;margin:16px}a{display:block;margin:12px 0}button{font:inherit}section{margin-top:900px}</style></head><body><h1>导航与来源</h1><p>视频 00:02</p><button data-time="3.25"><span>00:03</span></button><span class="timestamp">00:04</span><a href="#目标">中文锚点</a><a href="#%E7%9B%AE%E6%A0%87">编码锚点</a><a href="#不存在">缺失锚点</a><a href="vcamp-time:3600">视频时间</a><a href="https://example.com/reference">外部资料</a><a href="javascript:alert(1)">不支持链接</a><button id="dynamic">添加动态链接</button><div id="links"></div><section><h2 id="目标">目标解释</h2></section><script>document.querySelector('#dynamic').onclick=()=>{const a=document.createElement('a');a.href='#目标';a.textContent='动态锚点';document.querySelector('#links').append(a);};parent.postMessage({type:'vcamp.html.action',token:'forged',kind:'seek',time:1},'*');</script></body></html>`;
  const htmlId=await save('html',html.replace('<h1>导航与来源</h1>','<h1>导航与来源</h1><p>历史时间 [66:32]；无效时间 [00:60]</p>'));
  await new IndexedScribbleStore().create(a.id,'定位随笔',5.25);await new IndexedScribbleStore().create(a.id,'未选同 P 随笔',null);await new IndexedScribbleStore().create(b.id,'不应混入的 P2 随笔',1);
  async function subtitle(type:'enhance'|'translate',language:string,upstream?:string){
    const job=await tasks.freezeSubtitle({snapshotId:crypto.randomUUID(),target:{kind:'subtitle',workspaceId:a.id,operation:type},source:upstream?{subtitleVersionId:upstream}:{locator:'local',fingerprint:'local'},targetLanguage:language,requirements:'',modelId:'local-fixture'},{...basis,...(upstream?{subtitleVersionId:upstream,language:type==='enhance'?'zh-CN':'en'}:{})});
    const attempt=job.attempts[0].attemptId;await tasks.attach(job.jobId,attempt,99);const claimed=(await tasks.claim(job.jobId,attempt,99))!;
    await tasks.checkpoint(job.jobId,attempt,claimed.seq+1,'',{total:1,covered:1,ranges:[{firstCue:0,lastCue:0}]});const id=crypto.randomUUID();await tasks.finish(job.jobId,attempt,'completed',null,id,{kind:'subtitle',cues:[{from:1.234,to:3.456,content:type==='enhance'?'增强内容':'翻译内容'}]});return id;
  }
  const enhanced=await subtitle('enhance','zh-CN'),translated=await subtitle('translate','en',enhanced),retranslated=await subtitle('translate','ja',translated);
  document.querySelector('#status')!.textContent=JSON.stringify({workspaceId:a.id,chatId:a.chatId,noteId,wrappedId,htmlId,enhanced,translated,retranslated,otherWorkspace:b.id});
}
void seed().catch(e=>{document.querySelector('#status')!.textContent=String(e);});
