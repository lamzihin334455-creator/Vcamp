import {IndexedStyleStore} from './data/style-store';
import {IndexedDocumentStore} from './data/document-store';
import { IndexedKnowledgeStore } from './data/knowledge-store';
import { IndexedAttachmentStore } from './data/attachment-store';
import { captureCurrent } from './video/capture';
import {IndexedBackupStore} from './data/backup-store';
import {validTime} from './shared/time';
import {IndexedCacheStore} from './data/cache-store';
import { IndexedManagementStore } from './data/management-store';
import { IndexedLibraryStore } from './data/library-store';
import { createLibraryService } from './library/service';
import { ApplicationError } from './contracts/application';
import { IndexedSubtitleStore } from './data/subtitle-store';
import { IndexedScribbleStore } from './data/scribble-store';
import { createInstructionService } from './generation/instruction-service';
import { IndexedRoleStore } from './data/role-store';
import { IndexedTemplateStore } from './data/template-store';
import { createCredentialStore } from './generation/credential-store';
import { createProviderService } from './generation/provider-service';
import { getBinding } from '@binding';
import { createMessageRouter } from './app/message-router';
import { IndexedWorkspaceStore } from './data/indexed-store';
import { createChromeVideo } from './video/chrome-video';
import { IndexedGenerationStore } from './data/generation-store';
import { createTaskService, createChromeTaskHost } from './generation/task-service';
import { getGenerationVideo, testPanelVideo } from '@generation-video';
import { z } from 'zod';
import { IndexedArtifactStore } from './data/artifact-store';
import { createPlaybackChannel } from './video/playback-channel';
import { installMediaHosts } from './video/media-hosts';
import { createEvidencePreparation } from './generation/evidence-preparation';
import { isRetiredGenerationTemplate } from './contracts/template';
import { roleSelectionSchema } from './contracts/role';

const mediaHosts = installMediaHosts(import.meta.env.MODE === 'capture-test');

