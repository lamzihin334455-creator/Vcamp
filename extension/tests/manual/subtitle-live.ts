import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createProviderPort} from '../../src/generation/provider-port';
import {fixedPrompt,fixedPromptVersion} from '../../src/prompts/fixed-rules';
import {runSubtitle,subtitleBatches} from '../../src/generation/run-subtitle';
import {createWebEvidencePort} from '../../src/generation/web-evidence-port';
import {webOptions} from '../../src/contracts/web';
import type {SubtitleRequestSnapshot} from '../../src/contracts/generation';

export async function run(directory:string,key:string,mode:string){
 const input=JSON.parse(await readFile(resolve(directory,'input.json'),'utf8'));
 const ledgerPath=resolve(directory,'call-ledger.json');
 let ledger:any;try{ledger=JSON.parse(await readFile(ledgerPath,'utf8'));}catch{ledger={authorizedLimit:10,requestsUsed:0,requests:[]};}
 if(ledger.authorizedLimit!==10||!Number.isSafeInteger(ledger.requestsUsed))throw Error('invalid-ledger');
 const pending:Promise<unknown>[]=[],replayed:string[]=[];
 const clean=(text:string)=>text.split(key).join('<REDACTED>');
 const transport:typeof fetch=async(url,init)=>{
  const body=String(init?.body??''),hash=createHash('sha256').update(String(url)+'\n'+body).digest('hex');
  const cached=ledger.requests.find((row:any)=>row.hash===hash&&row.status==='complete');
  if(mode==='resume'&&cached){replayed.push(cached.id);return new Response(await readFile(resolve(directory,`${cached.id}.response.txt`),'utf8'),{status:cached.httpStatus,headers:{'content-type':cached.contentType}});}
  if(ledger.requestsUsed>=10)throw Error('authorized-call-limit');
  const id=`call-${++ledger.requestsUsed}`,entry:any={id,hash,stage:body.includes('"stage":"')?JSON.parse(JSON.parse(body).messages[1].content).stage:String(url).endsWith('/search')?'search':body.includes('P1:web-query')?'query':'processing',status:'started',promptVersion:fixedPromptVersion,startedAt:new Date().toISOString()};
  ledger.requests.push(entry);await writeFile(ledgerPath,JSON.stringify(ledger,null,2));await writeFile(resolve(directory,`${id}.request.json`),clean(body));
  process.stdout.write(`${id}: ${entry.stage} started\n`);
  try{const response=await fetch(url,init);entry.httpStatus=response.status;entry.contentType=response.headers.get('content-type');const recording=response.clone().text().then(async text=>{await writeFile(resolve(directory,`${id}.response.txt`),clean(text));entry.status='complete';await writeFile(ledgerPath,JSON.stringify(ledger,null,2));});pending.push(recording);return response;}
  catch(error){entry.status='failed';await writeFile(ledgerPath,JSON.stringify(ledger,null,2));throw error;}
 };
 const diagnostics:any[]=[],provider=createProviderPort(key,transport,undefined,async value=>{diagnostics.push(value);});
 const signal=AbortSignal.timeout(15*60*1000);
 const snapshot:SubtitleRequestSnapshot={snapshotId:'real-subtitle',target:{kind:'subtitle',workspaceId:'real-subtitle',operation:'enhance'},source:{locator:input.videoId,fingerprint:'real-subtitle'},targetLanguage:null,requirements:'',modelId:input.modelId,subtitleWorkflow:2,webEnabled:true,videoTitle:input.title};
 let output='';
 try{
  if(mode==='probe')await provider.stream(input.modelId,[{role:'system',content:fixedPrompt({kind:'subtitle-terms'})},{role:'user',content:JSON.stringify({stage:'terms',videoTitle:input.title,cues:input.cues.map((cue:any,index:number)=>({index,content:cue.content}))})}],signal,async delta=>{output+=delta;},'subtitle');
  else{
   const result=await runSubtitle(snapshot,input.cues,provider,signal,async(_text,coverage)=>{process.stdout.write(`coverage ${coverage.covered}/${coverage.total}\n`);},{async phase(phase){process.stdout.write(`phase ${phase}\n`);},async lookup(question,lookupSignal){const found=await createWebEvidencePort(key,transport,async value=>{diagnostics.push(value);}).retrieve({options:webOptions(),question,videoTitle:input.title},lookupSignal);await writeFile(resolve(directory,'web.json'),JSON.stringify(found,null,2));return found.material+'\n实际检索来源：'+JSON.stringify(found.evidence.sources);}});
   if(result.length!==input.cues.length||result.some((cue,index)=>cue.from!==input.cues[index].from||cue.to!==input.cues[index].to))throw Error('alignment-failed');
   await writeFile(resolve(directory,'corrected.json'),JSON.stringify(result,null,2));output=JSON.stringify({cues:result.length,changed:result.filter((cue,index)=>cue.content!==input.cues[index].content).length});
  }
  process.stdout.write(`result: ${mode==='probe'?'probe captured':output}\n`);
 }catch(error){process.stdout.write(`failed: ${error instanceof Error?error.message:'unknown'}\n`);process.exitCode=1;}
 finally{
  await Promise.allSettled(pending);await writeFile(resolve(directory,`${mode}-result.json`),JSON.stringify({mode,promptVersion:fixedPromptVersion,requestsUsed:ledger.requestsUsed,diagnostics,batches:subtitleBatches(input.cues).length,outputChars:output.length,replayed},null,2));if(output)await writeFile(resolve(directory,`${mode}-output.txt`),clean(output));
 }
}
