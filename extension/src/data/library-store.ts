import {mediaDisplay} from '../shared/media-labels';
import { ApplicationError, type VideoKey } from '../contracts/application';
import { DEFAULT_LIBRARY_FOLDER_ID, folderSchema, libraryTargetSchema, type LibraryEntity, type LibraryTarget, type LibraryView, type LibraryFolder, type LibraryFavorite } from '../contracts/library';
import { subtitleVersionSchema } from '../contracts/subtitles';
import type { StoredWorkspace } from './indexed-store';
import { backupLabel } from './backup-label';
import { databaseTransaction } from './database';

// Old sources used a decorated title. New observations carry separate metadata.
export const mediaLabels=mediaDisplay;

type Rows = Record<string, any[]>;
const stores = ['workspaces', 'artifacts', 'scribbles', 'subtitleVersions', 'folders', 'favorites'];
const favoriteIdentity = (folderId: string, target: LibraryTarget) => JSON.stringify([folderId, target.workspaceId, target.entityType, target.id]);
const defaultFolder:LibraryFolder={id:DEFAULT_LIBRARY_FOLDER_ID,name:'默认文件夹',revision:1};

// A workspace also holds unsent drafts and native-subtitle selection. Its
// existence is not a history entry: derive membership from saved content so
// old browsing-only rows, deletion/restoration and imported data obey one rule.
function recentWorkspaceIds(rows: Rows): Set<string> {
  const ids = new Set<string>();
  for (const space of rows.workspaces as StoredWorkspace[]) {
    if (space.chats.some(chat => !chat.deleted && chat.messages?.some(message =>
      message.role === 'assistant' && message.kind !== 'scribble-operation' &&
      (!message.outputType || message.outputType === 'chat') && message.text.trim()))) ids.add(space.id);
  }
  for (const row of rows.artifacts) {
    if (!row.deleted && ['markdown', 'html', 'html-page'].includes(row.type)) ids.add(row.workspaceId);
  }
  for (const row of rows.scribbles) {
    if (!row.deleted && row.text.trim()) ids.add(row.workspaceId);
  }
  for (const row of rows.subtitleVersions) {
    if (!row.deleted && subtitleVersionSchema.safeParse(row).success) ids.add(row.workspaceId);
  }
  return ids;
}

