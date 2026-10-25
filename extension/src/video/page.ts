import type { SourceBinding } from '../contracts/generation';

// Serialized into MAIN. Site values are untrusted media metadata, never capabilities.
export async function inspectMedia(
  binding?: SourceBinding | null,
  confirmation?: string | null,
  decoderProof?: { mediaRevision: number; currentSrc: string; previousMediaRevision?: number; previousCurrentSrc?: string; confirmedSource?:{videoId:string;partId:string} } | null
) {
  const rejected = () => binding ? { code: 'stale-binding' as const } : { status: 'loading' as const };
  const beforeUrl = location.href;
  const url = new URL(location.href);
  const match = /^\/video\/(BV[0-9A-Za-z]+)\/?$/.exec(url.pathname);
  if (url.origin !== 'https://www.bilibili.com' || !match) return binding ? rejected() : { status: 'unsupported' as const };
  type VideoState={bvid?:string;title?:string;pic?:string;pages?:{page:number;cid:number;part:string}[]};
  type StateCache=Record<string,{savedAt:number;state:VideoState}>;
  type RequestEntry = { name: string; startTime: number };
  type RequestLog = { entries: RequestEntry[]; observer?: PerformanceObserver };
  const pageWindow=window as unknown as {__INITIAL_STATE__?:{videoData?:VideoState};__vcampVideoStateCache?:StateCache;__vcampRequestLog?:RequestLog};
  // The resource timing buffer fills on long-lived video pages. Observe new
  // entries independently of that buffer; otherwise a real SPA request can be
  // invisible forever, while refresh/back appear to repair the binding.
  if (!pageWindow.__vcampRequestLog) {
    const log: RequestLog = { entries: [] };
    const record = (entries: readonly Pick<PerformanceEntry, 'name' | 'startTime'>[]) => {
      for (const entry of entries) {
        try {
          if (entry.name.length > 8192) continue;
          const request = new URL(entry.name);
          if (request.origin !== 'https://api.bilibili.com' || !['/x/web-interface/view', '/x/player/wbi/playurl', '/x/player/playurl', '/x/player/wbi/v2'].includes(request.pathname)) continue;
          log.entries = [...log.entries.filter(previous => previous.name !== entry.name).slice(-63), { name: entry.name, startTime: entry.startTime ?? 0 }];
        } catch {}
      }
    };
    record(performance.getEntriesByType('resource'));
    if (typeof PerformanceObserver !== 'undefined') {
      const observer = new PerformanceObserver(list => record(list.getEntries()));
      observer.observe({ type: 'resource', buffered: true });
      log.observer = observer;
    }
    // These are bounded, page-local untrusted request hints, never capabilities.
    pageWindow.__vcampRequestLog = log;
  }
  const resourceNames = () => [...performance.getEntriesByType('resource'), ...pageWindow.__vcampRequestLog!.entries]
    .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0)).map(entry => entry.name);
  const raw = pageWindow.__INITIAL_STATE__?.videoData;
  // Snapshot primitive identity before any await; site objects can mutate in place.
  const snapshot=(value?:VideoState)=>value&&{bvid:value.bvid,title:value.title,pic:value.pic,pages:value.pages?.map(item=>({page:item.page,cid:item.cid,part:item.part}))};
  let state=snapshot(raw),initialStateMatches=state?.bvid===match[1];
  if(!initialStateMatches){
    const cached=pageWindow.__vcampVideoStateCache?.[match[1]];
    state=cached&&Date.now()-cached.savedAt<10*60*1000?snapshot(cached.state):undefined;
    if(!state){
      const candidate=resourceNames().reverse().find(name=>{try{const request=new URL(name);return request.origin==='https://api.bilibili.com'&&request.pathname==='/x/web-interface/view'&&request.searchParams.get('bvid')===match[1];}catch{return false;}});
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
      try{
        const response=await fetch(candidate??`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(match[1])}`,{credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal});
        const json=await response.json().catch(()=>null);
        if(response.ok&&json?.code===0&&json.data?.bvid===match[1]){
          state=snapshot(json.data);
          if(state?.title&&state.pages?.length)pageWindow.__vcampVideoStateCache={...(pageWindow.__vcampVideoStateCache??{}),[match[1]]:{savedAt:Date.now(),state}};
        }
      }catch{}finally{clearTimeout(timer);}
    }
  }
  const p = Number(url.searchParams.get('p') ?? 1);
  const page = state?.pages?.find(item => item.page === p);
  if (!state || state.bvid !== match[1] || !page || !Number.isSafeInteger(page.cid) || page.cid <= 0 || !state.title) return rejected();
  if (binding && (binding.videoId !== state.bvid || binding.partId !== String(page.cid))) return rejected();
  const selectionMatches = () => {
    // Observations may overlap harmless history updates during normal playback.
    // Commands still require the exact URL as well as the isolated one-shot
    // guard; only read-only recognition uses the selected BV/P identity.
    if(binding&&location.href!==beforeUrl)return false;
    const currentUrl=new URL(location.href);
    if(currentUrl.origin!==url.origin||currentUrl.pathname.replace(/\/$/,'')!==url.pathname.replace(/\/$/,'')||Number(currentUrl.searchParams.get('p')??1)!==p)return false;
    if(!initialStateMatches)return new URL(location.href).pathname.replace(/\/$/,'')===`/video/${state.bvid}`;
    const current = pageWindow.__INITIAL_STATE__?.videoData;
    return current?.bvid === state.bvid && current?.pages?.find(item => item.page === p)?.cid === page.cid;
  };
  const video = document.querySelector('video');
  const playRequest = (name:string) => { try { const request=new URL(name);return request.origin==='https://api.bilibili.com'&&['/x/player/wbi/playurl','/x/player/playurl'].includes(request.pathname)?request:undefined; } catch { return undefined; } };
  const latestPlayRequest=()=>resourceNames().filter(name=>playRequest(name)).at(-1);
  const hasVideoResource=(reply:unknown)=>{
    const json=reply as {code?:number;data?:{dash?:{video?:{baseUrl?:string;base_url?:string;backupUrl?:string[];backup_url?:string[]}[]};durl?:{url?:string;backup_url?:string[]}[]}};
    if(json?.code!==0)return false;
    return [...(json.data?.dash?.video??[]).flatMap(item=>[item.baseUrl,item.base_url,...(item.backupUrl??item.backup_url??[])]),...(json.data?.durl??[]).flatMap(item=>[item.url,...(item.backup_url??[])])].some(value=>{try{const parsed=new URL(String(value));return parsed.protocol==='https:';}catch{return false;}});
  };
  let live: { bvid?: string; cid?: number } | undefined;
  let commitProof = () => {};
  let unchanged = () => false;
  try {
    const player = (window as unknown as { player?: { getVideoMessage?: () => typeof live; getManifest?: () => typeof live; mediaElement?: () => HTMLVideoElement; getMediaInfo?: () => { playUrl?: string } } }).player;
    const message = player?.getVideoMessage?.();
    live = message && { bvid: message.bvid, cid: message.cid };
    if (!live?.cid && player?.getManifest) {
      const message = player.getManifest();
      const manifest = message && { bvid: message.bvid, cid: message.cid };
      const decoded = new URL(player.getMediaInfo?.().playUrl ?? '');
      const decodedCid = /^(\d+)-/.exec(decoded.pathname.split('/').at(-1) ?? '')?.[1];
      const canonicalCDN=decoded.hostname.endsWith('.bilivideo.com');
      // Observed in the real Bilibili player after idle/navigation. Peer delivery
      // keeps the video file path, but is not eligible for the cid-only shortcut:
      // it also needs an independently associated inline/API video response.
      const peerHost=(host:string)=>host.endsWith('.edge.mountaintoys.cn')||host.endsWith('.mcdn.bilivideo.cn');
      const deliveryHost=(host:string)=>host.endsWith('.bilivideo.com')||peerHost(host);
      // Peer responses can advertise a non-default TLS port (observed: 4483).
      // We inspect this address only; no video/CDN request or permission is added.
      // Manifest alone can announce a new P before the old decoder has gone away.
      if (!video || player.mediaElement?.() !== video || video.readyState < 1 || decoded.protocol !== 'https:' || !deliveryHost(decoded.hostname) || decoded.username || decoded.password || (decoded.port&&!peerHost(decoded.hostname)) || !Number.isSafeInteger(manifest?.cid) || manifest?.cid !== page.cid || (manifest.bvid && manifest.bvid !== state.bvid)) return rejected();
      const currentSrc = video.currentSrc;
      unchanged = () => {
        const current = player.getManifest?.();
        return selectionMatches() && document.querySelector('video') === video && player === (window as unknown as { player?: unknown }).player && player.mediaElement?.() === video && video.readyState >= 1 && video.currentSrc === currentSrc && current?.cid === manifest.cid && current?.bvid === manifest.bvid && player.getMediaInfo?.().playUrl === decoded.href;
      };
      if (decodedCid && decodedCid !== String(manifest.cid)) return rejected();
      if (!decodedCid||!canonicalCDN) {
        // A replay can route the same file to a different Bilibili CDN mirror.
        // Compare the complete path only after validating both HTTPS CDN hosts;
        // neither a rotating mirror nor signature is part of media identity.
        const key = (value: unknown) => {
          try { const parsed = new URL(String(value)); return parsed.protocol === 'https:' && deliveryHost(parsed.hostname) && !parsed.username && !parsed.password && (!parsed.port||peerHost(parsed.hostname)) ? parsed.pathname : ''; } catch { return ''; }
        };
        const includesSource = (reply: unknown) => {
          const json = reply as { code?: number; data?: { dash?: { video?: { baseUrl?: string; base_url?: string; backupUrl?: string[]; backup_url?: string[] }[] }; durl?: { url?: string; backup_url?: string[] }[] } };
          if (json?.code !== 0) return false;
          const urls = [...(json.data?.dash?.video ?? []).flatMap(item => [item.baseUrl, item.base_url, ...(item.backupUrl ?? item.backup_url ?? [])]), ...(json.data?.durl ?? []).flatMap(item => [item.url, ...(item.backup_url ?? [])])];
          return urls.some(value => key(value) === key(decoded.href));
        };
        // The server's inline JSON belongs to the original document navigation,
        // not mutable __INITIAL_STATE__.cid or the current SPA URL.
        const memory = window as unknown as { __vcampMediaPaths?: { bvid: string; cid: number; path: string }[] };
        const proofs = memory.__vcampMediaPaths ?? [];
        // Keep full URLs in the bounded cache so entries from an older injected
        // script can be revalidated by the same host/path normalization.
        const path = decoded.origin + decoded.pathname;
        // These are untrusted source associations, not bindings or permissions.
        // A path known for another part is ambiguous and cannot authorize a seek.
        if (proofs.some(proof => key(proof.path) === key(path) && (proof.bvid !== state.bvid || proof.cid !== page.cid))) return rejected();
        let confirmed = proofs.some(proof => key(proof.path) === key(path) && proof.bvid === state.bvid && proof.cid === page.cid);
        const navigation = performance.getEntriesByType('navigation')[0]?.name;
        if (!confirmed && navigation) {
          const initial = new URL(navigation);
          if (initial.origin === url.origin && initial.pathname.replace(/\/$/, '') === `/video/${state.bvid}` && state.pages?.find(item => item.page === Number(initial.searchParams.get('p') ?? 1))?.cid === page.cid) {
            for (const script of document.scripts) {
              const json = /^\s*window\.__playinfo__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(script.textContent ?? '');
              if (json) { confirmed = includesSource(JSON.parse(json[1])); break; }
            }
          }
        }
        if (!confirmed) {
          const candidate = resourceNames().reverse().find(name => {
            try { const request = new URL(name); return request.origin === 'https://api.bilibili.com' && request.pathname === '/x/player/wbi/playurl' && request.searchParams.get('bvid') === state.bvid && request.searchParams.get('cid') === String(page.cid); } catch { return false; }
          });
          if (!candidate) return rejected();
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          try {
            const response = await fetch(candidate, { credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal });
            confirmed = response.ok && includesSource(await response.json());
          } finally { clearTimeout(timer); }
        }
        if (!confirmed || !unchanged()) return rejected();
        commitProof = () => {
          const latest = memory.__vcampMediaPaths ?? [];
          if (!latest.some(proof => key(proof.path) === key(path))) memory.__vcampMediaPaths = [...latest.slice(-31), { bvid: state.bvid!, cid: page.cid, path }];
        };
      }
      live = manifest;
    } else {
      unchanged = () => {
        const current = player?.getVideoMessage?.();
        return selectionMatches() && document.querySelector('video') === video && player === (window as unknown as { player?: unknown }).player && current?.cid === live?.cid && current?.bvid === live?.bvid;
      };
    }
  } catch { return rejected(); }
  // Current Bilibili builds can hide the legacy window.player identity APIs and
  // feed MSE through a blob URL. In that shape, bind only after three independent
  // facts agree: selected URL/view metadata, the latest exact playurl request,
  // and a ready blob decoder. The isolated-world route/media guard additionally
  // prevents a new SPA URL from reusing the previous decoder.
  const decoderChanged=decoderProof?.previousMediaRevision===undefined||decoderProof.mediaRevision>decoderProof.previousMediaRevision||decoderProof.currentSrc!==decoderProof.previousCurrentSrc;
  const isolatedSourceMatches = !decoderProof?.currentSrc || decoderProof.currentSrc === video?.currentSrc;
  if ((!live || !Number.isSafeInteger(live.cid) || live.cid! <= 0) && decoderChanged && isolatedSourceMatches && video && video.readyState >= 1 && video.currentSrc.startsWith('blob:')) {
    // The Worker supplies this hint only when document, route generation, native
    // media lifecycle and blob source still match a previously verified decoder.
    // Do not replay playurl on every timeupdate or mistake preloads for playback.
    if(decoderProof?.confirmedSource?.videoId===state.bvid&&decoderProof.confirmedSource.partId===String(page.cid)){
      const currentSrc=video.currentSrc;
      unchanged=()=>selectionMatches()&&document.querySelector('video')===video&&video.readyState>=1&&video.currentSrc===currentSrc;
      if(unchanged())live={bvid:state.bvid,cid:page.cid};
    }else{
      const candidate=latestPlayRequest(),request=candidate?playRequest(candidate):undefined;
      if(request?.searchParams.get('bvid')===state.bvid&&request.searchParams.get('cid')===String(page.cid)){
        const currentSrc=video.currentSrc;
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
        try{
          const response=await fetch(request.href,{credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal});
          const reply=await response.json().catch(()=>null);
          if(response.ok&&hasVideoResource(reply)){
            unchanged=()=>selectionMatches()&&document.querySelector('video')===video&&video.readyState>=1&&video.currentSrc===currentSrc&&latestPlayRequest()===candidate;
            if(unchanged())live={bvid:state.bvid,cid:page.cid};
          }
        }catch{}finally{clearTimeout(timer);}
      }
    }
  }
  // URL/initial metadata can move before the decoder. Unknown identity is not readiness.
  if (!live || !Number.isSafeInteger(live.cid) || live.cid! <= 0 || String(live.cid) !== String(page.cid) || (live.bvid && live.bvid !== state.bvid)) return rejected();
  if (!unchanged()) return rejected();
  commitProof();
  if (confirmation) {
    // A one-shot synchronous identity read at commit; this never performs a seek.
    const confirm = (event: Event) => { clearTimeout(timer); if (unchanged()) event.preventDefault(); };
    const timer = setTimeout(() => document.removeEventListener(confirmation, confirm), 15000);
    document.addEventListener(confirmation, confirm, { once: true });
  }
  let coverUrl:string|undefined;try{const u=new URL(String(state.pic).startsWith('//')?'https:'+state.pic:String(state.pic));if(/^https?:$/.test(u.protocol)&&!u.username&&!u.password&&!u.port&&/^i[0-2]\.hdslb\.com$/.test(u.hostname)&&/^\/bfs\//.test(u.pathname))coverUrl='https://'+u.hostname+u.pathname;}catch{}
  const playback = video ? { time: Math.max(0, video.currentTime), duration: Number.isFinite(video.duration) ? video.duration : null, paused: video.paused } : undefined;
  return { status: 'supported' as const, source: { ...(coverUrl?{coverUrl}:{}), platform: 'bilibili' as const, videoId: state.bvid, partId: String(page.cid), title: `${state.title}${state.pages!.length > 1 ? ` · P${p} ${page.part}` : ''}`.slice(0, 1000), videoTitle: state.title.slice(0, 1000), partTitle: page.part.slice(0, 1000), pageNumber: p, partCount: state.pages!.length }, playback };
}

export async function readMetadata(binding: SourceBinding) {
  const requestWindow = window as unknown as { __vcampRequestLog?: { entries: { name: string; startTime: number }[] } };
  const matches = () => {
    const source=window as unknown as {__INITIAL_STATE__?:{videoData?:{bvid?:string;pages?:{page:number;cid:number}[]}};__vcampVideoStateCache?:Record<string,{state:{bvid?:string;pages?:{page:number;cid:number}[]}}>};
    const initial=source.__INITIAL_STATE__?.videoData;
    const state=initial?.bvid===binding.videoId?initial:source.__vcampVideoStateCache?.[binding.videoId]?.state;
    const url = new URL(location.href);
    return url.origin === 'https://www.bilibili.com' && url.pathname.replace(/\/$/, '') === `/video/${binding.videoId}` && state?.bvid === binding.videoId && String(state.pages?.find(item => item.page === Number(url.searchParams.get('p') ?? 1))?.cid) === binding.partId;
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    // Only reuse an already generated site request; no WBI signing or cookie access.
    for (let attempt = 0; attempt < 20 && !controller.signal.aborted; attempt++) {
      if (!matches()) return { http: 409, json: null };
      const candidate = [...performance.getEntriesByType('resource'), ...(requestWindow.__vcampRequestLog?.entries ?? [])]
        .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0)).map(entry => entry.name).reverse().find(name => {
        try { const url = new URL(name); return url.origin === 'https://api.bilibili.com' && url.pathname === '/x/player/wbi/v2' && url.searchParams.get('cid') === binding.partId; } catch { return false; }
      });
      if (candidate) {
        const response = await fetch(candidate, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        const json = await response.json().catch(() => null);
        if (!matches()) return { http: 409, json: null };
        return { http: response.status, json: { code: json?.code, data: { need_login_subtitle: json?.data?.need_login_subtitle, subtitle: json?.data?.subtitle } } };
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    return { http: 0, json: null };
  } catch { return { http: 0, json: null }; }
  finally { clearTimeout(timer); }
}
