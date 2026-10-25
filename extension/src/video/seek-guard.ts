// Serialized into ISOLATED. Only extension calls can arm/consume this single-use
// guard. MAIN supplies untrusted media evidence, never this lifecycle revision.
export async function guardMedia(action: 'observe' | 'prepare' | 'commit' | 'capture', revision?: number, token?: string, time?: number, forcePaused = false, captureLimits?:{edge:number;pixels:number;dataUrlChars:number;sample?:boolean}): Promise<{ code?: 'stale-binding' | 'read-failed' | 'capture-empty' | 'capture-tainted' | 'resource-limit'; revision?: number; mediaRevision?:number; currentSrc?:string; time?: number; paused?: boolean; dataUrl?:string; width?:number; height?:number; sample?:{luma:number[];sharpness:number;contrast:number} }> {
  type Pending = { token: string; video: HTMLVideoElement; valid: () => boolean; dispose: () => void; used: boolean };
  type State = { revision: number; mediaRevision:number; video?:HTMLVideoElement; detachVideo?:()=>void; pending?: Pending };
  const isolated = window as unknown as { navigation?: EventTarget; __vcampSeekGuard?: State };
  const stale = () => ({ code: 'stale-binding' as const });
  if (!isolated.navigation) return stale();
  if (!isolated.__vcampSeekGuard) {
    const state: State = { revision: 0,mediaRevision:0 };
    const invalidate = () => { state.revision++; state.pending?.dispose(); };
    // This function is serialized: keep route normalization local. A site can
    // replace history state while the same decoder continues normal playback.
    const route = () => {
      const url=new URL(location.href),part=Number(url.searchParams.get('p')??1);
      return url.origin==='https://www.bilibili.com'&&/^\/video\/BV[0-9A-Za-z]+\/?$/.test(url.pathname)&&Number.isSafeInteger(part)&&part>0?`${url.origin}${url.pathname.replace(/\/$/,'')}?p=${part}`:url.href;
    };
    let selected=route();
    isolated.navigation.addEventListener('currententrychange', () => {
      const next=route();
      if(next!==selected){selected=next;invalidate();}
      else state.pending?.dispose();
    });
    window.addEventListener('pagehide', invalidate);
    window.addEventListener('pageshow', invalidate);
    isolated.__vcampSeekGuard = state;
  }
  const state = isolated.__vcampSeekGuard;
  state.mediaRevision??=0;
  const currentVideo=document.querySelector('video')??undefined;
  if(state.video!==currentVideo){
    state.detachVideo?.();state.video=currentVideo;state.mediaRevision++;
    if(currentVideo){
      const changed=()=>{state.mediaRevision++;state.pending?.dispose();};
      for(const event of ['emptied','loadstart','loadedmetadata'])currentVideo.addEventListener(event,changed);
      state.detachVideo=()=>{for(const event of ['emptied','loadstart','loadedmetadata'])currentVideo.removeEventListener(event,changed);};
    }else state.detachVideo=undefined;
  }
  if (action === 'observe') return { revision: state.revision,mediaRevision:state.mediaRevision,currentSrc:currentVideo?.currentSrc??'' };
  if (revision !== state.revision || !token) return stale();
  if (action === 'prepare') {
    state.pending?.dispose();
    const video = document.querySelector('video');
    if (!video || video.readyState < 1) return stale();
    const src = video.currentSrc, url = location.href;
    let active = true;
    const invalidate = () => { active = false; };
    video.addEventListener('emptied', invalidate);
    video.addEventListener('loadstart', invalidate);
    const pending: Pending = {
      token, video, used: false,
      valid: () => active && revision === state.revision && location.href === url && document.querySelector('video') === video && video.currentSrc === src && video.readyState >= 1,
      dispose: () => {
        active = false; clearTimeout(timer);
        video.removeEventListener('emptied', invalidate); video.removeEventListener('loadstart', invalidate);
        if (state.pending === pending) state.pending = undefined;
      }
    };
    const timer = setTimeout(pending.dispose, 15000);
    state.pending = pending;
    return { revision: state.revision };
  }
  const pending = state.pending;
  if (!pending || pending.token !== token || pending.used) return stale();
  pending.used = true;
  const video = pending.video;
  try {
    if(action==='capture') {
      const deadline=performance.now()+2000;
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)return {code:'read-failed'};
      while(performance.now()<deadline) {
        if(!pending.valid())return stale();
        if(video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0){
          const limits=captureLimits??{edge:1280,pixels:1280*720,dataUrlChars:1398126};
          let scale=Math.min(1,limits.edge/video.videoWidth,limits.edge/video.videoHeight,Math.sqrt(limits.pixels/(video.videoWidth*video.videoHeight)));
          try {
            const capturedTime=video.currentTime;
            for(let attempt=0;attempt<8;attempt++){
              canvas.width=Math.max(1,Math.floor(video.videoWidth*scale));canvas.height=Math.max(1,Math.floor(video.videoHeight*scale));
              ctx.drawImage(video,0,0,canvas.width,canvas.height);
              const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
              // Transparent decode placeholders fail; opaque black is a valid frame.
              let opaque=false;for(let i=3;i<pixels.length;i+=4)if(pixels[i]){opaque=true;break;}
              if(!opaque)break;
              const dataUrl=canvas.toDataURL('image/png');
              if(dataUrl.length<=limits.dataUrlChars){
                if(!pending.valid()||document.dispatchEvent(new Event(token,{cancelable:true}))||!pending.valid())return stale();
                let sample: { luma:number[]; sharpness:number; contrast:number } | undefined;
                if (captureLimits?.sample) {
                  const thumb=document.createElement('canvas');thumb.width=64;thumb.height=36;
                  const small=thumb.getContext('2d',{willReadFrequently:true})!;small.drawImage(canvas,0,0,64,36);
                  const rgba=small.getImageData(0,0,64,36).data,luma:number[]=[];
                  for(let i=0;i<rgba.length;i+=4)luma.push(Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]));
                  // Keep the tiny map only for conservative duplicate checks.
                  // Finer pixels retain more local edges for blur comparison;
                  // neither metric establishes that specific text is readable.
                  thumb.width=256;thumb.height=144;small.drawImage(canvas,0,0,256,144);
                  const detail=small.getImageData(0,0,256,144).data,gray:number[]=[];
                  for(let i=0;i<detail.length;i+=4)gray.push(Math.round(.299*detail[i]+.587*detail[i+1]+.114*detail[i+2]));
                  const mean=gray.reduce((n,v)=>n+v,0)/gray.length;
                  let edges=0;for(let y=1;y<143;y++)for(let x=1;x<255;x++){const i=y*256+x;edges+=Math.abs(4*gray[i]-gray[i-1]-gray[i+1]-gray[i-256]-gray[i+256]);}
                  sample={luma,sharpness:edges/(142*254),contrast:Math.sqrt(gray.reduce((n,v)=>n+(v-mean)**2,0)/gray.length)};
                }
                return {dataUrl,width:canvas.width,height:canvas.height,time:capturedTime,paused:video.paused,...(sample?{sample}:{})};
              }
              if(!pending.valid())return stale();
              scale*=.8;
            }
          }catch(error){return {code:error instanceof DOMException&&error.name==='SecurityError'?'capture-tainted':'read-failed'};}
        }
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      return {code:'capture-empty'};
    }
    // Synchronous read-only MAIN confirmation rechecks selected/decoded identity
    // at the final boundary. No binding, time or write authority crosses this event.
    // A page can forge media evidence, just as it can forge player metadata; it
    // cannot override the isolated navigation/media guard checked afterwards.
    if (!pending.valid() || document.dispatchEvent(new Event(token, { cancelable: true })) || !pending.valid()) return stale();
    if (!Number.isFinite(time) || time! < 0 || !Number.isFinite(video.duration) || time! > video.duration) return { code: 'read-failed' as const };
    if (forcePaused) video.pause();
    const paused = forcePaused || video.paused;
    if (Math.abs(video.currentTime - time!) > 0.01) {
      try {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: boolean) => { clearTimeout(timer); video.removeEventListener('seeked', success); video.removeEventListener('error', failure); error ? reject() : resolve(); };
          const success = () => finish(), failure = () => finish(true);
          const timer = setTimeout(failure, 8000);
          video.addEventListener('seeked', success); video.addEventListener('error', failure);
          // No await between the last trusted guard check and this native write.
          try { video.currentTime = time!; } catch { failure(); }
        });
      } catch { return { code: 'read-failed' as const }; }
    }
    if (!pending.valid()) return stale();
    if (forcePaused) video.pause();
    if (video.paused !== paused || Math.abs(video.currentTime - time!) > 0.75) return { code: 'read-failed' as const };
    return { time: video.currentTime, paused: video.paused };
  } finally { pending.dispose(); }
}
