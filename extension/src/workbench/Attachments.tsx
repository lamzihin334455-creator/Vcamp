import { useEffect, useRef, useState } from 'react';
import type { ApplicationClient } from '../contracts/application';
import type { Attachment } from '../contracts/attachment';
import { formatTime } from '../video/SubtitleTimeline';

export function AttachmentImages({client,target,ids,historyOnly=false,remove}:{client:ApplicationClient;target:{workspaceId:string;chatId:string};ids:readonly string[];historyOnly?:boolean;remove?:(id:string)=>void}){
  const [images,setImages]=useState<Attachment[]>([]),[error,setError]=useState(''),[preview,setPreview]=useState<Attachment|null>(null);
  const key=JSON.stringify(ids);
  useEffect(()=>{
    let alive=true;setImages([]);setPreview(null);setError('');
    if(ids.length&&client.attachment)void client.attachment({type:'attachment.read',target,ids:[...ids],historyOnly}).then(result=>{if(alive)setImages(result.images);}).catch(()=>{if(alive)setError('图片读取失败；未移除历史附件。');});
    return()=>{alive=false;};
  },[client,target.workspaceId,target.chatId,key,historyOnly]);
  return <>{!!images.length&&<div className="attachment-images" aria-label={historyOnly?'历史图片':'草稿图片'}>{images.map(image=>{const label=image.uploadName??formatTime(image.time);return <figure key={image.id}><button onClick={()=>setPreview(image)} aria-label={`预览图片 ${label}`}><img src={image.dataUrl} alt={image.uploadName?`用户图片 ${image.uploadName}`:`视频截图 ${label}`}/></button><figcaption title={label}>{label}{remove&&<button onClick={()=>remove(image.id)} aria-label={`移除图片 ${label}`}>移除</button>}</figcaption></figure>;})}</div>}{error&&<p role="alert">{error}</p>}{preview&&<ImagePreview image={preview} close={()=>setPreview(null)}/>}</>;
}
function ImagePreview({image,close}:{image:Attachment;close:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);useEffect(()=>{dialog.current?.showModal();},[]);
  return <dialog className="image-preview" aria-label="图片预览" ref={dialog} onClose={close}>
    <div className="image-preview-stage"><img src={image.dataUrl} alt={image.uploadName?`用户图片 ${image.uploadName}`:`视频截图 ${formatTime(image.time)}`}/></div>
    <div className="image-preview-footer"><p>{image.uploadName??formatTime(image.time)} · {image.width}×{image.height}</p><button onClick={()=>dialog.current?.close()}>关闭预览</button></div>
  </dialog>;
}
