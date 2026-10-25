// Explicitly invoked live qualification. This is excluded from npm test and
// uses the production endpoint, stream parser, prompt and proposal boundary.
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {z} from 'zod';
import {cueSchema} from '../../src/contracts/video';
import {modelIdSchema} from '../../src/contracts/provider';
import {createProviderPort,ProviderError} from '../../src/generation/provider-port';
import {planVisualEvidence,visionPlanningInput} from '../../src/generation/vision-planning';
import {fixedPrompt,fixedPromptVersion} from '../../src/prompts/fixed-rules';
import type {GenerationDiagnostic} from '../../src/contracts/generation-diagnostic';

const inputSchema=z.object({
  format:z.literal('vcamp-live-vision-input-v1'),
  modelId:modelIdSchema,
  videoUrl:z.url().refine(s=>{const u=new URL(s);return u.protocol==='https:'&&u.hostname==='www.bilibili.com'&&u.pathname.startsWith('/video/');}),
  duration:z.number().finite().positive(),
  cues:z.array(cueSchema).min(1).max(50000),
  task:z.object({request:z.string().min(1).optional(),videoTitle:z.string().min(1)}).passthrough()
}).strict();

export async function runLiveVision(inputPath:string,resultPath:string,key:string,tasks=3){
  if(!Number.isSafeInteger(tasks)||tasks<1||tasks>3)throw Error('invalid-task-count');
  const input=inputSchema.parse(JSON.parse((await readFile(inputPath,'utf8')).replace(/^\uFEFF/,'')));
  if(input.cues.some(c=>c.to<=c.from||c.to>input.duration))throw Error('input-cue-range');
  if(!/^[\x21-\x7e]{1,256}$/.test(key))throw Error('missing-or-invalid-local-key');
  if(JSON.stringify(input).includes(key))throw Error('credential-in-input');
  const messages=[
    {role:'system' as const,content:fixedPrompt({kind:'vision-plan',duration:input.duration,maxFrames:6,preauthorized:true})},
    {role:'user' as const,content:visionPlanningInput(input.task,input.cues)}
  ];
  const results:unknown[]=[];
  let calls=0;
  const directory=dirname(resultPath),ledgerPath=resolve(directory,'call-ledger.json');
  const ledger=JSON.parse(await readFile(ledgerPath,'utf8'));
  if(![20,30].includes(ledger.authorizedLimit)||!Number.isSafeInteger(ledger.requestsUsed)||ledger.requestsUsed<0||!Array.isArray(ledger.requests))throw Error('missing-or-invalid-call-ledger');
  // Three independent tasks, each allowing the product's one bounded format
  // correction. No retry after a failed task and no transport retry.
  for(let index=0;index<tasks;index++){
    let output='';const diagnostics:GenerationDiagnostic[]=[];
    const port=createProviderPort(key,fetch,undefined,async d=>{diagnostics.push(d);});
    const provider:typeof port={async stream(...args){
      if(ledger.requestsUsed>=ledger.authorizedLimit)throw Error('authorized-call-limit-reached');
      calls++;ledger.requestsUsed++;ledger.completionCalls++;
      const entry={purpose:'vision-plan',status:'started',startedAt:new Date().toISOString(),promptVersion:fixedPromptVersion} as Record<string,unknown>;
      ledger.requests.push(entry);await writeFile(ledgerPath,JSON.stringify(ledger,null,2));
      try{await port.stream(...args);entry.status='complete';}catch(error){entry.status='failed';throw error;}
      finally{entry.diagnostic=diagnostics.at(-1);await writeFile(ledgerPath,JSON.stringify(ledger,null,2));}
    }};
    let outcome:Record<string,unknown>;
    try{
      const planned=await planVisualEvidence({provider,modelId:input.modelId,messages,signal:AbortSignal.timeout(60000),duration:input.duration,cues:input.cues,imageIds:[],tokenAllowance:196608,onInvalid:async(raw,failure)=>{await writeFile(resolve(directory,`response-${ledger.requestsUsed}.txt`),raw);await writeFile(resolve(directory,`failure-${ledger.requestsUsed}.json`),JSON.stringify(failure));}});
      output=planned.output;const parsed=planned.result;
      outcome='plan' in parsed?{status:'passed',evidenceCount:parsed.plan.evidence.length,unresolved:parsed.plan.unresolved,samplingNotes:parsed.samplingNotes??[],correction:planned.correction}:{status:'failed',planningFailure:parsed.failure,correction:planned.correction};
    }catch(error){outcome={status:'failed',providerFailure:error instanceof ProviderError?error.code:'local-failure'};}
    if(output)await writeFile(resolve(directory,`response-${ledger.requestsUsed}.txt`),output);
    results.push({...outcome,diagnostics});
    const report={format:'vcamp-live-vision-result-v1',promptVersion:fixedPromptVersion,modelId:input.modelId,videoUrl:input.videoUrl,cueCount:input.cues.length,realPaidCalls:calls,expectedTasks:tasks,scope:'live-text-planning-only; no media capture or image review',results};
    await writeFile(resultPath,JSON.stringify(report,null,2));
    await writeFile(resolve(directory,`qualification-${ledger.requestsUsed}.json`),JSON.stringify(report,null,2));
    process.stdout.write(`Live planning ${index+1}/${tasks}: ${outcome.status}\n`);
    if(outcome.status!=='passed')throw Error('live-qualification-failed-see-local-result');
  }
}
