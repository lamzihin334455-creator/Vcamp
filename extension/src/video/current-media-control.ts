// Serialized into ISOLATED. This only owns temporary playback control. Pixel
// capture continues through captureCurrent/guardMedia, shared with manual capture.
export async function currentMediaControl(action:'start'|'seek'|'check'|'suspend'|'resume'|'release'|'cancel',token:string,confirmation?:string,time?:number|null,revision?:number) {
  try{
  type Session={token:string;idle:()=>boolean;valid:()=>boolean;seek:(time:number)=>Promise<void>;suspend:()=>Promise<void>;resume:()=>void;dispose:(restore:boolean)=>Promise<void>};
  const scope=window as unknown as {navigation?:EventTarget;__vcampSeekGuard?:{revision:number};__vcampCurrentMedia?:Session};
  const proof=()=>!!confirmation&&!document.dispatchEvent(new Event(confirmation,{cancelable:true}));
  if(action==='start'){
    const video=document.querySelector('video');
    if(document.hidden)throw new Error('source-changed');
    if(!video||scope.__vcampSeekGuard?.revision!==revision||video.readyState<2||!Number.isFinite(video.duration)||!proof())throw new Error('media-not-ready');
    // A later, independently authorized generation can supersede an idle
    // continuation. It must never interrupt a capture batch that is running.
    if(scope.__vcampCurrentMedia){
      if(!scope.__vcampCurrentMedia.idle())throw new Error('capture-busy');
      await scope.__vcampCurrentMedia.dispose(false);
    }
    const source=video.currentSrc,url=location.href;
    let originalTime=video.currentTime,wasPaused=video.paused;
    let active=true,ownPause=0,ownPlay=0,expectedSeek:number|undefined,disposed=false,suspended=false;
    let expectedPaused=video.paused,expectedTime:number|undefined=video.paused?video.currentTime:undefined;let disposing:Promise<void>|undefined;
    const cleanups:(()=>void)[]=[];
    const listen=(target:EventTarget,event:string,fn:EventListener)=>{target.addEventListener(event,fn,true);cleanups.push(()=>target.removeEventListener(event,fn,true));};
    const cancel=()=>{active=false;};
    const valid=()=>active&&!disposed&&video.paused===expectedPaused&&(expectedTime===undefined||Math.abs(video.currentTime-expectedTime)<0.05)&&scope.__vcampSeekGuard?.revision===revision&&scope.__vcampCurrentMedia===session&&document.querySelector('video')===video&&video.currentSrc===source&&location.href===url;
    // Trusted gestures cancel before their default pause/seek action. Native
    // media events also catch page/player controls with no pointer gesture.
    for(const event of ['pointerdown','keydown','touchstart','wheel'])listen(document,event,e=>{if(e.isTrusted)cancel();});
    listen(video,'seeking',()=>{if(expectedSeek===undefined||Math.abs(video.currentTime-expectedSeek)>0.05)cancel();});
    listen(video,'pause',()=>{if(ownPause)ownPause--;else cancel();});
    listen(video,'play',()=>{if(ownPlay)ownPlay--;else cancel();});
    for(const event of ['emptied','loadstart','ratechange'])listen(video,event,cancel);
    listen(window,'pagehide',cancel);
    if(scope.navigation)listen(scope.navigation,'currententrychange',cancel);
    listen(document,'visibilitychange',()=>{if(document.hidden)cancel();});
    const seek=async(target:number)=>{
      if(suspended||!valid()||!Number.isFinite(target)||target<0||target>=video.duration)throw new Error('user-or-media-changed');
      if(!video.paused){ownPause++;expectedPaused=true;video.pause();expectedTime=video.currentTime;}
      if(Math.abs(video.currentTime-target)<0.01&&!video.seeking)return;
      expectedSeek=target;
      try{
        await new Promise<void>((resolve,reject)=>{
          const finish=(error?:string)=>{clearTimeout(timer);video.removeEventListener('seeked',done);video.removeEventListener('error',failed);error?reject(new Error(error)):resolve();};
          const done=()=>finish(!valid()||video.seeking||video.readyState<2||Math.abs(video.currentTime-target)>0.05?'user-or-media-changed':undefined);
          const failed=()=>finish('media-error');
          const timer=setTimeout(()=>finish('seek-timeout'),8000);
          video.addEventListener('seeked',done);video.addEventListener('error',failed);
          try{if(!valid())throw new Error();expectedTime=target;video.currentTime=target;}catch{finish('seek-failed');}
        });
      }finally{expectedSeek=undefined;}
      if(!valid())throw new Error('user-or-media-changed');
    };
    const restorePlayback=async()=>{
      await seek(Math.min(originalTime,Math.max(0,video.duration-0.001)));
      if(valid()&&!wasPaused){
        ownPlay++;expectedPaused=false;expectedTime=undefined;
        try{await video.play();}catch{ownPlay=0;cancel();}
      }
    };
    const session:Session={token,idle:()=>suspended,valid,seek,
      async suspend(){
        if(suspended||!valid())throw new Error('user-or-media-changed');
        await restorePlayback();
        if(!valid())throw new Error('user-or-media-changed');
        suspended=true;
      },
      resume(){
        if(!suspended||!valid()||document.hidden)throw new Error('user-or-media-changed');
        // This is the same bounded generation. Any user/media event during the
        // model wait invalidates it; normal playback may advance naturally.
        originalTime=video.currentTime;wasPaused=video.paused;suspended=false;
      },async dispose(restore){
      if(disposed)return;
      return disposing??=(async()=>{
      // No restore after a user action, visibility loss or identity change.
      // Restoration itself remains guarded until its asynchronous seek ends.
      try{if(restore&&!suspended&&valid())await restorePlayback();}
      finally{disposed=true;active=false;for(const cleanup of cleanups)cleanup();clearTimeout(expiry);if(scope.__vcampCurrentMedia===session)delete scope.__vcampCurrentMedia;}
      })();
    }};
    const expiry=setTimeout(()=>{cancel();void session.dispose(false);},90000);
    scope.__vcampCurrentMedia=session;
    return {duration:video.duration};
  }
  const session=scope.__vcampCurrentMedia;
  if(!session||session.token!==token)throw new Error('capture-not-owned');
  if(action==='release'||action==='cancel'){await session.dispose(action==='release'&&proof());return {released:true};}
  if(!session.valid()||!proof())throw new Error('user-or-media-changed');
  if(action==='suspend')await session.suspend();
  if(action==='resume')session.resume();
  if(action==='seek'){if(typeof time!=='number')throw new Error('invalid-time');await session.seek(time);}
  return {valid:session.valid()};
  }catch(error){
    const message=error instanceof Error?error.message:'';
    return {error:['source-changed','capture-busy','media-not-ready','user-or-media-changed','seek-timeout','seek-failed','media-error','capture-not-owned','invalid-time'].includes(message)?message:'current-page-control'};
  }
}
