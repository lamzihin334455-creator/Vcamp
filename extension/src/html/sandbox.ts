import {htmlAction,navigationScript} from './navigation';
import {outputLimits} from '../contracts/output-limits';
// Manifest sandbox: only fixed, user-initiated navigation requests can return.
// Only the embedding parent can deliver one bounded document to this instance.
let initialized=false;
window.addEventListener('message',event=>{
  if(initialized||event.source!==parent||event.data?.type!=='vcamp.html.render'||typeof event.data.source!=='string'||event.data.source.length>outputLimits.htmlChars)return;
  initialized=true;
  const token=crypto.randomUUID(),session=event.data.session;
  const doc=new DOMParser().parseFromString(event.data.source,'text/html');
  // Resources are unnecessary for the self-contained contract. CSP remains
  // enforcement even for resources subsequently created by generated scripts.
  doc.querySelectorAll('base,meta[http-equiv],iframe,frame,object,embed,link,script[src]').forEach(el=>el.remove());
  const policy=doc.createElement('meta');policy.httpEquiv='Content-Security-Policy';
  policy.content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  doc.head.prepend(policy);
  const viewport=doc.createElement('meta');viewport.name='viewport';viewport.content='width=device-width,initial-scale=1';doc.head.append(viewport);
  const guard=doc.createElement('script');
  // Defense in depth, NOT a proof against every WebRTC/other-realm channel.
  guard.textContent="for(const k of ['RTCPeerConnection','webkitRTCPeerConnection','Worker','SharedWorker']){try{Object.defineProperty(globalThis,k,{value:undefined,writable:false,configurable:false});}catch{}}";
  guard.textContent=navigationScript(token)+guard.textContent;
  policy.after(guard);
  const frame=document.createElement('iframe');frame.title='生成页面内容';frame.sandbox.add('allow-scripts');frame.referrerPolicy='no-referrer';
  frame.srcdoc='<!doctype html>'+doc.documentElement.outerHTML;
  let last=-Infinity;
  window.addEventListener('message',message=>{
    if(message.source!==frame.contentWindow||typeof session!=='string')return;
    const action=htmlAction(message.data,token);if(!action||!navigator.userActivation.isActive||performance.now()-last<1000)return;
    last=performance.now();parent.postMessage({type:'vcamp.html.action',token:session,...action},'*');
  });
  document.body.replaceChildren(frame);
});
