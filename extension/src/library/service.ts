import {IndexedDocumentStore,type NativeExport} from '../data/document-store';
import { IndexedManagementStore } from '../data/management-store';
import { IndexedCacheStore } from '../data/cache-store';
import { IndexedBackupStore } from '../data/backup-store';
import type { GenerationJob } from '../contracts/generation';
import { ApplicationError, type VideoKey } from '../contracts/application';
import type { LibraryPort } from '../contracts/library';
import { IndexedLibraryStore } from '../data/library-store';
import {isNativeTrackId,nativeTrackId,nativeTrackLabel,nativeTracks} from '../video/native-tracks';

export function createLibraryService(store: IndexedLibraryStore, openReader: (url: string) => Promise<unknown>, openVideo: (source: VideoKey, time: number) => Promise<unknown>, management = new IndexedManagementStore(), releaseDeleted: (jobs: GenerationJob[]) => Promise<void> = async () => {}, cache = new IndexedCacheStore(), backup = new IndexedBackupStore(), locate?: (source:VideoKey,time:number,windowId?:number)=>Promise<unknown>,documents=new IndexedDocumentStore(),native?:(windowId?:number)=>Promise<NativeExport|undefined>): LibraryPort {
  return { async command(op,windowId,context) {
    if(op.type==='library.export')return {videos:[],entities:[],documents:await documents.export(op.selection,!context?.readonly&&op.selection.some(p=>p.target.entityType==='subtitle'&&isNativeTrackId(p.target.id))?await native?.(windowId):undefined)};
    if (op.type === 'library.backup.export') return { videos: [], entities: [], backup: op.segmented ? { transfer: await backup.beginExport() } : { file: await backup.export() } };
    if (op.type === 'library.backup.part') return { videos: [], entities: [], backup: { transfer: backup.exportPart(op.transferId, op.index) } };
    if (op.type === 'library.backup.import.begin') return { videos: [], entities: [], backup: { transfer: await backup.beginImport(op.manifest) } };
    if (op.type === 'library.backup.import.append') return { videos: [], entities: [], backup: { transfer: await backup.appendImport(op.transferId, op.index, op.data) } };
    if (op.type === 'library.backup.import.preview') return { videos: [], entities: [], backup: { plan: await backup.finishImport(op.transferId) } };
    if (op.type === 'library.backup.release') { backup.releaseTransfer(op.transferId); return { videos: [], entities: [], backup: {} }; }
    if (op.type === 'library.backup.preview') return { videos: [], entities: [], backup: { plan: await backup.preview(op.file) } };
    if (op.type === 'library.backup.execute') return { videos: [], entities: [], backup: { result: await backup.execute(op.planId, op.checksum) } };
    if (op.type === 'library.storage.query') return { videos: [], entities: [], storage: { inventory: await cache.inventory() } };
    if (op.type === 'library.storage.preview') return { videos: [], entities: [], storage: { plan: await cache.preview(op.selection), inventory: await cache.inventory() } };
    if (op.type === 'library.storage.execute') return { videos: [], entities: [], storage: { result: await cache.execute(op.planId), inventory: await cache.inventory() } };
    if (op.type === 'library.trash.query') return { videos: [], entities: [], trash: await management.trash() };
    if (op.type === 'library.trash.preview') return { videos: [], entities: [], deletePreview: await management.preview(op.target) };
    if (op.type === 'library.trash.move') { const jobs = await management.move(op.target, op.expectedRevision); await releaseDeleted(jobs); return store.query(); }
    if (op.type === 'library.trash.restore') { await management.restore(op.target, op.expectedRevision); return { videos: [], entities: [], trash: await management.trash() }; }
    if (op.type === 'library.query') return store.query(op.search, op.folderId);
    if (op.type === 'library.read') {
      const detail=await store.detail(op.workspaceId,op.scope),current=context?.readonly?undefined:await native?.(windowId);
      if(current&&(current.workspaceId===op.workspaceId||detail.entities.some(e=>e.entityType==='workspace'&&e.workspaceId===current.workspaceId)))for(const track of nativeTracks({...current,status:'ready'}).filter(t=>t.status==='ready'&&t.cues.length))detail.entities.push({workspaceId:current.workspaceId,entityType:'subtitle',id:nativeTrackId(track.language),title:nativeTrackLabel(track),language:track.language,cueCount:track.cues.length,sourceType:'native',rawAvailable:!!track.rawJson,provenance:`站点原生（${current.category==='ai'?'站点 AI':current.category==='human'?'站点人工':'AI/人工属性未知'}） · 当前完整读取`});
      return detail;
    }
    if (op.type === 'library.folder.create') { await store.createFolder(op.name,op.color); return store.query(); }
    if (op.type === 'library.folder.rename') { await store.renameFolder(op.folderId, op.expectedRevision, op.name); return store.query(); }
    if (op.type === 'library.folder.delete') { await store.deleteFolder(op.folderId, op.expectedRevision); return store.query(); }
    if (op.type === 'library.favorite.add') { await store.addFavorite(op.folderId, op.target); return store.query(); }
    if (op.type === 'library.favorite.remove') { await store.removeFavorite(op.folderId, op.target); return store.query(); }
    const resolved = await store.resolve(op.target);
    if(op.type==='library.locate'){if(locate)await locate(resolved.source,op.time,windowId);else await openVideo(resolved.source,op.time);return store.query();}
    if (op.action === 'reader') {
      if (op.time !== undefined) throw new ApplicationError('invalid-message');
      const params = new URLSearchParams({ library: '1', workspaceId: op.target.workspaceId });
      const parameter = { workspace: '', chat: 'chatId', markdown: 'artifactId', html: 'knowledgeId', scribble: 'scribbleId', subtitle: 'subtitleVersionId' }[op.target.entityType];
      if (parameter) params.set(parameter, op.target.id);
      await openReader(`reader.html?${params}`);
    } else await openVideo(resolved.source, op.time ?? resolved.position);
    return store.query();
  } };
}
