import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { createEvidencePreparation } from '../../src/generation/evidence-preparation';
import { IndexedGenerationStore } from '../../src/data/generation-store';
import { IndexedWorkspaceStore } from '../../src/data/indexed-store';

const event = (content: string, reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: reason }] })}\n\n`;

test('requirements planning receives source types but no source content, then freezes only selected supplemental evidence', async () => {
  let planningBody = '';
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/x/web-interface/view')) return Response.json({ code: 0, data: { aid: 42, desc: 'PRIVATE_DESCRIPTION' } });
    if (url.includes('/x/player/v2')) return Response.json({ code: 0, data: { view_points: [{ content: 'PRIVATE_CHAPTER', from: 10, to: 20 }] } });
    if (url.includes('/x/v2/reply?')) return Response.json({ code: 0, data: { replies: [{ like: 99, content: { message: 'PRIVATE_COMMENT' } }] } });
    planningBody = String(init?.body ?? '');
    const plan = JSON.stringify({
      version: 1,
      interpretedIntent: '整理视频并结合观众反馈',
      additionalSources: [
        { source: 'video_chapters', reason: '组织结构' },
        { source: 'video_description', reason: '补充作者背景' },
        { source: 'hot_comments', reason: '用户要求观众反馈' },
        { source: 'conversation_history', reason: '理解连续追问' }
      ],
      outputRequirements: ['区分视频内容和观众观点']
    });
    return new Response(event(plan, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const preparation = createEvidencePreparation({ read: async () => ({ key: 'SYNTHETIC_KEY' }), write: async () => {} }, transport);
  const evidence = await preparation.prepare({
    source: { platform: 'bilibili', videoId: 'BVtest', partId: '7', title: 'PRIVATE_TITLE' },
    context: { request: '结合评论整理这期视频', outputType: 'markdown', modelId: 'fixture', templateRequirements: '形成复习笔记', hasConversationHistory: true }
  });
  const sent = JSON.parse(planningBody);
  const planningInput = JSON.stringify(sent.messages);
  expect(planningInput).toContain('video_title');
  expect(planningInput).toContain('subtitle');
  expect(planningInput).toContain('hot_comments');
  expect(planningInput).toContain('结合评论整理这期视频');
  expect(planningInput).not.toMatch(/PRIVATE_(TITLE|DESCRIPTION|CHAPTER|COMMENT)/);
  expect(evidence).toMatchObject({
    planningMode: 'planned',
    includedSources: ['video_chapters', 'video_description', 'hot_comments', 'conversation_history'],
    videoDescription: 'PRIVATE_DESCRIPTION',
    chapters: [{ title: 'PRIVATE_CHAPTER', from: 10, to: 20 }],
    hotComments: [{ content: 'PRIVATE_COMMENT', likes: 99 }]
  });

  const name = crypto.randomUUID(), spaces = new IndexedWorkspaceStore(name), jobs = new IndexedGenerationStore(name);
  const space = await spaces.open({ platform: 'bilibili', videoId: 'BVtest', partId: '7', title: '视频 · P1', videoTitle: '视频', partTitle: '第一章' });
  await spaces.save(space.id, 0, { ...space.draft, text: '继续', modelId: 'fixture' }, space.chatId);
  const job = await jobs.freezeChat({ kind: 'chat', workspaceId: space.id, chatId: space.chatId }, 1, { locator: 'x', fingerprint: 'y', language: 'zh', cueCount: 1, binding: { platform: 'bilibili', videoId: 'BVtest', partId: '7', tabId: 1, documentId: 'd', epoch: 1 } }, false, false, evidence);
  expect(job.snapshot).toMatchObject({ videoTitle: '视频', videoPartTitle: '第一章', evidence: { plan: { interpretedIntent: '整理视频并结合观众反馈' } } });
});

test('invalid planning output falls back to title, full subtitle and necessary history without fetching comments', async () => {
  let comments = 0;
  const transport: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/x/web-interface/view')) return Response.json({ code: 0, data: { aid: 42, desc: '简介' } });
    if (url.includes('/x/player/v2')) return Response.json({ code: 0, data: { view_points: [] } });
    if (url.includes('/x/v2/reply?')) { comments++; return Response.json({ code: 0, data: { replies: [] } }); }
    return new Response(event('{"bad":true}', 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const evidence = await createEvidencePreparation({ read: async () => ({ key: 'SYNTHETIC_KEY' }), write: async () => {} }, transport).prepare({
    source: { platform: 'bilibili', videoId: 'BVtest', partId: '7', title: '视频' },
    context: { request: '继续解释', outputType: 'chat', modelId: 'fixture', hasConversationHistory: true }
  });
  expect(evidence).toMatchObject({ planningMode: 'fallback', includedSources: ['conversation_history'], unavailableSources: [] });
  expect(comments).toBe(0);
});

test('template-required and @-enabled sources cannot be omitted by the planner and unavailable sources stay explicit',async()=>{
  let planningBody='';
  const transport:typeof fetch=async(input,init)=>{
    const url=String(input);
    if(url.includes('/x/web-interface/view'))return Response.json({code:0,data:{aid:42,desc:'简介'}});
    if(url.includes('/x/player/v2'))return Response.json({code:0,data:{view_points:[]}});
    if(url.includes('/x/v2/reply?'))return Response.json({code:0,data:{replies:[{like:7,content:{message:'模板要求的评论'}}]}});
    planningBody=String(init?.body??'');
    const plan=JSON.stringify({version:1,interpretedIntent:'只按字幕回答',additionalSources:[],outputRequirements:[]});
    return new Response(event(plan,'stop')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  const evidence=await createEvidencePreparation({read:async()=>({key:'SYNTHETIC_KEY'}),write:async()=>{}},transport).prepare({
    source:{platform:'bilibili',videoId:'BVtest',partId:'1',title:'视频'},
    context:{request:'分析争议画面',outputType:'chat',modelId:'fixture',requiredSources:['hot_comments','web'],explicitSources:['video_frames'],hasConversationHistory:false,hasFullSubtitles:true,canUseVideoFrames:true,canUseWeb:false}
  });
  const sent=JSON.parse(planningBody);
  expect(sent.messages.at(-1).content).toContain('requiredDataSources');
  expect(evidence).toMatchObject({includedSources:expect.arrayContaining(['full_subtitles','hot_comments','video_frames']),unavailableSources:['web'],hotComments:[{content:'模板要求的评论',likes:7}]});
  expect(evidence.sourceManifest).toEqual(expect.arrayContaining([
    expect.objectContaining({source:'hot_comments',policy:'required',selection:'included'}),
    expect.objectContaining({source:'video_frames',policy:'explicit',selection:'included'}),
    expect.objectContaining({source:'web',policy:'required',availability:'unavailable',selection:'unavailable'})
  ]));
});

test('video frame capability stays disclosed but unavailable until the user enables it for this draft',async()=>{
  let planningBody='';
  const transport:typeof fetch=async(input,init)=>{
    const url=String(input);
    if(url.includes('/x/web-interface/view'))return Response.json({code:0,data:{aid:42,desc:''}});
    if(url.includes('/x/player/v2'))return Response.json({code:0,data:{view_points:[]}});
    planningBody=String(init?.body??'');
    const plan=JSON.stringify({version:1,interpretedIntent:'分析字幕无法表达的画面',additionalSources:[{source:'video_frames',reason:'模型认为画面有帮助'}],outputRequirements:[]});
    return new Response(event(plan,'stop')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  const evidence=await createEvidencePreparation({read:async()=>({key:'SYNTHETIC_KEY'}),write:async()=>{}},transport).prepare({
    source:{platform:'bilibili',videoId:'BVtest',partId:'1',title:'视频'},
    context:{request:'分析画面',outputType:'chat',modelId:'fixture',requiredSources:['video_frames'],hasConversationHistory:false,hasFullSubtitles:true,canUseVideoFrames:false}
  });
  const input=JSON.parse(planningBody).messages.at(-1).content;
  expect(input).toContain('pluginDataCapabilities');
  expect(input).toContain('video_frames');
  expect(evidence.includedSources).not.toContain('video_frames');
  expect(evidence.unavailableSources).toContain('video_frames');
  expect(evidence.sourceManifest).toEqual(expect.arrayContaining([expect.objectContaining({source:'video_frames',policy:'required',availability:'unavailable',selection:'unavailable'})]));
});
