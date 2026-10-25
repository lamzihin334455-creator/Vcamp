import {Component, useCallback, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {Launch} from './Launch';
import {DURATION,FPS} from './brand';

type PanelOpened = {windowId:number;path:string};
type PanelEvent = {addListener:(listener:(info:PanelOpened)=>void)=>void;removeListener:(listener:(info:PanelOpened)=>void)=>void};

/** Keep lifecycle listeners alive even when a hidden/preloaded panel renders no overlay. */
export function Startup() {
  const [run,setRun]=useState<number|null>(()=>document.hidden?null:1);
  const sequence=useRef(1);
  const running=useRef(run!==null);
  useLayoutEffect(()=>{
    let disposed=false;
    let wasHidden=document.hidden;
    const begin=()=>{
      if(disposed||document.hidden||running.current)return;
      running.current=true;
      setRun(++sequence.current);
    };
    const visibility=()=>{
      if(document.hidden){
        wasHidden=true;
        running.current=false;
        setRun(null);
      }else if(wasHidden){
        wasHidden=false;
        begin();
      }
    };
    // onOpened is optional (Chrome 141+). Visibility/pageshow also cover Chrome 116+.
    const openedEvent=(chrome.sidePanel as typeof chrome.sidePanel & {onOpened?:PanelEvent}).onOpened;
    const opened=(info:PanelOpened)=>{
      if(info.path.replace(/^\//,'')!=='sidepanel.html')return;
      void chrome.windows.getCurrent().then(window=>{if(window.id===info.windowId)begin();}).catch(()=>{});
    };
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pageshow',visibility);
    openedEvent?.addListener(opened);
    // Reconcile a visibility change between render and listener registration.
    if(!document.hidden&&!running.current)begin();
    return()=>{disposed=true;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pageshow',visibility);openedEvent?.removeListener(opened);};
  },[]);
  const finish=useCallback(()=>{running.current=false;setRun(null);},[]);
  return run===null?null:<StartupPlayback key={run} onFinish={finish}/>;
}

function StartupPlayback({onFinish}:{onFinish:()=>void}) {
  const [reduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [size,setSize]=useState(()=>({width:Math.max(1,innerWidth),height:Math.max(1,innerHeight)}));
  const [background]=useState(()=>{
    const color=getComputedStyle(document.documentElement).backgroundColor;
    return color==='rgba(0, 0, 0, 0)' ? '#f5f5f3' : color;
  });
  const host=useRef<HTMLDivElement>(null);
  const player=useRef<PlayerRef>(null);
  useLayoutEffect(()=>{
    const element=host.current;
    const current=player.current;
    if(!element||!current)return;
    let closing=false;
    let fade:Animation|undefined;
    const finish=onFinish;
    const fadeOut=()=>{
      if(closing)return;
      closing=true;
      current.pause();
      // A stalled player or a changed accessibility preference still exits gently.
      fade=element.animate([{opacity:1},{opacity:0}],{duration:180,easing:'ease-in-out',fill:'forwards'});
      fade.onfinish=finish;
    };
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const motionChange=()=>{if(motion.matches)fadeOut();};
    const observer=new ResizeObserver(([entry])=>setSize({width:Math.max(1,Math.round(entry.contentRect.width)),height:Math.max(1,Math.round(entry.contentRect.height))}));
    observer.observe(element);
    current.addEventListener('ended',finish);
    motion.addEventListener('change',motionChange);
    const deadline=setTimeout(fadeOut,reduced?300:1320);
    // Layout listeners are ready before the Player's autoplay effect begins.
    return()=>{
      clearTimeout(deadline);
      if(fade){fade.onfinish=null;fade.cancel();}
      observer.disconnect();
      current.removeEventListener('ended',finish);
      motion.removeEventListener('change',motionChange);
    };
  },[onFinish,reduced]);
  return <div ref={host} data-testid="startup" aria-hidden="true" style={{position:'fixed',inset:0,zIndex:2147480000,pointerEvents:'none',overflow:'hidden'}}>
    <Player ref={player} component={Launch} inputProps={{dark:false,reducedMotion:reduced,background}}
      durationInFrames={reduced?15:DURATION} fps={FPS} compositionWidth={size.width} compositionHeight={size.height}
      style={{width:'100%',height:'100%',pointerEvents:'none'}} controls={false} loop={false}
      autoPlay initiallyMuted numberOfSharedAudioTags={0} moveToBeginningWhenEnded={false}
      clickToPlay={false} doubleClickToFullscreen={false} spaceKeyToPlayOrPause={false} acknowledgeRemotionLicense/>
  </div>;
}

/** Animation failure must never take down the workbench. */
export class StartupBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?null:this.props.children;}
}
