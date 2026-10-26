import type { VideoKey } from '../contracts/application';
import type { SourceBinding } from '../contracts/generation';
import { sameBinding, type VideoView } from '../contracts/video';
import { ApplicationError } from '../contracts/application';

export interface Observation { documentId: string; marker: string; source: VideoKey | null; status?: 'unsupported' | 'permission-denied' | 'loading' | 'read-failed'; playback?: VideoView['playback'] }
export interface SiteAdapter {
  observe(tabId: number): Promise<Observation>;
  read(binding: SourceBinding, signal: AbortSignal): Promise<Pick<VideoView, 'status' | 'cues' | 'language' | 'tracks'>>;
  seek(binding: SourceBinding, time: number, policy: 'preserve' | 'pause'): Promise<{ time: number; paused: boolean }>;
}
type Entry = { signature: string; epoch: number; source: VideoKey | null; localSource: VideoKey | null; view: VideoView; controller?: AbortController; retryTimer?: ReturnType<typeof setTimeout>; readRevision: number };
type SessionView = VideoView & { source: VideoKey | null; localSource: VideoKey | null };
type ObservationRun = { current: Promise<SessionView>; followup?: Promise<SessionView> };
type ReadResult = Pick<VideoView,'status'|'cues'|'language'|'tracks'>;
export class VideoSessions {
  private revisions = new Map<number,number>();
  private entries = new Map<number, Entry>();
  private observations = new Map<number, ObservationRun>();
  // One completed payload per tab. It is data, never a live binding; readiness
  // must be independently proved again before this text can be exposed.
  private completed = new Map<number,{documentId:string;videoId:string;partId:string;result:ReadResult}>();
  constructor(private site: SiteAdapter, private changed: () => void = () => {}, private retryDelays:readonly number[]=[300,1200]) {}
  async observe(tabId: number): Promise<VideoView & { source: VideoKey | null; localSource: VideoKey | null }> {
    const active=this.observations.get(tabId);
    if(active){
      // A later notification cannot extend an existing caller's wait. Register
      // the next run separately so load()/retry() can finish during playback.
      active.followup??=active.current.catch(()=>undefined).then(()=>{
        if(this.observations.get(tabId)===active)this.observations.delete(tabId);
        return this.observe(tabId);
      });
      return active.followup;
    }
    const run={} as ObservationRun;run.current=this.observeNow(tabId);
    this.observations.set(tabId,run);
    void run.current.finally(()=>{if(this.observations.get(tabId)===run&&!run.followup)this.observations.delete(tabId);}).catch(()=>{});
    return run.current;
  }
  private async observeNow(tabId: number): Promise<VideoView & { source: VideoKey | null; localSource: VideoKey | null }> {
    const revision=this.revisions.get(tabId)??0;
    const observation = await this.site.observe(tabId);
    if(revision!==(this.revisions.get(tabId)??0)) return {binding:null,status:'loading',cues:[],language:null,source:null,localSource:this.entries.get(tabId)?.localSource??null};
    const signature = JSON.stringify([observation.documentId, observation.marker, observation.source?.videoId, observation.source?.partId, observation.status]);
    const saved=this.completed.get(tabId);
    if(saved&&(observation.status==='unsupported'||observation.status==='permission-denied'||(observation.documentId&&observation.documentId!==saved.documentId)||(observation.source&&(observation.source.videoId!==saved.videoId||observation.source.partId!==saved.partId))))this.completed.delete(tabId);
    let entry = this.entries.get(tabId);
    if (!entry || entry.signature !== signature) {
      entry?.controller?.abort();
      if(entry?.retryTimer)clearTimeout(entry.retryTimer);
      const epoch = entry ? entry.epoch + 1 : Date.now();
      const binding: SourceBinding | null = observation.source ? { platform: 'bilibili', videoId: observation.source.videoId, partId: observation.source.partId, tabId, documentId: observation.documentId, epoch } : null;
      // Last confirmed local media is an access target, never a substitute live binding.
      const localSource = observation.source ?? entry?.localSource ?? null;
      const cached=this.completed.get(tabId);
      const restored=binding&&cached?.documentId===binding.documentId&&cached.videoId===binding.videoId&&cached.partId===binding.partId?cached.result:undefined;
      entry = { signature, epoch, source: observation.source, localSource, view: restored?{binding,...restored}:{ binding, status: binding ? 'loading' : observation.status ?? 'unsupported', cues: [], language: null }, readRevision: 0 };
      this.entries.set(tabId, entry);
      if (binding&&!restored) void this.load(entry);
      this.changed();
    }
    entry.source = observation.source;
    if (observation.source) entry.localSource = observation.source;
    return { ...entry.view, playback: observation.playback, source: entry.source, localSource: entry.localSource };
  }
  private async load(entry: Entry, retry=0) {
    const binding = entry.view.binding!;
    entry.controller?.abort();
    if(entry.retryTimer)clearTimeout(entry.retryTimer);entry.retryTimer=undefined;
    const controller = new AbortController();
    entry.controller = controller;
    const revision = ++entry.readRevision;
    entry.view = { binding, status: 'loading', cues: [], language: null };
    this.changed();
    let result: Pick<VideoView, 'status' | 'cues' | 'language' | 'tracks'>;
    try { result = await this.site.read(binding, controller.signal); }
    catch { result = { status: 'read-failed', cues: [], language: null }; }
    if (controller.signal.aborted) return;
    const current = await this.observe(binding.tabId);
    if (!sameBinding(current.binding, binding) || entry.readRevision !== revision || this.entries.get(binding.tabId) !== entry) return;
    entry.view = { binding, ...result };
    if(result.status==='ready'||result.status==='no-subtitles')this.completed.set(binding.tabId,{documentId:binding.documentId,videoId:binding.videoId,partId:binding.partId,result});
    this.changed();
    if(result.status==='read-failed'&&retry<this.retryDelays.length){
      entry.retryTimer=setTimeout(()=>{entry.retryTimer=undefined;if(this.entries.get(binding.tabId)===entry&&sameBinding(entry.view.binding,binding))void this.load(entry,retry+1);},this.retryDelays[retry]);
    }
  }
  async retry(binding: SourceBinding) {
    const current = await this.observe(binding.tabId);
    if (!sameBinding(current.binding, binding)) throw new ApplicationError('stale-binding');
    this.completed.delete(binding.tabId);
    await this.load(this.entries.get(binding.tabId)!);
  }
  async seek(binding: SourceBinding, time: number, policy: 'preserve' | 'pause') {
    if (!Number.isFinite(time) || time < 0 || !['preserve', 'pause'].includes(policy)) throw new ApplicationError('invalid-message');
    const current = await this.observe(binding.tabId);
    if (!sameBinding(current.binding, binding)) throw new ApplicationError('stale-binding');
    if(current.playback?.duration==null||time>current.playback.duration)throw new ApplicationError('invalid-message');
    return this.site.seek(binding, time, policy);
  }
  isCurrent(binding: SourceBinding) {
    return sameBinding(this.entries.get(binding.tabId)?.view.binding ?? null, binding);
  }
  async playback(binding: SourceBinding) {
    const current = await this.observe(binding.tabId);
    if (!sameBinding(current.binding, binding)) throw new ApplicationError('stale-binding');
    if (!current.playback) throw new ApplicationError('read-failed');
    return current.playback;
  }
  invalidate(tabId: number, discardPending = false) {
    this.revisions.set(tabId,(this.revisions.get(tabId)??0)+1);
    // Permission changes must not wait for a page script that lost access.
    // The revision fence still rejects that detached run if it returns later.
    if(discardPending)this.observations.delete(tabId);
    this.completed.delete(tabId);
    const entry = this.entries.get(tabId);
    if (!entry) return;
    entry.controller?.abort();
    if(entry.retryTimer)clearTimeout(entry.retryTimer);entry.retryTimer=undefined;
    entry.signature = ''; entry.source=null;
    entry.view = { binding: null, status: 'loading', cues: [], language: null };
    this.changed();
  }
  remove(tabId: number) { this.revisions.set(tabId,(this.revisions.get(tabId)??0)+1);this.completed.delete(tabId); const entry=this.entries.get(tabId);entry?.controller?.abort();if(entry?.retryTimer)clearTimeout(entry.retryTimer);this.entries.delete(tabId); }
}
