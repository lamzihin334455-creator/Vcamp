// Full production executor in a disposable extension/profile. Actual public
// video + captured native subtitles + real API, delivered on a controlled page.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setup} from '../e2e/interaction-fixture';
import {expect} from '@playwright/test';

export async function runExtensionWorkflow(directory:string,key:string){
  const input=JSON.parse((await readFile(resolve(directory,'input.json'),'utf8')).replace(/^\uFEFF/,''));
  const ledgerPath=resolve(directory,'call-ledger.json'),ledger=JSON.parse((await readFile(ledgerPath,'utf8')).replace(/^\uFEFF/,''));
  if(!Number.isSafeInteger(ledger.authorizedLimit)||!Number.isSafeInteger(ledger.requestsUsed)||!Number.isSafeInteger(ledger.currentBatch?.startRequestsUsed)||!Number.isSafeInteger(ledger.currentBatch?.additionalLimit)||ledger.currentBatch.additionalLimit<=0||ledger.authorizedLimit!==ledger.currentBatch.startRequestsUsed+ledger.currentBatch.additionalLimit||ledger.requestsUsed<ledger.currentBatch.startRequestsUsed||ledger.requestsUsed>=ledger.authorizedLimit)throw Error('unauthorized-or-exhausted-ledger');
  const webEnabled=process.env.VCAMP_LIVE_WEB!=='0';
  const out=resolve(directory,`extension-workflow-${ledger.requestsUsed+1}`);await mkdir(out,{recursive:true});
  const requests:{number:number;path:string;kind:string;images:number}[]=[];
  const replayName=process.env.VCAMP_REPLAY_PREPARATION;
  if(replayName&&!/^extension-workflow-\d+$/.test(replayName))throw Error('invalid-replay-directory');
  // Reuse only complete, unmodified upstream responses from an earlier real
  // run. Final answers go to the real API anew. An explicitly reused review
  // below must match the actual pixels, times and targets byte for byte.
  const upstream=['requirements-plan','web-query','web-search','vision-plan'];
  const replays=replayName?JSON.parse(await readFile(resolve(directory,replayName,'requests.json'),'utf8')).filter((r:any)=>upstream.includes(r.kind)):[];
  const replayed:{kind:string;originalNumber:number;from:string}[]=[];
  const reviewReplay=process.env.VCAMP_REPLAY_REVIEW;
  if(reviewReplay&&!/^extension-workflow-\d+:\d+$/.test(reviewReplay))throw Error('invalid-review-replay');
  const server=createServer(async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    if(req.method==='OPTIONS'){res.end();return;}
    try{
      if(req.method!=='POST'||req.url!=='/relay')throw Error('invalid-relay');
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const packet=JSON.parse(Buffer.concat(chunks).toString('utf8')),url=new URL(packet.url);
      if(url.origin!=='https://api.deepseek.com'||!['/models','/chat/completions','/v1/chat/completions','/v1/tools/search'].includes(url.pathname)||!['GET','POST'].includes(packet.method))throw Error('unexpected-api-target');
      if(packet.method==='GET'&&process.env.VCAMP_REUSE_MODEL_CATALOG==='1'){
        const catalog=await readFile(resolve(directory,'extension-workflow-45/response-45.txt'));
        res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(catalog);return;
      }
      const body=packet.body?JSON.parse(packet.body):undefined,system=String(body?.messages?.[0]?.content??'');
      const kind=packet.method==='GET'?'models':url.pathname.includes('/tools/search')?'web-search':['requirements-plan','vision-plan','vision-review','web-query'].find(id=>system.includes(`[P1:${id}]`))??'answer';
      if(replayName&&upstream.includes(kind)){
        const previous=replays.shift();if(previous?.kind!==kind)throw Error('replay-stage-mismatch');
        const response=await readFile(resolve(directory,replayName,`response-${previous.number}.txt`));
        replayed.push({kind,originalNumber:previous.number,from:replayName});
        res.writeHead(200,{'Content-Type':kind==='web-search'?'application/json':'text/event-stream','Access-Control-Allow-Origin':'*'});res.end(response);return;
      }
      if(kind==='vision-review'&&reviewReplay){
        const [from,number]=reviewReplay.split(':'),prior=JSON.parse(await readFile(resolve(directory,from,'job.json'),'utf8'));
        const parts=body.messages[1].content,input=JSON.parse(parts[0].text),images=parts.filter((p:any)=>p.type==='image_url');
        if(images.length!==prior.visual.review.images.length||input.targets.length!==prior.visual.review.results.length)throw Error('review-replay-coverage');
        for(const [i,record] of prior.visual.review.images.entries()){
          if(input.images[i].ref!==record.ref||input.images[i].time!==record.time||input.images[i].slotKey!==record.slotKey)throw Error('review-replay-timing');
          const bytes=await readFile(resolve(directory,from,`${record.slotKey}.png`));
          if(!Buffer.from(images[i].image_url.url.split(',')[1],'base64').equals(bytes))throw Error('review-replay-pixels');
        }
        for(const t of input.targets){
          const e=prior.visual.evidencePlan.evidence.find((e:any)=>e.id===t.evidenceId);
          if(!e||e.need!==t.need||e.mode!==t.mode||JSON.stringify(t.checks.map((c:any)=>c.need))!==JSON.stringify(e.checkTargets))throw Error('review-replay-targets');
        }
        const response=await readFile(resolve(directory,from,`response-${number}.txt`));
        replayed.push({kind,originalNumber:Number(number),from});
        res.writeHead(200,{'Content-Type':'text/event-stream','Access-Control-Allow-Origin':'*'});res.end(response);return;
      }
      if(ledger.requestsUsed>=ledger.authorizedLimit)throw Error('authorized-call-limit');
      const number=++ledger.requestsUsed;ledger.completionCalls+=packet.method==='POST'?1:0;
      const images=(body?.messages??[]).flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((p:any)=>p.type==='image_url').length;
      requests.push({number,path:url.pathname,kind,images});
      const entry:Record<string,unknown>={purpose:kind,scope:'production-extension-real-api',startedAt:new Date().toISOString(),status:'started'};ledger.requests.push(entry);await writeFile(ledgerPath,JSON.stringify(ledger,null,2));
      process.stdout.write(`Extension request ${number}: ${kind}; ${images} image(s)\n`);
      const response=await fetch(url,{method:packet.method,headers:{Authorization:`Bearer ${key}`,...(packet.body?{'Content-Type':'application/json'}:{})},...(packet.body?{body:packet.body}:{}),signal:AbortSignal.timeout(60000)});
      res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'application/json','Access-Control-Allow-Origin':'*'});
      const parts:Buffer[]=[];for await(const chunk of response.body as any){const bytes=Buffer.from(chunk);parts.push(bytes);res.write(bytes);}res.end();
      const raw=Buffer.concat(parts).toString('utf8');if(!raw.includes(key))await writeFile(resolve(out,`response-${number}.txt`),raw);
      Object.assign(entry,{status:'complete',httpStatus:response.status});await writeFile(ledgerPath,JSON.stringify(ledger,null,2));
    }catch{if(!res.headersSent)res.writeHead(502);res.end('{}');}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  let fixture:Awaited<ReturnType<typeof setup>>|undefined;
  try{
    fixture=await setup({mediaPath:resolve(directory,'public-video-480p.mp4'),cues:input.cues,title:input.task.videoTitle,relayOrigin:origin});
    const {page,site,worker}=fixture;
    await worker.evaluate(origin=>{
      const original=fetch;
      globalThis.fetch=(async(input:any,init:any)=>String(input).startsWith('https://api.deepseek.com/')?original(origin+'/relay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:String(input),method:init?.method??'GET',body:init?.body})}):original(input,init)) as typeof fetch;
    },origin);
    const command=(operation:any)=>page.evaluate(operation=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation}),operation);
    const initial=(await command({type:'workspace.query'})).view;
    const subtitles=(await command({type:'subtitles.query',workspaceId:initial.workspaceId})).view.subtitles;
    const native=await command({type:'subtitles.source.select',workspaceId:initial.workspaceId,source:{kind:'native',language:'zh-CN'},expectedRevision:subtitles.sourceRevision});if(!native.ok)throw Error('native-selection');
    const saved=await command({type:'provider.save-key',providerId:'deepseek',expectedRevision:0,key:'ISOLATED_RELAY_KEY'});if(!saved.ok)throw Error('save-key');
    const fetched=await command({type:'provider.fetch',expectedRevision:1});if(!fetched.ok)throw Error('models');
    const selected=await command({type:'provider.default',expectedRevision:fetched.view.provider.revision,modelId:input.modelId});if(!selected.ok)throw Error('model-selection');
    const current=(await command({type:'workspace.query'})).view;
    const created=(await command({type:'chat.create',workspaceId:current.workspaceId})).view;
    const templates=(await command({type:'template.query'})).view.templates.templates;
    const template=templates.find((t:any)=>t.name==='快速总结');if(!template)throw Error('summary-template');
    const draftResult=await command({type:'draft.save',target:{workspaceId:created.workspaceId,chatId:created.chatId},expectedRevision:created.draft.revision,draft:{...created.draft,text:'',template:{templateId:template.id,revisionId:template.revisionId},modelId:input.modelId,visionEnabled:true,webEnabled}});if(!draftResult.ok)throw Error('draft');
    await page.reload();await site.bringToFront();
    const initialPlayback=await site.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,paused:v.paused,fullscreen:!!document.fullscreenElement}));
    await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();await page.getByRole('button',{name:'发送',exact:true}).click();
    const target={kind:'chat',workspaceId:created.workspaceId,chatId:created.chatId};
    const query=async()=>{const response=await command({type:'generation.query',target});return response.view.generation.jobs.at(-1);};
    const deadline=Date.now()+180000;let job:any,last='';const authorized=new Set<string>();
    while(Date.now()<deadline){
      job=await query();const progress=job?`${job.state}/${job.visual?.phase??''}`:'starting';if(progress!==last){process.stdout.write(`Extension: ${progress}\n`);last=progress;}
      if(job?.state==='awaiting-permission'&&!job.visual?.resolution){
        const decision=job.visual?.review?.repairDecision==='pending'?'repair':'initial';
        if(authorized.has(decision)){await new Promise(resolve=>setTimeout(resolve,250));continue;}
        authorized.add(decision);
        if(job.visual?.review?.repairDecision==='pending')await page.getByRole('button',{name:'授权补充画面',exact:true}).click();
        else if(job.visual?.issue==='permission')await page.getByRole('button',{name:'授权原视频取帧',exact:true}).click();
        else break;
      }
      if(job&&['completed','failed','stopped','interrupted'].includes(job.state))break;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    const generation=(await command({type:'generation.query',target})).view.generation;
    await writeFile(resolve(out,'job.json'),JSON.stringify(job,null,2));await writeFile(resolve(out,'messages.json'),JSON.stringify(generation.messages,null,2));await writeFile(resolve(out,'requests.json'),JSON.stringify(requests,null,2));await writeFile(resolve(out,'replayed-preparation.json'),JSON.stringify(replayed,null,2));
    await writeFile(resolve(out,'answer.md'),String(job?.text??''));
    const attachments=await command({type:'attachment.read',target:{workspaceId:created.workspaceId,chatId:created.chatId},ids:job?.visual?.attachmentIds??[],historyOnly:true});
    if(attachments.ok)for(const image of attachments.view.attachment.images){const frame=job.visual.audit.frames.find((f:any)=>f.attachmentId===image.id);if(frame)await writeFile(resolve(out,`${frame.slotKey}.png`),Buffer.from(image.dataUrl.split(',')[1],'base64'));}
    const state=await site.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,paused:v.paused,fullscreen:!!document.fullscreenElement}));
    await writeFile(resolve(out,'playback.json'),JSON.stringify({before:initialPlayback,after:state},null,2));
    expect(state).toEqual(initialPlayback);
    await page.setViewportSize({width:1050,height:1500});await page.screenshot({path:resolve(out,'answer.png'),fullPage:true});
    await page.locator('.visual-evidence > summary').last().click();await page.locator('.visual-evidence').last().screenshot({path:resolve(out,'audit.png')});
    if(job?.state!=='completed'||job.visual?.review?.status!=='complete'||job.visual?.review?.checksVersion!==1||job.visual.review.results.some((r:any)=>!r.checks?.length)||job.visual?.audit?.frames?.length<3)throw Error('full-workflow-did-not-pass');
    if(webEnabled?(!job.webEvidence?.executionLinked||!job.webEvidence?.sources?.length):(job.webEvidence?.sources?.length||requests.some(r=>r.kind==='web-search'||r.kind==='web-query')))throw Error('web-boundary');
    if(![60,82,100].every(from=>job.visual.audit.frames.some((f:any)=>f.time>=from&&f.time<=from+(from===60?15:from===82?13:10))))throw Error('critical-state-missing');
    if(replays.length)throw Error('unused-replay-stages');
    process.stdout.write(`FULL EXTENSION PASS: ${requests.length} new real API requests; ${replayed.length} reused real responses; ${job.visual.audit.frames.length} frames; per-target review complete; web ${webEnabled?'retrieved':'off'}; playback ${state.time}\n`);
  }catch(error){
    const safe=String(error).split(key).join('[REDACTED]');await writeFile(resolve(out,'harness-error.txt'),safe);
    if(fixture){try{const view=await fixture.page.evaluate(()=>chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),operation:{type:'workspace.query'}}));await writeFile(resolve(out,'last-view.json'),JSON.stringify(view,null,2));await fixture.page.screenshot({path:resolve(out,'failure.png'),fullPage:true});}catch{}}
    throw error;
  }finally{await fixture?.context.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
