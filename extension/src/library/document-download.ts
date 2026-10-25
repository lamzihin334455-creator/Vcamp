import {zipSync,strToU8} from 'fflate';
import {navigationScript} from '../html/navigation';
import {createTimeTools,parseTime,timeLinkLabel} from '../shared/time';
import type {DocumentExport} from '../contracts/documents';

// The downloaded file is a trusted host too. A CSP alone does not stop an
// inline script from assigning location, so keep generated code in an opaque
// sandbox and accept only the private bridge's user-initiated navigation.
function installPortableNavigation(token:string,tools:ReturnType<typeof createTimeTools>,sourceBase?:string){
  const frame=document.querySelector('iframe')!;
  let last=-Infinity;
  window.addEventListener('message',event=>{
    const value=event.data;
    if(event.source!==frame.contentWindow||!value||typeof value!=='object'||value.type!=='vcamp.html.action'||value.token!==token||!navigator.userActivation.isActive||performance.now()-last<1000)return;
    let destination:string|undefined;
    if(value.kind==='seek'&&Object.keys(value).sort().join(',')==='kind,time,token,type'&&typeof value.time==='number'&&tools.validTime(value.time)){
      if(sourceBase)destination=sourceBase+'&t='+Math.floor(value.time);
      else document.querySelector('[role="status"]')!.textContent='此资料缺少可核实的来源分 P，无法定位。';
    }else if(value.kind==='external'&&Object.keys(value).sort().join(',')==='kind,token,type,url'&&typeof value.url==='string'&&value.url.length<=4096){
      try{const url=new URL(value.url);if(/^https?:$/.test(url.protocol)&&!url.username&&!url.password)destination=url.href;}catch{}
    }
    if(destination){last=performance.now();window.open(destination,'_blank','noopener,noreferrer');}
  });
}
export function portableHtml(file:DocumentExport['files'][number]){
  const doc=new DOMParser().parseFromString(file.content,'text/html');
  doc.querySelectorAll('base,meta[http-equiv],iframe,object,embed,link,script[src]').forEach(n=>n.remove());
  for(const a of doc.querySelectorAll('a[href]')){
    if(a.closest('pre,code,textarea,[contenteditable]'))continue;
    const time=parseTime(a.getAttribute('href')??'');
    if(time!==null){if(!a.children.length)a.textContent=timeLinkLabel(a.textContent??'',time);if(file.source?.pageNumber)a.setAttribute('href',`https://www.bilibili.com/video/${encodeURIComponent(file.source.videoId)}/?p=${file.source.pageNumber}&t=${Math.floor(time)}&autoplay=0`);}
    if(/^https?:\/\//i.test(a.getAttribute('href')??'')){a.setAttribute('target','_blank');a.setAttribute('rel','noopener noreferrer');}
  }
  // Keep local interaction, with the same network/realm isolation as preview.
  const token=[...crypto.getRandomValues(new Uint8Array(16))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const policy=doc.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";
  const sourceBase=file.source?.pageNumber?`https://www.bilibili.com/video/${encodeURIComponent(file.source.videoId)}/?p=${file.source.pageNumber}&autoplay=0`:undefined;
  const script=doc.createElement('script');script.textContent=navigationScript(token)+"for(const k of ['RTCPeerConnection','webkitRTCPeerConnection','Worker','SharedWorker']){try{Object.defineProperty(globalThis,k,{value:undefined,writable:false,configurable:false});}catch{}}";doc.head.prepend(script);doc.head.prepend(policy);
  const host=document.implementation.createHTMLDocument(doc.title||'Vcamp HTML 页面');
  const hostPolicy=host.createElement('meta');hostPolicy.httpEquiv='Content-Security-Policy';hostPolicy.content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about:; base-uri 'none'; form-action 'none'; object-src 'none'";host.head.prepend(hostPolicy);
  const style=host.createElement('style');style.textContent='html,body{margin:0;width:100%;height:100%}iframe{display:block;border:0;width:100%;height:100%}[role="status"]:empty{display:none}';host.head.append(style);
  const frame=host.createElement('iframe');frame.title=doc.title||'HTML 页面内容';frame.sandbox.add('allow-scripts');frame.referrerPolicy='no-referrer';frame.srcdoc='<!doctype html>\n'+doc.documentElement.outerHTML;
  const notice=host.createElement('p');notice.setAttribute('role','status');
  const bridge=host.createElement('script');bridge.textContent=`(${installPortableNavigation.toString()})(${JSON.stringify(token)},(${createTimeTools.toString()})(),${JSON.stringify(sourceBase)??'undefined'});`;
  host.body.append(frame,notice,bridge);
  return '<!doctype html>\n'+host.documentElement.outerHTML;
}
export function exportBytes(files:DocumentExport['files']){
  return files.map(file=>({name:file.name,bytes:file.type==='binary'?Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)):strToU8(file.type==='html'?portableHtml(file):file.content)}));
}
export function zipDocuments(files:ReturnType<typeof exportBytes>){return zipSync(Object.fromEntries(files.map(f=>[f.name,f.bytes])),{level:6});}

// downloads API reports each completion/interruption; don't claim completion
// after a mere anchor click. One selected SRT yields its sidecar as a second file.
export async function downloadDocument(name:string,bytes:Uint8Array,signal:AbortSignal){
  signal.throwIfAborted();
  // An untyped Blob is sniffed as text/plain by Chrome on Windows, which can
  // replace .srt/.md with .txt despite DownloadOptions.filename. Octet-stream
  // preserves the service's format-specific extension without changing bytes.
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:'application/octet-stream'}));
  try{
    const id=await chrome.downloads.download({url,filename:name,saveAs:false});
    return await new Promise<void>((resolve,reject)=>{
      let ended=false;
      const finish=(error?:string)=>{if(ended)return;ended=true;clearTimeout(timer);chrome.downloads.onChanged.removeListener(change);signal.removeEventListener('abort',cancel);error?reject(new Error(error)):resolve();};
      const cancel=()=>{void chrome.downloads.cancel(id).catch(()=>{});finish('已取消此文件下载');};
      const change=(d:chrome.downloads.DownloadDelta)=>{if(d.id!==id)return;if(d.state?.current==='complete')finish();if(d.state?.current==='interrupted')finish(d.error?.current??'浏览器中断下载，请检查多文件权限或下载记录');};
      const timer=setTimeout(()=>finish('浏览器仍未确认下载完成，请查看下载记录和多文件权限'),60000);
      chrome.downloads.onChanged.addListener(change);signal.addEventListener('abort',cancel,{once:true});
      if(signal.aborted){cancel();return;}
      void chrome.downloads.search({id}).then(rows=>{if(rows[0]?.state==='complete')finish();else if(rows[0]?.state==='interrupted')finish(rows[0].error??'下载中断');}).catch(()=>finish('无法核对下载结果'));
    });
  }finally{URL.revokeObjectURL(url);}
}
