import type {SourceBinding} from '../contracts/generation';
import {sameBinding,type VideoView} from '../contracts/video';
import {captureCurrent} from './capture';
import {inspectMedia} from './page';
import {currentMediaControl} from './current-media-control';

export const grantKey=(attemptId:string)=>`vcamp.visionGrant.${attemptId}`;
const leaseKey=(attemptId:string)=>`vcamp.currentMedia.${attemptId}`;
const continuationKey=(attemptId:string)=>`vcamp.mediaContinuation.${attemptId}`;
interface Record {jobId:string;binding:SourceBinding;token:string;revision:number}

// Release never closes or navigates a video tab. A new MAIN proof plus the
// isolated session's unchanged user/control history is required for restoration.
async function control(record:Record,action:'start'|'seek'|'check'|'suspend'|'resume'|'release'|'cancel',time?:number){
  const target={tabId:record.binding.tabId,documentIds:[record.binding.documentId]};
  const confirmation=`vcamp-current-${crypto.randomUUID()}`;
  if(action!=='cancel'){
    const [proof]=await chrome.scripting.executeScript({target,world:'MAIN',func:inspectMedia,args:[record.binding,confirmation]}).catch(()=>{throw new Error('source-changed');});
    if(proof?.documentId!==record.binding.documentId||proof.result?.status!=='supported'){
      await chrome.scripting.executeScript({target,world:'ISOLATED',func:currentMediaControl,args:['cancel',record.token]}).catch(()=>{});
      throw new Error('source-changed');
    }
  }
  const [result]=await chrome.scripting.executeScript({target,world:'ISOLATED',func:currentMediaControl,args:[action,record.token,confirmation,time??null,record.revision]});
  if(result?.documentId!==record.binding.documentId||!result.result)throw new Error('current-page-control');
  if('error' in result.result)throw new Error(result.result.error);
  return result.result;
}
export async function releaseMedia(jobId:string,attemptId:string){
  const key=leaseKey(attemptId),continuation=continuationKey(attemptId),records=await chrome.storage.session.get([key,continuation]);
  const record=(records[key]??records[continuation]) as Record|undefined;
  await chrome.storage.session.remove(grantKey(attemptId));
  if(!record||record.jobId!==jobId)return;
  try{await control(record,'release');}catch{await control(record,'cancel').catch(()=>{});}
  finally{await chrome.storage.session.remove([key,continuation]);}
}
export async function createOriginalMedia(jobId:string,attemptId:string,source:SourceBinding,signal:AbortSignal){
  const grant=(await chrome.storage.session.get(grantKey(attemptId)))[grantKey(attemptId)];
  if(grant?.jobId!==jobId||grant?.currentPage!==true||!Number.isSafeInteger(grant.controlRevision)||grant?.expires<Date.now()||!sameBinding(grant.binding,source))throw new Error('permission');
  const sourceTab=await chrome.tabs.get(source.tabId);
  if(!sourceTab.active||sourceTab.pendingUrl)throw new Error('source-changed');
  signal.throwIfAborted();
  await chrome.storage.session.remove(grantKey(attemptId));
  const record:Record={jobId,binding:source,token:crypto.randomUUID(),revision:grant.controlRevision};
  const started=await control(record,'start');
  if(!started.duration)throw new Error('media-not-ready');
  try{await chrome.storage.session.set({[leaseKey(attemptId)]:record});}catch(error){await control(record,'release').catch(()=>{});throw error;}
  let released=false,busy=false,suspended=false,resumed=false;
  const release=async()=>{if(released)return;released=true;signal.removeEventListener('abort',abort);await releaseMedia(jobId,attemptId);};
  const abort=()=>{void release();};signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){await release();throw new Error('cancelled');}
  const observe=async():Promise<VideoView>=>{
    const [result]=await chrome.scripting.executeScript({target:{tabId:source.tabId,documentIds:[source.documentId]},world:'MAIN',func:inspectMedia,args:[source]});
    if(result?.documentId!==source.documentId||result.result?.status!=='supported')throw new Error('source-changed');
    return {binding:source,status:'ready',cues:[],language:null};
  };
  return {duration:started.duration,initialization:{currentPage:true},diagnostics:[] as unknown[],async capture(time:number,detail?:'low'|'original'){
    if(released||busy||suspended)throw new Error('capture-unavailable');busy=true;
    try{
      signal.throwIfAborted();await control(record,'seek',time);signal.throwIfAborted();
      const frame=await captureCurrent(source,observe,detail?{sample:true,detail}:undefined);
      await control(record,'check');signal.throwIfAborted();
      if(released||Math.abs(frame.time-time)>0.1)throw new Error('user-or-media-changed');
      return frame;
    }catch(error){await release();throw error;}finally{busy=false;}
  },async suspend(){
    if(released||busy||suspended||resumed)throw new Error('capture-unavailable');
    signal.throwIfAborted();await control(record,'suspend');suspended=true;
    await chrome.storage.session.set({[continuationKey(attemptId)]:record});
    await chrome.storage.session.remove(leaseKey(attemptId));
    if(released||signal.aborted)await releaseMedia(jobId,attemptId);
    signal.throwIfAborted();
  },async resume(){
    if(released||busy||!suspended||resumed)throw new Error('capture-unavailable');
    signal.throwIfAborted();
    const tab=await chrome.tabs.get(source.tabId);
    if(!tab.active||tab.pendingUrl)throw new Error('source-changed');
    await control(record,'resume');suspended=false;resumed=true;
    await chrome.storage.session.set({[leaseKey(attemptId)]:record});
    await chrome.storage.session.remove(continuationKey(attemptId));
    if(released||signal.aborted)await releaseMedia(jobId,attemptId);
    signal.throwIfAborted();
  },release};
}
