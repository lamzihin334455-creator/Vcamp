import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createProviderPort,type ProviderPort} from '../../src/generation/provider-port';
import {planVisualEvidence,visionPlanningInput} from '../../src/generation/vision-planning';
import {fixedPrompt,fixedPromptVersion} from '../../src/prompts/fixed-rules';
import {runRealVideo} from './vision-real-video';

export async function runWorkflow(directory:string,key:string){
  const input=JSON.parse((await readFile(resolve(directory,'input.json'),'utf8')).replace(/^\uFEFF/,''));
  const ledgerPath=resolve(directory,'call-ledger.json'),ledger=JSON.parse((await readFile(ledgerPath,'utf8')).replace(/^\uFEFF/,''));
  if(ledger.authorizedLimit!==59||ledger.currentBatch?.additionalLimit!==30||ledger.currentBatch?.startRequestsUsed!==29)throw Error('unauthorized-ledger');
  const start=ledger.requestsUsed,out=resolve(directory,`workflow-${start+1}`);await mkdir(out,{recursive:true});
  let diagnostic:unknown;
  const port=createProviderPort(key,fetch,undefined,async d=>{diagnostic=d;});
  const provider:ProviderPort={async stream(...args){
    if(ledger.requestsUsed>=ledger.authorizedLimit)throw Error('authorized-call-limit');
    ledger.requestsUsed++;ledger.completionCalls++;
    const entry:Record<string,unknown>={purpose:args[4],status:'started',scope:'full-visual-workflow-independent',startedAt:new Date().toISOString(),promptVersion:fixedPromptVersion};ledger.requests.push(entry);await writeFile(ledgerPath,JSON.stringify(ledger,null,2));diagnostic=undefined;
    let output='';try{await port.stream(args[0],args[1],args[2],async delta=>{output+=delta;await args[3](delta);},args[4]);entry.status='complete';}catch(error){entry.status='failed';throw error;}finally{entry.diagnostic=diagnostic;await writeFile(ledgerPath,JSON.stringify(ledger,null,2));if(output)await writeFile(resolve(out,`response-${ledger.requestsUsed}.txt`),output);}
  }};
  const messages=[{role:'system' as const,content:fixedPrompt({kind:'vision-plan',duration:input.duration,maxFrames:6,preauthorized:true})},{role:'user' as const,content:visionPlanningInput(input.task,input.cues)}];
  const planned=await planVisualEvidence({provider,modelId:input.modelId,messages,signal:AbortSignal.timeout(60000),duration:input.duration,cues:input.cues,imageIds:[],tokenAllowance:196608,maxNewFrames:6});
  await writeFile(resolve(out,'planning-result.json'),JSON.stringify({promptVersion:fixedPromptVersion,...planned},null,2));
  if(!('plan' in planned.result))throw Error('planning-did-not-pass');
  await writeFile(resolve(out,'plan-response.json'),planned.output);
  process.stdout.write(`Workflow plan: ${planned.result.plan.evidence.length} groups; requests ${start+1}-${ledger.requestsUsed}\n`);
  await runRealVideo(directory,key,false,{planResponse:resolve(out,'plan-response.json'),outputDirectory:out});
}