const subscribers = new Set<chrome.runtime.Port>();
const changed = () => { for (const port of subscribers) { try { port.postMessage({ version: 1, type: 'invalidate' }); } catch { subscribers.delete(port); } } };
const libraryStore = new IndexedLibraryStore();
const productionVideo = import.meta.env.MODE === 'test-extension' ? undefined : createChromeVideo(changed, (source, time, observedAt) => libraryStore.recordObservation(source, time, observedAt));
const video = productionVideo ?? testPanelVideo;
const playback = createPlaybackChannel(async binding => {
  if (!productionVideo) throw new Error('No production playback');
  return productionVideo.playback(binding);
});
const credentials = createCredentialStore(chrome.storage.local);
const provider = createProviderService(credentials, (input, init) => fetch(input, init), changed, baseUrl => chrome.permissions.contains({ origins: [`${new URL(baseUrl).origin}/*`] }));
const subtitles = new IndexedSubtitleStore();
const spaces = new IndexedWorkspaceStore('vcamp',async()=>(await chrome.storage.local.get('vcamp.webDefault'))['vcamp.webDefault']===true,async()=>{const parsed=roleSelectionSchema.safeParse((await chrome.storage.local.get('vcamp.activeRole'))['vcamp.activeRole']);return parsed.success?parsed.data:null;});
const generation = createTaskService(new IndexedGenerationStore(), spaces, provider, windowId => video ? video.current(windowId) : getGenerationVideo(), createChromeTaskHost(), chrome.runtime.id, changed, undefined, undefined, createEvidencePreparation(credentials, (input, init) => fetch(input, init)),async()=>(await chrome.storage.local.get('vcamp.roleAllOutputs'))['vcamp.roleAllOutputs']===true);
const scribbles = new IndexedScribbleStore();
const templates = new IndexedTemplateStore();
const roles = new IndexedRoleStore();
const styles=new IndexedStyleStore();
const notes = new IndexedArtifactStore();
const attachments = new IndexedAttachmentStore();
const library = createLibraryService(libraryStore, url => chrome.tabs.create({ url: chrome.runtime.getURL(url) }), async (source, time) => {
  if (!productionVideo) throw new ApplicationError('unsupported-capability');
  return productionVideo.open(source, time);
}, new IndexedManagementStore(), jobs => generation.releaseDeleted(jobs),new IndexedCacheStore(),new IndexedBackupStore(),async(source,time,windowId)=>{
  const current=await video!.current(windowId);
  if(productionVideo&&current.binding&&current.binding.videoId===source.videoId&&current.binding.partId===source.partId){if(current.playback?.duration==null||!validTime(time,current.playback.duration))throw new ApplicationError('invalid-message');return productionVideo.seek(current.binding,time,'preserve');}
  if(!productionVideo){if(current.binding?.videoId!==source.videoId||current.binding?.partId!==source.partId)throw new ApplicationError('stale-binding');return video!.seek(current.binding,time,'preserve');}
  return productionVideo.open(source,time);
},new IndexedDocumentStore(),async(windowId)=>{
  const current=await video!.current(windowId);
  // An unavailable default track must not hide other fully read languages.
  if(!current.binding||current.status==='loading'||!(current.tracks?.some(t=>t.status==='ready'&&t.cues.length)||current.status==='ready'&&current.cues.length))return;
  return {workspaceId:JSON.stringify([current.binding.platform,current.binding.videoId,current.binding.partId]),language:current.language??'',cues:current.cues,tracks:current.tracks,category:'unknown' as const};
});
const router = createMessageRouter(spaces, chrome.runtime.id, getBinding, video, provider, generation, {
  async command(op) {
    if (op.type === 'artifact.save') return { artifacts: [await notes.save(op.workspaceId, op.artifactId, op.expectedRevision, op.content)] };
    const artifacts = await notes.list(op.workspaceId, op.sourceChatId);
    return { artifacts: op.artifactId ? artifacts.filter(note => note.id === op.artifactId) : artifacts };
  }
}, { async command(op) {
  if ((op.type === 'template.create' || op.type === 'template.save') && isRetiredGenerationTemplate(op.fields)) throw new ApplicationError('unsupported-capability');
  if (op.type === 'template.create') await templates.create(op.fields);
  if (op.type === 'template.delete') await templates.delete(op.templateId, op.expectedRevision);
  if (op.type === 'template.save') await templates.save(op.templateId, op.expectedRevision, op.fields);
  if (op.type === 'template.reorder') await templates.reorder(op.ids);
  return { templates: await templates.list(), ...(op.type === 'template.query' && op.selected ? { revisions: [await templates.revision(op.selected.templateId, op.selected.revisionId)] } : {}) };
} }, { async command(op) {
  if (op.type === 'scribble.create') await scribbles.create(op.workspaceId, op.text, op.time, op.origin);
  if (op.type === 'scribble.save') await scribbles.save(op.workspaceId, op.scribbleId, op.expectedRevision, op.text);
  const rows = await scribbles.list(op.workspaceId);
  return { scribbles: op.type === 'scribble.query' && op.scribbleId ? rows.filter(row => row.id === op.scribbleId) : rows };
} }, { async command(op) {
  if (op.type === 'subtitles.source.select') await subtitles.select(op.workspaceId, op.expectedRevision, op.source);
  return subtitles.query(op.workspaceId, op.type === 'subtitles.query' ? op.versionId : undefined);
} }, library, {async command(op){
  if(op.type==='attachment.read')return {images:await attachments.read(op.target,op.ids,op.historyOnly)};
  if(op.type==='attachment.remove'){await attachments.remove(op.target,op.expectedRevision,op.attachmentId);changed();return {images:[]};}
  if(op.type==='attachment.upload'){const image=await attachments.upload(op.target,op.binding,op.expectedRevision,op.name,op.frame);changed();return {images:[image]};}
  if(!productionVideo)throw new ApplicationError('unsupported-capability');
  const original=await spaces.read(op.target.workspaceId,op.target.chatId);
  if(!original||original.source.videoId!==op.binding.videoId||original.source.partId!==op.binding.partId)throw new ApplicationError('stale-binding');
  const image=await captureCurrent(op.binding,productionVideo.observe);
  await attachments.add(op.target,op.binding,op.expectedRevision,image);changed();return {images:[]};
} }, {async command(op) {return {artifacts:await new IndexedKnowledgeStore().list(op.workspaceId,op.artifactId,true)};}}, { async command(op) {
  if (op.type === 'role.create') await roles.create(op.fields);
  if (op.type === 'role.save') await roles.save(op.roleId, op.expectedRevision, op.fields);
  if (op.type === 'role.delete') await roles.delete(op.roleId, op.expectedRevision);
  return { roles: await roles.list(), ...(op.type === 'role.query' && op.selected ? { revisions: [await roles.revision(op.selected.roleId, op.selected.revisionId)] } : {}) };
} }, createInstructionService(),{async command(op){
 if(op.type==='style.create')await styles.create(op.fields);
 if(op.type==='style.save')await styles.save(op.styleId,op.expectedRevision,op.fields);
 if(op.type==='style.delete')await styles.delete(op.styleId,op.expectedRevision);
 if(op.type==='style.reorder')await styles.reorder(op.ids);
 return {styles:await styles.list(),...(op.type==='style.query'&&op.selected?{revisions:[await styles.revision(op.selected.styleId,op.selected.revisionId)]}:{})};
}});

