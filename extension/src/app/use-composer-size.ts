import {useLayoutEffect,useRef,type RefObject} from 'react';

/** Grow the editor upwards, leaving room for its controls within a third of the panel. */
export function useComposerSize(ref:RefObject<HTMLTextAreaElement|null>,value:string,enabled:boolean){
  const measure=useRef<(()=>void)|undefined>(undefined);
  useLayoutEffect(()=>{
    const input=ref.current,composer=input?.closest<HTMLElement>('.composer');
    if(!enabled||!input||!composer)return;
    let width=-1,overhead=-1;
    const resize=()=>{
      const inputBox=input.getBoundingClientRect(),composerBox=composer.getBoundingClientRect();
      width=inputBox.width;overhead=composerBox.height-inputBox.height;
      if(width<=0)return;
      const style=getComputedStyle(input),minimum=parseFloat(style.minHeight)||40;
      const border=(parseFloat(style.borderTopWidth)||0)+(parseFloat(style.borderBottomWidth)||0);
      const maximum=Math.max(minimum,(window.visualViewport?.height??window.innerHeight)/3-overhead);
      const scrollTop=input.scrollTop;
      input.style.overflowY='hidden';
      input.style.height='0px';
      const content=input.scrollHeight+border;
      input.style.height=`${Math.min(maximum,Math.max(minimum,content))}px`;
      input.style.overflowY=content>maximum+1?'auto':'hidden';
      input.scrollTop=scrollTop;
    };
    measure.current=resize;
    resize();
    const observer=new ResizeObserver(()=>{
      const box=input.getBoundingClientRect();
      const nextOverhead=composer.getBoundingClientRect().height-box.height;
      if(Math.abs(box.width-width)>.5||Math.abs(nextOverhead-overhead)>.5)resize();
    });
    observer.observe(composer);
    window.addEventListener('resize',resize);
    window.visualViewport?.addEventListener('resize',resize);
    return()=>{
      measure.current=undefined;
      observer.disconnect();
      window.removeEventListener('resize',resize);
      window.visualViewport?.removeEventListener('resize',resize);
    };
  },[ref,enabled]);
  useLayoutEffect(()=>{measure.current?.();},[value]);
}