export class IndexedLibraryStore {
  private propagatedCovers = new Map<string,string>();
  constructor(private name = 'vcamp') {}
  private read<T>(project: (rows: Rows) => T): Promise<T> {
    return databaseTransaction(this.name, stores, 'readonly', (tx, done, fail) => {
      const rows: Rows = {}; let remaining = stores.length;
      for (const key of stores) { const request = tx.objectStore(key).getAll(); request.onsuccess = () => {
        rows[key] = request.result;
        if (!--remaining) { try { done(project(rows)); } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); } }
      }; }
    });
  }
  private entities(rows: Rows, workspaceId: string): LibraryEntity[] {
    const space = rows.workspaces.find(row => row.id === workspaceId) as StoredWorkspace | undefined;
    if (!space || space.deleted) throw new ApplicationError('not-found');
    return [
      { workspaceId, entityType: 'workspace', id: workspaceId, title: mediaLabels(space.source).partTitle },
      ...space.chats.filter(chat => !chat.deleted).map(chat => ({ workspaceId, entityType: 'chat' as const, id: chat.id, title: backupLabel(space, chat.id, chat.title) })),
      ...rows.artifacts.filter(row => row.workspaceId === workspaceId && !row.deleted && (row.type === 'markdown' || row.type === 'html' || row.type === 'html-page')).map(row => ({ workspaceId, entityType: (row.type==='html-page'?'html':row.type) as 'markdown' | 'html', id: row.id, title: backupLabel(space, row.id, row.title), sourceChatId: row.sourceChatId, ...(row.type==='html'?{exportUnavailable:'旧结构化知识没有 HTML 页面源码'}:{}) })),
      ...rows.scribbles.filter(row => row.workspaceId === workspaceId && !row.deleted).map(row => ({ workspaceId, entityType: 'scribble' as const, id: row.id, title: backupLabel(space, row.id, row.text.slice(0, 60)), ...(row.time === null ? {} : { time: row.time }) })),
      ...rows.subtitleVersions.filter(row => row.workspaceId === workspaceId && !row.deleted && subtitleVersionSchema.safeParse(row).success).map(row => ({ workspaceId, entityType: 'subtitle' as const, id: row.id, title: backupLabel(space, row.id, `${row.type === 'translate' ? 'AI 翻译' : 'AI 字幕修正'} · ${row.language} · ${new Date(row.createdAt).toLocaleString()}`) }))
    ];
  }
  private ensureDefaultFolder():Promise<void>{
    return databaseTransaction(this.name,['folders'],'readwrite',(tx,done)=>{const store=tx.objectStore('folders'),request=store.get(DEFAULT_LIBRARY_FOLDER_ID);request.onsuccess=()=>{if(!request.result)store.add(defaultFolder);done();};});
  }
  async query(search = '', folderId?: string): Promise<LibraryView> {
    await this.ensureDefaultFolder();
    return this.read(rows => {
      if (folderId && folderId !== 'all' && !rows.folders.some(row => row.id === folderId)) throw new ApplicationError('not-found');
      const favorites: LibraryFavorite[] = rows.favorites.filter(row => !folderId || folderId === 'all' || row.folderId === folderId).map(row => {
        let entity: LibraryEntity | undefined;
        try { entity = this.entities(rows, row.target.workspaceId).find(entity => entity.entityType === row.target.entityType && entity.id === row.target.id); } catch { /* keep unavailable relation visible */ }
        const space = rows.workspaces.find(space => space.id === row.target.workspaceId);
        return { ...row, title: entity?.title ?? row.title, ...(space?.source.coverUrl?{coverUrl:space.source.coverUrl}:{}), videoTitle: space ? mediaLabels(space.source).title : row.videoTitle, available: !!entity };
      }).filter(row => row.videoTitle.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
      const videos = new Map<string, LibraryView['videos'][number]>();
      const recent = folderId ? undefined : recentWorkspaceIds(rows);
      const spaces = (rows.workspaces as StoredWorkspace[]).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
      for (const space of spaces) {
        if (space.deleted) continue;
        if (recent && !recent.has(space.id)) continue;
        if (folderId && !favorites.some(row => row.target.workspaceId === space.id)) continue;
        const labels = mediaLabels(space.source), key = JSON.stringify([space.source.platform, space.source.videoId]);
        let video = videos.get(key);
        if (!video) { video = { platform: 'bilibili', videoId: space.source.videoId, title: labels.title, ...(space.source.coverUrl?{coverUrl:space.source.coverUrl}:{}), parts: [] }; videos.set(key, video); }
        if(!video.coverUrl&&space.source.coverUrl)video.coverUrl=space.source.coverUrl;
        video.parts.push({ workspaceId: space.id, partId: space.source.partId, title: labels.partTitle, pageNumber: labels.pageNumber, partCount: labels.partCount, position: space.watchPosition?.time, recentAt: space.lastOpenedAt ?? 0 });
      }
      return { videos: [...videos.values()].filter(video => video.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), entities: [], folders: rows.folders, favorites };
    });
  }
  detail(workspaceId: string, scope?:'video'): Promise<LibraryView> {
    return this.read(rows => {
      const initial=rows.workspaces.find(row=>row.id===workspaceId&&!row.deleted) as StoredWorkspace|undefined;
      if(!initial)throw new ApplicationError('not-found');
      const spaces=(rows.workspaces as StoredWorkspace[]).filter(row=>!row.deleted&&(scope==='video'?row.source.platform===initial.source.platform&&row.source.videoId===initial.source.videoId:row.id===workspaceId));
      const entities=spaces.flatMap(space=>this.entities(rows,space.id).map(entity=>{
        const artifact=rows.artifacts.find(row=>row.id===entity.id&&row.workspaceId===space.id);
        const messages=space.chats.find(c=>c.id===(entity.entityType==='chat'?entity.id:entity.sourceChatId))?.messages??[];
        const attachmentCount=new Set(messages.filter(m=>entity.entityType==='chat'||artifact&&m.jobId===artifact.jobId).flatMap(m=>m.attachmentIds)).size;
        const version=rows.subtitleVersions.find(row=>row.workspaceId===space.id&&row.id===entity.id);
        const summary=entity.entityType==='chat'?messages.find(m=>m.role==='user')?.text.slice(0,120):entity.entityType==='scribble'?rows.scribbles.find(row=>row.id===entity.id)?.text.slice(0,160):undefined;
        return {...entity,...(summary?{summary}:{}),...(attachmentCount?{attachmentCount}:{}),...(version?{language:version.language,cueCount:version.cues.length,sourceType:version.type,rawAvailable:false,provenance:this.subtitleProvenance(rows,space.id,version)}:{})};
      }));
      const labels=mediaLabels(initial.source);
      return { videos:scope==='video'?[{platform:'bilibili',videoId:initial.source.videoId,title:labels.title,parts:spaces.map(space=>({workspaceId:space.id,partId:space.source.partId,title:mediaLabels(space.source).partTitle,pageNumber:mediaLabels(space.source).pageNumber,partCount:space.source.partCount,recentAt:space.lastOpenedAt??0}))}]:[], entities,recentChatId:initial.recentChatId };
    });
  }
  private subtitleProvenance(rows:Rows,workspaceId:string,version:any):string {
    const chain:string[]=[],seen=new Set<string>();let current=version;
    while(current&&seen.size<100&&!seen.has(current.id)){
      seen.add(current.id);chain.push(`插件 AI ${current.type==='translate'?'翻译':'字幕修正'}（${current.sourceLanguage??'未知'} → ${current.language}）`);
      const upstream='subtitleVersionId' in current.source?current.source.subtitleVersionId:null;
      if(!upstream){chain.push('站点原生（AI/人工属性未知）');break;}
      current=rows.subtitleVersions.find(row=>row.workspaceId===workspaceId&&row.id===upstream);
      if(!current)chain.push('上游资料未知');
    }
    return chain.join(' ← ');
  }
  resolve(target: LibraryTarget): Promise<{ source: VideoKey; position: number; entity: LibraryEntity }> {
    return this.read(rows => {
      const entity = this.entities(rows, target.workspaceId).find(row => row.entityType === target.entityType && row.id === target.id);
      if (!entity) throw new ApplicationError('not-found');
      const space = rows.workspaces.find(row => row.id === target.workspaceId) as StoredWorkspace;
      return { source: space.source, position: space.watchPosition?.time ?? 0, entity };
    });
  }
  // Call only after VideoPort validates the original binding. Never redirect to
  // an active workspace; timestamp ordering protects concurrent late writes.
  async recordObservation(source: VideoKey, time: number, observedAt: number): Promise<void> {
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(observedAt)) return Promise.reject(new ApplicationError('invalid-message'));
    const id = JSON.stringify([source.platform, source.videoId, source.partId]);
    const coverKey=JSON.stringify([source.platform,source.videoId]);
    const propagated=await databaseTransaction<string|undefined>(this.name, ['workspaces'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('workspaces'), request = store.get(id);
      request.onsuccess = () => {
        const row: StoredWorkspace | undefined = request.result;
        let cover:string|undefined;
        if (row && !row.deleted && observedAt > (row.deletedAt ?? 0) && (!row.watchPosition || row.watchPosition.observedAt <= observedAt)) {
          // Repair old sibling parts once per observed cover, not on every
          // playback event. A new part missing its cover still triggers repair.
          if(source.coverUrl&&(this.propagatedCovers.get(coverKey)!==source.coverUrl||row.source.coverUrl!==source.coverUrl))cover=source.coverUrl;
          row.source = {...source,...(source.coverUrl??row.source.coverUrl?{coverUrl:source.coverUrl??row.source.coverUrl}:{})};
          if(cover){const all=store.getAll();all.onsuccess=()=>{for(const other of all.result as StoredWorkspace[])if(other.id!==id&&!other.deleted&&other.source.platform===source.platform&&other.source.videoId===source.videoId&&other.source.coverUrl!==cover)store.put({...other,source:{...other.source,coverUrl:cover}});};}
          row.watchPosition = { time, observedAt }; store.put(row);
        }
        done(cover);
      };
    });
    // Cache only after the repair transaction commits, so a failed write can retry.
    if(propagated)this.propagatedCovers.set(coverKey,propagated);
  }
  createFolder(name: string,color?:string): Promise<LibraryFolder> {
    const folder = folderSchema.parse({ id: crypto.randomUUID(), name, revision: 1,...(color?{color}:{}) });
    return databaseTransaction(this.name, ['folders'], 'readwrite', (tx, done) => { tx.objectStore('folders').add(folder); done(folder); });
  }
  renameFolder(folderId: string, expectedRevision: number, name: string): Promise<void> {
    if(folderId===DEFAULT_LIBRARY_FOLDER_ID)return Promise.reject(new ApplicationError('forbidden'));
    const parsed = folderSchema.shape.name.safeParse(name);
    if (!parsed.success) return Promise.reject(new ApplicationError('invalid-message'));
    return databaseTransaction(this.name, ['folders'], 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore('folders'), request = store.get(folderId);
      request.onsuccess = () => {
        const folder: LibraryFolder | undefined = request.result;
        if (!folder) return fail(new ApplicationError('not-found'));
        if (folder.revision !== expectedRevision) return fail(new ApplicationError('revision-conflict'));
        store.put({ ...folder, name: parsed.data, revision: folder.revision + 1 }); done();
      };
    });
  }
  deleteFolder(folderId: string, expectedRevision: number): Promise<void> {
    if(folderId===DEFAULT_LIBRARY_FOLDER_ID)return Promise.reject(new ApplicationError('forbidden'));
    return databaseTransaction(this.name, ['folders', 'favorites'], 'readwrite', (tx, done, fail) => {
      const folders = tx.objectStore('folders'), request = folders.get(folderId);
      request.onsuccess = () => {
        const folder: LibraryFolder | undefined = request.result;
        if (!folder) return fail(new ApplicationError('not-found'));
        if (folder.revision !== expectedRevision) return fail(new ApplicationError('revision-conflict'));
        folders.delete(folderId);
        const favorites = tx.objectStore('favorites'), relations = favorites.index('folderId').getAllKeys(folderId);
        relations.onsuccess = () => { for (const key of relations.result) favorites.delete(key); done(); };
      };
    });
  }
  addFavorite(folderId: string, target: LibraryTarget): Promise<void> {
    if (!libraryTargetSchema.safeParse(target).success) return Promise.reject(new ApplicationError('invalid-message'));
    return databaseTransaction(this.name, stores, 'readwrite', (tx, done, fail) => {
      const rows: Rows = {}; let remaining = stores.length;
      for (const key of stores) { const request = tx.objectStore(key).getAll(); request.onsuccess = () => {
        rows[key] = request.result;
        if (--remaining) return;
        try {
          if(folderId===DEFAULT_LIBRARY_FOLDER_ID&&!rows.folders.some(row=>row.id===folderId)){rows.folders.push(defaultFolder);tx.objectStore('folders').add(defaultFolder);}
          if (!rows.folders.some(row => row.id === folderId)) throw new ApplicationError('not-found');
          const entity = this.entities(rows, target.workspaceId).find(row => row.entityType === target.entityType && row.id === target.id);
          if (!entity) throw new ApplicationError('not-found');
          const id = favoriteIdentity(folderId, target);
          if (!rows.favorites.some(row => row.id === id)) {
            const source = rows.workspaces.find(row => row.id === target.workspaceId).source;
            tx.objectStore('favorites').add({ id, folderId, target, title: entity.title, videoTitle: mediaLabels(source).title });
          }
          done();
        } catch (reason) { fail(reason instanceof ApplicationError ? reason : new ApplicationError('storage-failed')); }
      }; }
    });
  }
  removeFavorite(folderId: string, target: LibraryTarget): Promise<void> {
    return databaseTransaction(this.name, ['favorites'], 'readwrite', (tx, done) => { tx.objectStore('favorites').delete(favoriteIdentity(folderId, target)); done(); });
  }
}
