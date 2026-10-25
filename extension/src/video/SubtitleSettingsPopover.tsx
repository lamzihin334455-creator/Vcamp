import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';

export function SubtitleSettingsPopover({close, children}: {close:()=>void; children:ReactNode}) {
  const root=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({top:48,left:8});
  useLayoutEffect(()=>{
    const trigger=document.querySelector<HTMLElement>('[data-subtitle-settings-trigger]');
    const place=()=>{
      const box=trigger?.getBoundingClientRect();
      const width=Math.min(340,innerWidth-16);
      setPosition({top:Math.min(box?.bottom??40,innerHeight-120)+8,left:Math.max(8,Math.min((box?.right??innerWidth-8)-width,innerWidth-width-8))});
    };
    place();window.addEventListener('resize',place);
    const observer=new ResizeObserver(place);if(trigger)observer.observe(trigger);
    root.current?.focus({preventScroll:true});
    return ()=>{window.removeEventListener('resize',place);observer.disconnect();};
  },[]);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)&&!(event.target as Element).closest('[data-subtitle-settings-trigger]'))close();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();document.querySelector<HTMLElement>('[data-subtitle-settings-trigger]')?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[close]);
  return createPortal(<div ref={root} className="subtitle-settings subtitle-settings-popover" role="dialog" aria-label="字幕设置" tabIndex={-1} style={{top:position.top,left:position.left,maxHeight:`calc(100dvh - ${position.top+8}px)`}}>
    <div className="subtitle-settings-heading"><strong>字幕设置</strong><button aria-label="关闭字幕设置" onClick={()=>{close();document.querySelector<HTMLElement>('[data-subtitle-settings-trigger]')?.focus();}}>×</button></div>
    {children}
  </div>,document.body);
}
