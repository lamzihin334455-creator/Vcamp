import {z} from 'zod';
import {guardMedia} from './seek-guard';
import {bindingSchema} from '../contracts/video';

// New grants authorize only temporary playback control on this exact document.
// Old visible-copy grants cannot be consumed by createOriginalMedia.
export async function currentPageConsent(binding:z.infer<typeof bindingSchema>){
  const [guard]=await chrome.scripting.executeScript({target:{tabId:binding.tabId,documentIds:[binding.documentId]},world:'ISOLATED',func:guardMedia,args:['observe']});
  if(guard?.documentId!==binding.documentId||guard.result?.revision===undefined)throw new Error('source-changed');
  const source=await chrome.tabs.get(binding.tabId);
  const frame=await chrome.webNavigation.getFrame({tabId:binding.tabId,frameId:0});
  if(!source.active||source.pendingUrl||frame?.documentId!==binding.documentId)throw new Error('source-changed');
  return {currentPage:true,controlRevision:guard.result.revision,expires:Date.now()+90000};
}
const probeSchema=z.object({type:z.literal('media.probe-consent'),jobId:z.string().uuid(),attemptId:z.string().uuid(),binding:bindingSchema}).strict();
export function installMediaHosts(allowProbe=false){
  return(message:unknown,sender:chrome.runtime.MessageSender,respond:(value:unknown)=>void)=>{
    const probe=probeSchema.safeParse(message);
    if(allowProbe&&probe.success&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('tests/installed/t16-media-probe.html')){
      const op=probe.data;
      void currentPageConsent(op.binding).then(async consent=>{await chrome.storage.session.set({['vcamp.visionGrant.'+op.attemptId]:{...consent,jobId:op.jobId,binding:op.binding}});respond({ok:true});},()=>respond({ok:false}));
      return true;
    }
    // The old media.create route is deliberately retired. No copy, navigation,
    // activation or focus restoration is reachable through this handler.
    if(typeof message==='object'&&message&&(message as {type?:string}).type==='media.create'){respond({ok:false});return true;}
    return false;
  };
}
