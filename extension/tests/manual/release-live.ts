import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createProviderPort} from '../../src/generation/provider-port';
import {fetchModelList} from '../../src/generation/model-list';
import {runChat} from '../../src/generation/run-chat';
import {parseHtmlPage} from '../../src/contracts/html-page';

// Opt-in, sequential, real-provider qualification using only synthetic source
// material. All transport calls reserve budget durably before network access.
export async function qualify(envPath:string,privateDirectory:string){
  const raw=await readFile(envPath,'utf8');
  const match=/^\s*(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/m.exec(raw);
  const key=match?.[1].replace(/^['"]|['"]$/g,'');
  if(!key)throw Error('Missing configured API key');
  const ledgerPath=resolve(privateDirectory,'api-ledger.json');
  const ledger=JSON.parse(await readFile(ledgerPath,'utf8'));
  if(ledger.authorizedLimit!==300||!Number.isInteger(ledger.requestsUsed)||ledger.requestsUsed<0)throw Error('Invalid request ledger');
  const results:any[]=[];
  const transport:typeof fetch=async(input,init)=>{
    if(new URL(String(input)).origin!=='https://api.deepseek.com')throw Error('Unapproved provider origin');
    if(ledger.requestsUsed>=ledger.authorizedLimit)throw Error('Request allowance exhausted');
    const entry={number:++ledger.requestsUsed,method:init?.method??'GET',purpose:'release-qualification',startedAt:new Date().toISOString(),status:'started',httpStatus:0};
    ledger.requests.push(entry);await writeFile(ledgerPath,JSON.stringify(ledger,null,2));
    try{const response=await fetch(input,init);entry.httpStatus=response.status;entry.status='response';return response;}
    catch{entry.status='network-failed';throw Error('Provider transport failed');}
    finally{await writeFile(ledgerPath,JSON.stringify(ledger,null,2));}
  };
  await mkdir(resolve(privateDirectory,'live-output'),{recursive:true});
  let models;
  try{models=await fetchModelList(key,transport,AbortSignal.timeout(45000));}
  catch(error){results.push({case:'catalogue',passed:false,code:(error as any).status??'failure'});await save();return;}
  results.push({case:'catalogue',passed:true,modelCount:models.length});
  const chosen=models.find(m=>m.id==='deepseek-flash'&&m.text!=='unsupported')??models.find(m=>m.id==='deepseek-chat'&&m.text!=='unsupported')??models.find(m=>m.text!=='unsupported');
  if(!chosen)throw Error('No usable text model');
  const cues=[{from:0,to:4,content:'本段介绍一个合成缓存示例。缓存上限是三条记录。'},{from:4,to:8,content:'缓存已有 A、B、C。访问 A 后，A 成为最近使用的记录。'},{from:8,to:12,content:'再加入 D 时，移除最久未使用的 B。最终记录为 C、A、D。'}];
  for(const outputType of ['chat','markdown','html'] as const){
    let text='';const diagnostics:any[]=[];
    const provider=createProviderPort(key,transport,undefined,async d=>{diagnostics.push(d);});
    const input=outputType==='html'?'根据字幕生成一个自包含 HTML 学习页，包含一题选择题：加入 D 时淘汰谁？正确答案为 B，按钮点击显示解释。不要联网或引用外部资源。':outputType==='markdown'?'根据字幕写一份简短学习笔记，解释缓存上限、访问 A 后的变化和加入 D 时淘汰的记录。':'仅根据字幕回答：加入 D 时淘汰谁，为什么？不超过120字。';
    try{
      await runChat({snapshotId:crypto.randomUUID(),target:{kind:'chat',workspaceId:'synthetic-release',chatId:'release'},input,outputType,modelId:chosen.id,webEnabled:false,templateRevisionId:null,historyProjection:[],referenceSnapshotIds:[],attachmentIds:[],mediaDuration:12,...(outputType==='html'?{htmlFormat:1 as const}:{})},cues,provider,AbortSignal.timeout(180000),async output=>{text=output;});
      if(outputType==='html')parseHtmlPage(text);
      const passed=text.length>20&&text.includes('B')&&!text.includes(key);
      results.push({case:outputType,passed,model:chosen.id,chars:text.length,diagnostics});
      if(!text.includes(key))await writeFile(resolve(privateDirectory,'live-output',outputType+'.txt'),text);
    }catch(error){results.push({case:outputType,passed:false,model:chosen.id,code:(error as any).code??'failed',chars:text.length,diagnostics});}
    await save();
  }
  async function save(){await writeFile(resolve(privateDirectory,'live-qualification.json'),JSON.stringify({scope:'Production provider/runChat with synthetic captions. Not a real-site/video quality or installed UI acceptance.',requestsUsed:ledger.requestsUsed,authorizedLimit:ledger.authorizedLimit,results},null,2));}
  await save();
}
