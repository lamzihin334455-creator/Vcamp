import {createTimeTools,validTime} from '../shared/time';

// Serialized ahead of generated scripts. It exposes no listener, token or RPC
// on window. Remove the script element before any generated code can read it.
function installNavigation(token:string,portable:boolean,tools:ReturnType<typeof createTimeTools>,sourceBase?:string){
  document.currentScript?.remove();
  const send=parent.postMessage.bind(parent),create=document.createElement.bind(document);
  const notice=(text:string)=>{let el=document.getElementById('vcamp-navigation-notice');if(!el){el=create('p');el.id='vcamp-navigation-notice';el.setAttribute('role','status');document.body.append(el);}el.textContent=text;};
  const timeLabel=(text:string)=>{const value=text.trim().replace(/^(?:视频(?:时间|进度)?|时间点|进度)\s*[:：]?\s*/, '');return tools.parseTime(value)??tools.parseTime(`[${value}]`);};
  const controlTime=(el:Element)=>{
    const value=el.getAttribute('data-vcamp-time')??el.getAttribute('data-time')??el.getAttribute('data-timestamp');
    if(value!==null)return tools.parseTime(`vcamp-time:${value.trim()}`)??timeLabel(value);
    return tools.markdownTimeLink(el.textContent??'')?.time??timeLabel(el.textContent??'');
  };
  const requestTime=(time:number)=>{if(portable){if(sourceBase)window.open(sourceBase+'&t='+Math.floor(time),'_blank','noopener,noreferrer');else notice('此资料缺少可核实的来源分 P，无法定位。');}else if(navigator.userActivation.isActive)send({type:'vcamp.html.action',token,kind:'seek',time},'*');};
  // Capture before generated document handlers, including buttons with their own JS.
  window.addEventListener('click',event=>{
    const element=event.target instanceof Element?event.target:(event.target as Node)?.parentElement;
    const a=element?.closest('a[href]');
    if(!a){const control=element?.closest('button,[role="button"],[data-vcamp-time],[data-time],[data-timestamp]');if(!control||control.closest('pre,code,textarea,[contenteditable]'))return;const time=controlTime(control);if(time===null)return;event.preventDefault();event.stopImmediatePropagation();if(event.isTrusted)requestTime(time);return;}
    const href=a.getAttribute('href')??'';
    if(href.startsWith('#')){
      event.preventDefault();event.stopImmediatePropagation();
      let id=href.slice(1);try{id=decodeURIComponent(id);}catch{}
      const target=document.getElementById(id)||document.getElementsByName(id)[0];
      if(target)target.scrollIntoView({block:'start'});else if(!id)window.scrollTo(0,0);else notice('未找到此页内位置，页面已保留。');
      return;
    }
    if(portable&&/^https?:\/\//i.test(href)){a.setAttribute('target','_blank');a.setAttribute('rel','noopener noreferrer');return;}
    event.preventDefault();event.stopImmediatePropagation();
    if(!event.isTrusted)return;
    const time=tools.parseTime(href);
    if(time!==null){requestTime(time);return;}
    try{const u=new URL(href);if(/^https?:$/.test(u.protocol)&&!u.username&&!u.password&&u.href.length<=4096){send({type:'vcamp.html.action',token,kind:'external',url:u.href},'*');return;}}catch{}
    notice('此链接暂不支持，页面已保留。');
  },true);
  const cleanNestedLabel=(element:Element,time:number)=>{
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode as Text;
      if(node.parentElement?.closest('script,style,pre,code,textarea,[contenteditable]'))continue;
      if(tools.markdownTimeLink(node.data)?.time===time)node.data=tools.timeLinkLabel(node.data,time);
    }
  };
  const normalize=()=>{
    for(const a of document.querySelectorAll('a[href]')){if(a.closest('pre,code,textarea,[contenteditable]'))continue;const time=tools.parseTime(a.getAttribute('href')??'');if(time!==null){if(!a.children.length){const label=tools.timeLinkLabel(a.textContent??'',time);if(a.textContent!==label)a.textContent=label;}else cleanNestedLabel(a,time);if(portable&&sourceBase){a.setAttribute('href',sourceBase+'&t='+Math.floor(time));a.setAttribute('target','_blank');a.setAttribute('rel','noopener noreferrer');}}}
    // Keep existing controls as controls, rather than nesting links in buttons.
    for(const control of document.querySelectorAll('button,[role="button"],[data-vcamp-time],[data-time],[data-timestamp]')){
      if(control.closest('pre,code,textarea,[contenteditable]'))continue;
      const link=tools.markdownTimeLink(control.textContent??'');
      if(!link||controlTime(control)!==link.time)continue;
      control.setAttribute('data-vcamp-time',String(link.time));
      if(!control.children.length)control.textContent=tools.timeLinkLabel(link.label,link.time);else cleanNestedLabel(control,link.time);
    }
    // Read-time compatibility only: preserve stored HTML, code, clocks, URLs and
    // local anchors. Standalone time badges and explicitly video-labelled prose
    // use the same meaning as the note/chat renderer.
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),nodes:Text[]=[];
    while(walker.nextNode()){const node=walker.currentNode as Text;if(!node.parentElement?.closest('a,script,style,pre,code,textarea,button,[role="button"],[data-time],[data-timestamp],[data-vcamp-time],[contenteditable]'))nodes.push(node);}
    for(const node of nodes){
      const parts=tools.videoTimeParts(node.data,{leading:false,standalone:true,markdownLinks:true});
      if(!parts.some(part=>part.time!==undefined))continue;
      const fragment=document.createDocumentFragment();
      for(const part of parts){
        const time=part.time;
        if(time===undefined)fragment.append(document.createTextNode(part.text));else{
          const a=create('a');a.href=portable&&sourceBase?sourceBase+'&t='+Math.floor(time):`vcamp-time:${time}`;a.textContent=part.text;a.title='定位来源视频 '+tools.formatTime(time);
          if(portable&&sourceBase){a.target='_blank';a.rel='noopener noreferrer';}fragment.append(a);
        }
      }
      node.replaceWith(fragment);
    }
  };
  document.addEventListener('DOMContentLoaded',()=>{normalize();new MutationObserver(()=>{normalize();}).observe(document.body,{childList:true,characterData:true,subtree:true});},{once:true});
}
export function navigationScript(token:string,portable=false,sourceBase?:string){
  // No generated text is interpolated into executable code; only host tokens.
  return `(${installNavigation.toString()})(${JSON.stringify(token)},${portable},(${createTimeTools.toString()})(),${JSON.stringify(sourceBase)??'undefined'});`;
}

export type HtmlAction={kind:'seek';time:number}|{kind:'external';url:string};
export function htmlAction(value:unknown,token:string):HtmlAction|null {
  if(!value||typeof value!=='object')return null;
  const v=value as Record<string,unknown>;
  if(v.type!=='vcamp.html.action'||v.token!==token)return null;
  if(v.kind==='seek'&&Object.keys(v).sort().join(',')==='kind,time,token,type'&&typeof v.time==='number'&&validTime(v.time))return {kind:'seek',time:v.time};
  if(v.kind==='external'&&Object.keys(v).sort().join(',')==='kind,token,type,url'&&typeof v.url==='string'&&v.url.length<=4096){try{const u=new URL(v.url);if(/^https?:$/.test(u.protocol)&&!u.username&&!u.password)return {kind:'external',url:u.href};}catch{}}
  return null;
}
