import { ApplicationError } from '../contracts/application';
import type { SourceBinding, ChatRequestSnapshot } from '../contracts/generation';
import { attachmentSchema, type Attachment, type CapturedFrame } from '../contracts/attachment';
import { databaseTransaction } from './database';
import type { StoredWorkspace } from './indexed-store';
import { imageBudget, validateImage } from './image-validation';

type Target={workspaceId:string;chatId:string};
export function ownedImages(all:Attachment[],ids:readonly string[],target:Target){
  if(new Set(ids).size!==ids.length)throw new ApplicationError('invalid-message');
  return ids.map(id=>{const image=all.find(a=>a.id===id);if(!image||image.workspaceId!==target.workspaceId||image.chatId!==target.chatId)throw new ApplicationError('forbidden');return attachmentSchema.parse(image);});
}
export class IndexedAttachmentStore {
  constructor(private name='vcamp'){}
  async add(target:Target,binding:SourceBinding,revision:number,frame:CapturedFrame){
    return this.write(target,binding,revision,frame);
  }
  async upload(target:Target,binding:SourceBinding,revision:number,name:string,frame:CapturedFrame){
    return this.write(target,binding,revision,frame,name.trim().slice(0,500));
  }
  private async write(target:Target,binding:SourceBinding,revision:number,frame:CapturedFrame,uploadName?:string){
    const integrity=await validateImage(frame);
    const image:Attachment={...frame,...integrity,id:crypto.randomUUID(),workspaceId:target.workspaceId,chatId:target.chatId,mimeType:'image/png',createdAt:Date.now(),...(uploadName?{uploadName}:{}),source:{platform:binding.platform,videoId:binding.videoId,partId:binding.partId}};
    return databaseTransaction<Attachment>(this.name,['workspaces','attachments'],'readwrite',(tx,done,fail)=>{
      const spaces=tx.objectStore('workspaces'),rows=tx.objectStore('attachments'),ws=spaces.get(target.workspaceId),all=rows.getAll();
      all.onsuccess=()=>{try{
        const record:StoredWorkspace|undefined=ws.result,chat=record?.chats.find(c=>c.id===target.chatId&&!c.deleted);
        if(!record||record.deleted||!chat)throw new ApplicationError('not-found');
        if(record.source.videoId!==binding.videoId||record.source.partId!==binding.partId)throw new ApplicationError('stale-binding');
        if(chat.draft.revision!==revision)throw new ApplicationError('revision-conflict');
        imageBudget([...ownedImages(all.result,chat.draft.attachmentIds,target),image]);
        chat.draft={...chat.draft,revision:revision+1,attachmentIds:[...chat.draft.attachmentIds,image.id],attachments:[...(chat.draft.attachments??[]),{attachmentId:image.id,workspaceId:target.workspaceId,chatId:target.chatId,name:uploadName??'视频截图',mimeType:image.mimeType,...(uploadName?{}:{time:image.time})}]};
        rows.add(image);spaces.put(record);done(image);
      }catch(e){fail(e instanceof ApplicationError?e:new ApplicationError('invalid-message'));}};
    });
  }
  remove(target:Target,revision:number,attachmentId:string):Promise<void>{
    return databaseTransaction<void>(this.name,['workspaces','attachments'],'readwrite',(tx,done,fail)=>{
      const spaces=tx.objectStore('workspaces'),rows=tx.objectStore('attachments'),ws=spaces.get(target.workspaceId),item=rows.get(attachmentId);
      item.onsuccess=()=>{try{
        const record:StoredWorkspace|undefined=ws.result,chat=record?.chats.find(c=>c.id===target.chatId&&!c.deleted),image:Attachment|undefined=item.result;
        if(!record||record.deleted||!chat)throw new ApplicationError('not-found');
        if(chat.draft.revision!==revision)throw new ApplicationError('revision-conflict');
        if(!image||image.workspaceId!==target.workspaceId||image.chatId!==target.chatId||!chat.draft.attachmentIds.includes(attachmentId))throw new ApplicationError('forbidden');
        chat.draft={...chat.draft,revision:revision+1,attachmentIds:chat.draft.attachmentIds.filter(id=>id!==attachmentId),attachments:chat.draft.attachments?.filter(attachment=>attachment.attachmentId!==attachmentId)};
        const retained=record.chats.some(candidate=>(candidate.messages??[]).some(message=>message.attachmentIds.includes(attachmentId)));
        if(!retained)rows.delete(attachmentId);
        spaces.put(record);done();
      }catch(e){fail(e instanceof ApplicationError?e:new ApplicationError('invalid-message'));}};
    });
  }
  read(target:Target,ids:readonly string[],historyOnly=false):Promise<Attachment[]>{
    return databaseTransaction(this.name,['workspaces','attachments'],'readonly',(tx,done,fail)=>{
      const ws=tx.objectStore('workspaces').get(target.workspaceId),all=tx.objectStore('attachments').getAll();
      all.onsuccess=()=>{try{
        const record:StoredWorkspace|undefined=ws.result,chat=record?.chats.find(c=>c.id===target.chatId&&!c.deleted);
        if(!record||record.deleted||!chat)throw new ApplicationError('not-found');
        const allowed=new Set([...(historyOnly?[]:chat.draft.attachmentIds),...(chat.messages??[]).flatMap(m=>[...m.attachmentIds])]);
        if(ids.some(id=>!allowed.has(id)))throw new ApplicationError('forbidden');
        const images=ownedImages(all.result,ids,target);imageBudget(images);done(images);
      }catch(e){fail(e instanceof ApplicationError?e:new ApplicationError('invalid-message'));}};
    });
  }
  async forSnapshot(snapshot:ChatRequestSnapshot){
    const ids=[...snapshot.attachmentIds,...snapshot.historyProjection.flatMap(h=>[...h.attachmentIds])];
    const unique=[...new Set(ids)],images=await this.read(snapshot.target,unique,true);
    imageBudget(ids.map(id=>images.find(image=>image.id===id)!));
    for(const image of images){const value=await validateImage(image);if(value.sha256!==image.sha256||value.bytes!==image.bytes)throw new ApplicationError('invalid-message');}
    return images;
  }
}