chrome.tabs.onRemoved.addListener(tabId => { void generation.removed(tabId).catch(() => {}); });
chrome.runtime.onConnect.addListener(port => {
  try {
    const senderUrl = router.authorize(port.sender ?? {});
    if (port.name === 'vcamp-playback-v1') {
      if (senderUrl.pathname !== '/sidepanel.html') return port.disconnect();
      playback.connect(port); return;
    }
    if (port.name !== 'vcamp-v1') return port.disconnect();
    // Registration BEFORE ack. Clients query a fresh snapshot after every ack.
    subscribers.add(port);
    port.onDisconnect.addListener(() => subscribers.delete(port));
    port.postMessage({ version: 1, type: 'ready' });
  } catch { port.disconnect(); }
});
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (mediaHosts(message, sender, respond)) return true;
  const executorMessage = z.object({ type: z.enum(['executor.boot', 'executor.changed']), jobId: z.string().uuid(), attemptId: z.string().uuid() }).strict().safeParse(message);
  if (executorMessage.success) {
    const op = executorMessage.data;
    void (op.type === 'executor.boot' ? generation.boot(op.jobId, op.attemptId, sender) : generation.notification(op.jobId, op.attemptId, sender)).then(value => respond(value ?? null), () => respond(null));
    return true;
  }
  if (['video.observe', 'video.playback'].includes((message as { type?: string })?.type ?? '')) {
    if (productionVideo && sender.id === chrome.runtime.id && sender.frameId === 0 && sender.tab?.id !== undefined && sender.documentId && sender.url?.startsWith('https://www.bilibili.com/video/')) {
      if ((message as { type: string }).type === 'video.playback') { playback.notify(sender.tab.id, sender.documentId); void productionVideo.observe(sender.tab.id).then(() => respond({ ok: true })); }
      else void productionVideo.observe(sender.tab.id).then(() => respond({ ok: true }));
      return true;
    }
    respond({ ok: false }); return false;
  }
  void router.handle(message, sender).then(result => {
    respond(result);
    if (result.ok && typeof message === 'object' && message !== null && 'operation' in message && ['draft.save', 'chat.create', 'chat.select', 'artifact.save', 'template.create', 'template.save', 'template.delete', 'template.reorder', 'role.create', 'role.save', 'role.delete', 'style.create', 'style.save', 'style.delete', 'style.reorder', 'scribble.create', 'scribble.save', 'subtitles.source.select', 'library.trash.move', 'library.trash.restore', 'library.backup.execute'].includes((message.operation as { type?: string })?.type ?? '')) {
      for (const port of subscribers) {
        try { port.postMessage({ version: 1, type: 'invalidate' }); } catch { subscribers.delete(port); }
      }
    }
  });
  return true;
});
chrome.runtime.onInstalled.addListener(() => { void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); });
