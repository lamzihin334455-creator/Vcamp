import { ApplicationError } from '../contracts/application';
import type { SourceBinding } from '../contracts/generation';
import { sameBinding, type VideoView } from '../contracts/video';
import { frameSchema, imageLimits } from '../contracts/attachment';
import { guardMedia } from './seek-guard';
import { inspectMedia } from './page';
import { videoOrigins } from './chrome-video';

export async function captureCurrent(binding:SourceBinding, observe:(tabId:number)=>Promise<VideoView>, options?:{sample?:boolean;detail?:'low'|'original'}){
  if(!await chrome.permissions.contains({origins:videoOrigins}))throw new ApplicationError('permission-denied');
  if(!sameBinding((await observe(binding.tabId)).binding,binding))throw new ApplicationError('stale-binding');
  const target={tabId:binding.tabId,documentIds:[binding.documentId]};
  const token=`vcamp-capture-${crypto.randomUUID()}`;
  const [guard]=await chrome.scripting.executeScript({target,world:'ISOLATED',func:guardMedia,args:['observe']});
  const revision=guard?.result?.revision;
  if(revision===undefined)throw new ApplicationError('stale-binding');
  const [armed]=await chrome.scripting.executeScript({target,world:'ISOLATED',func:guardMedia,args:['prepare',revision,token]});
  if(armed?.result?.revision!==revision)throw new ApplicationError('stale-binding');
  const [proof]=await chrome.scripting.executeScript({target,world:'MAIN',func:inspectMedia,args:[binding,token]});
  if(proof?.result?.status!=='supported')throw new ApplicationError('stale-binding');
  const [captured]=await chrome.scripting.executeScript({target,world:'ISOLATED',func:guardMedia,args:['capture',revision,token,0,false,{edge:options?.detail==='low'?768:imageLimits.edge,pixels:options?.detail==='low'?768*768:imageLimits.pixels,dataUrlChars:Math.ceil(imageLimits.bytes/3)*4+22,...(options?.sample?{sample:true}:{})}]});
  if(captured?.documentId!==binding.documentId)throw new ApplicationError('stale-binding');
  if(captured.result?.code)throw new ApplicationError(captured.result.code);
  const {dataUrl,width,height,time}=captured.result??{};
  const frame=frameSchema.safeParse({dataUrl,width,height,time});
  if(!frame.success)throw new ApplicationError('read-failed');
  if(!sameBinding((await observe(binding.tabId)).binding,binding))throw new ApplicationError('stale-binding');
  return Object.assign(frame.data,options?.sample&&captured.result?.sample?{sample:captured.result.sample}:{});
}
