import { ApplicationError, type VideoKey } from '../contracts/application';
import { pauseLibraryMedia } from './library-pause';
import type { SourceBinding } from '../contracts/generation';
import { inspectMedia, readMetadata } from './page';
import { guardMedia } from './seek-guard';
import { readCompleteSubtitles } from './subtitles';
import { VideoSessions, type SiteAdapter } from './sessions';

export const videoOrigins = ['https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://aisubtitle.hdslb.com/*'];
// Only the selected BV and P distinguish same-document media navigation.
// History state, tracking parameters, playback timestamps and comment hashes do not.
function mediaRoute(raw: string) {
  try {
    const url=new URL(raw),part=Number(url.searchParams.get('p')??1);
    if(url.origin==='https://www.bilibili.com'&&/^\/video\/BV[0-9A-Za-z]+\/?$/.test(url.pathname)&&Number.isSafeInteger(part)&&part>0)return `${url.origin}${url.pathname.replace(/\/$/,'')}?p=${part}`;
  }catch{}
  return raw;
}
export function createChromeVideo(changed: () => void, recordPosition?: (source: VideoKey, time: number, observedAt: number) => Promise<void>) {
  const libraryTabs = new Set<number>();
  const markers = new Map<number, number>();
  const routes = new Map<number,string>();
  type CurrentView=Awaited<ReturnType<VideoSessions['observe']>>;
  const observeQueues = new Map<number,{current:Promise<CurrentView>;followup?:Promise<CurrentView>}>();
  const recentTabs = new Map<number,number>();
  const stabilizationTimers=new Map<number,Set<ReturnType<typeof setTimeout>>>();
  const pendingMedia = new Map<number, { key: string; since: number }>();
  const guards = new Map<number, { documentId: string; marker: number; revision: number; mediaRevision:number; currentSrc:string; mediaTracked:boolean }>();
  type VerifiedDecoder={documentId:string;marker:number;revision:number;mediaRevision:number;currentSrc:string;source:{videoId:string;partId:string}};
  const verifiedDecoders=new Map<number,VerifiedDecoder>();
  const verifiedSource=(tabId:number,identity:Omit<VerifiedDecoder,'source'>)=>{
    const known=verifiedDecoders.get(tabId);
    return known&&known.documentId===identity.documentId&&known.marker===identity.marker&&known.revision===identity.revision&&known.mediaRevision===identity.mediaRevision&&known.currentSrc===identity.currentSrc?known.source:undefined;
  };
  const routeBaselines=new Map<number,{documentId:string;mediaRevision:number;currentSrc:string}>();
  const site: SiteAdapter = {
    async observe(tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if(tab.url&&!routes.has(tabId))routes.set(tabId,mediaRoute(tab.url));
        if (!tab.url || !/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+/.test(tab.url)) return { documentId: '', marker: 'unsupported', source: null, status: 'unsupported' };
        if (!await chrome.permissions.contains({ origins: [videoOrigins[0]] })) return { documentId: '', marker: 'denied', source: null, status: 'permission-denied' };
        const marker = markers.get(tabId) ?? 0;
        const [guard] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: guardMedia, args: ['observe'] });
        if (!guard.documentId || guard.result?.revision === undefined) throw new Error();
        const mediaTracked=guard.result.mediaRevision!==undefined,mediaRevision=guard.result.mediaRevision??0,currentSrc=guard.result.currentSrc??'';
        const baseline=routeBaselines.get(tabId);
        const confirmedSource=verifiedSource(tabId,{documentId:guard.documentId,marker,revision:guard.result.revision,mediaRevision,currentSrc});
        const decoderProof=mediaTracked?{mediaRevision,currentSrc,...(confirmedSource?{confirmedSource}:{}),...(baseline?.documentId===guard.documentId?{previousMediaRevision:baseline.mediaRevision,previousCurrentSrc:baseline.currentSrc}:{})}:undefined;
        const [result] = await chrome.scripting.executeScript({
          target: { tabId, documentIds: [guard.documentId] },
          world: 'MAIN',
          func: inspectMedia,
          args: [null, null, decoderProof ?? null]
        });
        if (!result.documentId) throw new Error();
        if (marker !== (markers.get(tabId) ?? 0)) return { documentId: result.documentId, marker: `${markers.get(tabId)}`, source: null, status: 'loading' };
        const media = result.result!;
        if (!media.status) throw new Error();
        guards.set(tabId, { documentId: result.documentId, marker, revision: guard.result.revision,mediaRevision,currentSrc,mediaTracked });
        if(media.status==='supported'&&mediaTracked)verifiedDecoders.set(tabId,{documentId:result.documentId,marker,revision:guard.result.revision,mediaRevision,currentSrc,source:{videoId:media.source.videoId,partId:media.source.partId}});
        const key = `${result.documentId}:${marker}:${tab.url}`;
        if (media.status === 'loading') {
          const pending = pendingMedia.get(tabId);
          if (!pending || pending.key !== key) pendingMedia.set(tabId, { key, since: Date.now() });
          else if (Date.now() - pending.since > 12000) return { documentId: result.documentId, marker: `${marker}`, source: null, status: 'read-failed' };
        } else pendingMedia.delete(tabId);
        return { documentId: result.documentId, marker: `${marker}:${guard.result.revision}`, source: media.status === 'supported' ? media.source : null, playback: media.status === 'supported' ? media.playback : undefined, status: media.status === 'supported' ? undefined : media.status };
      } catch { const denied=!await chrome.permissions.contains({origins:[videoOrigins[0]]}); return { documentId: '', marker: denied?'denied':'failed', source: null, status: denied?'permission-denied':'read-failed' }; }
    },
    async read(binding, signal) {
      if(!await chrome.permissions.contains({origins:videoOrigins.slice(1)}))return {status:'browser-permission-denied',cues:[],language:null};
      return readCompleteSubtitles({
        metadata: async () => {
          const [result] = await chrome.scripting.executeScript({ target: { tabId: binding.tabId, documentIds: [binding.documentId] }, world: 'MAIN', func: readMetadata, args: [binding] });
          if (signal.aborted || result.documentId !== binding.documentId) throw new Error();
          return result.result!;
        },
        track: async (url, outer) => {
          const controller = new AbortController();
          const cancel = () => controller.abort();
          outer.addEventListener('abort', cancel, { once: true });
          const timer = setTimeout(cancel, 12000);
          try {
            if (outer.aborted) throw new Error();
            const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
            const rawText=await response.text();let json:unknown=null;try{json=JSON.parse(rawText);}catch{}
            return { http: response.status, json, rawText };
          } finally { clearTimeout(timer); outer.removeEventListener('abort', cancel); }
        }
      }, signal);
    },
    async seek(binding, time, policy) {
      const guard = guards.get(binding.tabId);
      const valid = () => guard && guard.documentId === binding.documentId && guard.marker === (markers.get(binding.tabId) ?? 0) && sessions.isCurrent(binding);
      if (!valid()) throw new ApplicationError('stale-binding');
      const target = { tabId: binding.tabId, documentIds: [binding.documentId] };
      const token = `vcamp-media-${crypto.randomUUID()}`;
      const [armed] = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: guardMedia, args: ['prepare', guard!.revision, token] });
      if (!valid() || armed?.documentId !== binding.documentId || armed.result?.revision !== guard!.revision) throw new ApplicationError('stale-binding');
      const baseline = routeBaselines.get(binding.tabId);
      const confirmedSource=verifiedSource(binding.tabId,guard!);
      const decoderProof = guard!.mediaTracked
        ? {
            mediaRevision: guard!.mediaRevision,
            currentSrc: guard!.currentSrc,
            ...(confirmedSource?{confirmedSource}:{}),
            ...(baseline?.documentId === guard!.documentId
              ? { previousMediaRevision: baseline.mediaRevision, previousCurrentSrc: baseline.currentSrc }
              : {})
          }
        : undefined;
      const [proof] = await chrome.scripting.executeScript({
        target,
        world: 'MAIN',
        func: inspectMedia,
        args: [binding, token, decoderProof ?? null]
      });
      if (!valid() || proof?.documentId !== binding.documentId || proof.result?.status !== 'supported') throw new ApplicationError('stale-binding');
      const [result] = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: guardMedia, args: ['commit', guard!.revision, token, time, policy === 'pause'] });
      if (!result || result.documentId !== binding.documentId) throw new ApplicationError('stale-binding');
      const value = result.result!;
      if (value.code) throw new ApplicationError(value.code);
      if (!('time' in value) || value.time === undefined || value.paused === undefined) throw new ApplicationError('stale-binding');
      return { time: value.time, paused: value.paused };
    }
  };
  const sessions = new VideoSessions(site, changed);
  const observe = (tabId: number):Promise<CurrentView> => {
    const execute=async()=>{const observedAt=Date.now(),view=await sessions.observe(tabId);if(recordPosition&&view.source&&view.binding&&view.playback&&sessions.isCurrent(view.binding)&&!libraryTabs.has(tabId))await recordPosition(view.source,view.playback.time,observedAt).catch(()=>{});return view;};
    const active=observeQueues.get(tabId);
    if(active){
      // Waiters share one subsequent inspection, never an unbounded drain.
      // Playback can keep delivering events while the inspection is running.
      active.followup??=active.current.catch(()=>undefined).then(()=>{
        if(observeQueues.get(tabId)===active)observeQueues.delete(tabId);
        return observe(tabId);
      });
      return active.followup;
    }
    const run={} as {current:Promise<CurrentView>;followup?:Promise<CurrentView>};run.current=execute();observeQueues.set(tabId,run);
    void run.current.finally(()=>{if(observeQueues.get(tabId)===run&&!run.followup)observeQueues.delete(tabId);}).catch(()=>{});return run.current;
  };
  const stabilize=(tabId:number)=>{
    const prior=stabilizationTimers.get(tabId);if(prior)for(const timer of prior)clearTimeout(timer);
    const timers=new Set<ReturnType<typeof setTimeout>>();stabilizationTimers.set(tabId,timers);
    for(const delay of [0,120,350,800,1600,3200,6400,12000]){
      const timer=setTimeout(()=>{timers.delete(timer);void observe(tabId).catch(()=>{});if(!timers.size&&stabilizationTimers.get(tabId)===timers)stabilizationTimers.delete(tabId);},delay);
      timers.add(timer);
    }
  };
  async function setup() {
    if (!await chrome.permissions.contains({ origins: [videoOrigins[0]] })) return;
    if (!(await chrome.scripting.getRegisteredContentScripts({ ids: ['vcamp-video'] })).length) await chrome.scripting.registerContentScripts([{ id: 'vcamp-video', matches: ['https://www.bilibili.com/video/*'], js: ['assets/observer.js'], runAt: 'document_idle', world: 'ISOLATED' }]);
    for (const tab of await chrome.tabs.query({ url: 'https://www.bilibili.com/video/*' })) if (tab.id !== undefined) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['assets/observer.js'] }).catch(() => {});
      stabilize(tab.id);
    }
  }
  const permissionsChanged=()=>{
    verifiedDecoders.clear();
    void chrome.tabs.query({}).then(tabs=>{
      for(const tab of tabs)if(tab.id!==undefined){observeQueues.delete(tab.id);sessions.invalidate(tab.id,true);}
      void setup();changed();
    });
  };
  chrome.permissions.onAdded.addListener(permissionsChanged);
  chrome.permissions.onRemoved.addListener(permissionsChanged);
  const navigation = (details: { tabId: number; frameId: number; url?:string }) => {
    if (details.frameId !== 0) return;
    verifiedDecoders.delete(details.tabId);
    if(details.url)routes.set(details.tabId,mediaRoute(details.url));else routes.delete(details.tabId);
    const previous=guards.get(details.tabId);
    if(previous?.mediaTracked)routeBaselines.set(details.tabId,{documentId:previous.documentId,mediaRevision:previous.mediaRevision,currentSrc:previous.currentSrc});else routeBaselines.delete(details.tabId);
    markers.set(details.tabId, (markers.get(details.tabId) ?? 0) + 1);
    sessions.invalidate(details.tabId);
    if (libraryTabs.has(details.tabId)) void chrome.scripting.executeScript({ target: { tabId: details.tabId, frameIds: [0] }, world: 'ISOLATED', func: pauseLibraryMedia }).catch(() => {});
    stabilize(details.tabId);
  };
  chrome.webNavigation.onCommitted.addListener(navigation);
  chrome.webNavigation.onHistoryStateUpdated.addListener(details=>{
    if(details.frameId!==0)return;
    if(details.url&&routes.get(details.tabId)===mediaRoute(details.url))return;
    navigation(details);
  });
  chrome.tabs.onUpdated?.addListener((tabId,change,tab)=>{
    const url=change.url??(change.status==='loading'?tab.url:undefined);
    if(url&&/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+/.test(url)&&(change.status==='loading'||routes.get(tabId)!==mediaRoute(url)))stabilize(tabId);
  });
  chrome.tabs.onRemoved.addListener(tabId => { const timers=stabilizationTimers.get(tabId);if(timers)for(const timer of timers)clearTimeout(timer);stabilizationTimers.delete(tabId);sessions.remove(tabId); markers.delete(tabId);routes.delete(tabId); pendingMedia.delete(tabId); guards.delete(tabId);verifiedDecoders.delete(tabId);routeBaselines.delete(tabId); for(const [windowId,recent] of recentTabs)if(recent===tabId)recentTabs.delete(windowId); changed(); });
  chrome.tabs.onActivated.addListener(changed);
  void setup();
  return {
    async open(source: VideoKey, time: number) {
      if (!await chrome.permissions.contains({ origins: [videoOrigins[0]] })) throw new ApplicationError('permission-denied');
      if (!/^BV[0-9A-Za-z]+$/.test(source.videoId)) throw new ApplicationError('read-failed');
      // Reuse only a page whose observed decoder identity matches the persisted
      // source. A URL or the globally active video is never sufficient proof.
      for(const candidate of await chrome.tabs.query({url:`https://www.bilibili.com/video/${source.videoId}*`})){
        if(candidate.id===undefined)continue;
        const existing=await observe(candidate.id);
        if(existing.binding?.videoId!==source.videoId||existing.binding.partId!==source.partId)continue;
        const result=await sessions.seek(existing.binding,time,'preserve');
        await chrome.tabs.update(candidate.id,{active:true});changed();return result;
      }
      let pageNumber = source.pageNumber ?? Number(/ · P(\d+) /.exec(source.title)?.[1] ?? 0);
      if (!pageNumber) {
        const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(source.videoId)}`, { credentials: 'omit', signal: AbortSignal.timeout(10000) }).catch(() => null);
        const metadata = await response?.json().catch(() => null);
        pageNumber = metadata?.data?.pages?.find((page: { cid: number; page: number }) => String(page.cid) === source.partId)?.page;
        if (!response?.ok || metadata?.code !== 0 || !Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new ApplicationError('read-failed');
      }
      const url = `https://www.bilibili.com/video/${source.videoId}/?p=${pageNumber}&autoplay=0`;
      const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
      if (tab.id === undefined) throw new ApplicationError('read-failed');
      const tabId = tab.id; libraryTabs.add(tabId);
      try {
        // Register the controlled tab before navigation can dispatch onCommitted.
        await chrome.tabs.update(tabId, { url });
        await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: pauseLibraryMedia }).catch(() => {});
        const end = Date.now() + 20000;
        while (Date.now() < end) {
          const view = await observe(tabId);
          if (view.status === 'permission-denied') throw new ApplicationError('permission-denied');
          if (view.binding && view.playback?.duration !== null && view.playback?.duration !== undefined) {
            if (view.binding.videoId !== source.videoId || view.binding.partId !== source.partId) throw new ApplicationError('stale-binding');
            const [media] = await chrome.scripting.executeScript({ target: { tabId, documentIds: [view.binding.documentId] }, world: 'ISOLATED', func: () => {
              const video = document.querySelector('video');
              return !!video && video.readyState >= 2 && !video.seeking && video.seekable.length > 0;
            } });
            if (!media?.result) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
            try {
              const result = await sessions.seek(view.binding, time, 'pause');
              if (!result.paused) throw new ApplicationError('read-failed');
              changed(); return result;
            } catch (error) {
              if (!(error instanceof ApplicationError) || error.code !== 'stale-binding') throw error;
              const latest = await observe(tabId);
              if (!latest.binding || latest.binding.documentId !== view.binding.documentId || latest.binding.videoId !== source.videoId || latest.binding.partId !== source.partId) throw error;
            }
          }
          // Wait for real media readiness; success requires a validated native seek.
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new ApplicationError('read-failed');
      } finally {
        libraryTabs.delete(tabId);
        await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: () => { (window as unknown as { __vcampLibraryPause?: () => void }).__vcampLibraryPause?.(); } }).catch(() => {});
      }
    },
    observe,
    retry: (binding: SourceBinding) => sessions.retry(binding),
    seek: (binding: SourceBinding, time: number, policy: 'preserve') => sessions.seek(binding, time, policy),
    playback: (binding: SourceBinding) => sessions.playback(binding),
    async current(windowId?: number) {
      const [tab] = await chrome.tabs.query(windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId });
      if (tab?.id === undefined) return { source: null, binding: null, status: 'unsupported' as const, cues: [], language: null };
      const resolvedWindow=tab.windowId;
      if(!tab.url||/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+/.test(tab.url)){const view=await observe(tab.id);if(view.binding)recentTabs.set(resolvedWindow,tab.id);return view;}
      const recent=recentTabs.get(resolvedWindow);
      if(recent!==undefined)try{const candidate=await chrome.tabs.get(recent);if(candidate.windowId===resolvedWindow&&candidate.url&&/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+/.test(candidate.url))return observe(recent);}catch{}
      recentTabs.delete(resolvedWindow);
      return { source: null, binding: null, status: 'unsupported' as const, cues: [], language: null };
    }
  };
}
