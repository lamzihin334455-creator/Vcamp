import {mediaDisplay} from '../shared/media-labels';
import {databaseTransaction} from './database';
import {ApplicationError,type VideoKey} from '../contracts/application';
import {documentLimits,documentSelectionSchema,formatsFor,type DocumentExport,type DocumentSelection} from '../contracts/documents';
import type {StoredWorkspace} from './indexed-store';
import type {SubtitleVersion} from '../contracts/subtitles';
import type {Cue,NativeTrack} from '../contracts/video';
import {isNativeTrackId,nativeTrackId,nativeTracks} from '../video/native-tracks';
import {formatTime,subtitleTime} from '../shared/time';

export const safeFilename=(value:string)=>{
  let name=value.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.\./g,'_').replace(/[. ]+$/,'')||'Vcamp';
  if(name.length>180){const suffix=/\.source\.txt$/i.test(name)?'.source.txt':name.slice(name.lastIndexOf('.'));name=suffix.length<12&&suffix.startsWith('.')?name.slice(0,160)+suffix:name.slice(0,180);}
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)?'_'+name:name;
};
const sourceUrl=(s:VideoKey)=>`https://www.bilibili.com/video/${encodeURIComponent(s.videoId)}/${s.pageNumber?`?p=${s.pageNumber}`:''}`;
export type NativeExport={workspaceId:string;language:string;cues:Cue[];category?:'ai'|'human'|'unknown';tracks?:NativeTrack[]};
const tables=['workspaces','artifacts','noteRevisions','scribbles','subtitleVersions','attachments'];
export class IndexedDocumentStore {
  constructor(private name='vcamp'){}
  // All selected saved revisions are fixed by one readonly transaction. Native
  // cues, if supplied, must already have a source binding validated by the host.
  async export(selection:DocumentSelection[],native?:NativeExport):Promise<DocumentExport>{
    if(!selection.length||selection.length>100)throw new ApplicationError('resource-limit');
    const parsed=selection.map(v=>documentSelectionSchema.parse(v)).filter((pick,index,all)=>all.findIndex(other=>JSON.stringify(other)===JSON.stringify(pick))===index);
    const scribbleIds=new Map<string,Set<string>>();
    for(const pick of parsed)if(pick.target.entityType==='scribble'){
      const key=JSON.stringify([pick.target.workspaceId,pick.format]),ids=scribbleIds.get(key)??new Set<string>();ids.add(pick.target.id);scribbleIds.set(key,ids);
    }
    const groups=new Set<string>();
    const picks=parsed.filter(pick=>{
      if(pick.target.entityType!=='scribble')return true;
      const key=JSON.stringify([pick.target.workspaceId,pick.format]);
      if(groups.has(key))return false;groups.add(key);return true;
    });
    if(!picks.length||picks.length>100)throw new ApplicationError('resource-limit');
    const rows=await databaseTransaction<Record<string,any[]>>(this.name,tables,'readonly',(tx,done)=>{
      const result:Record<string,any[]>={};let left=tables.length;
      for(const table of tables){const r=tx.objectStore(table).getAll();r.onsuccess=()=>{result[table]=r.result;if(!--left)done(result);};}
    });
    const out:DocumentExport={files:[],errors:[]},names=new Set<string>(),seen=new Set<string>();let total=0;
    const add=(name:string,content:string,type:'text'|'html'|'binary'='text',source?:VideoKey)=>{
      if(content.length>(type==='binary'?documentLimits.binaryChars:documentLimits.fileChars))throw new Error('此文件内容超限，请缩小资料范围');
      if(total+content.length>documentLimits.batchChars||out.files.length>=200)throw new Error('本批内容超限，请缩小选区');
      const clean=safeFilename(name),dot=clean.lastIndexOf('.'),stem=dot>0?clean.slice(0,dot):clean,ext=dot>0?clean.slice(dot):'';
      let unique=clean,n=2;while(names.has(unique.toLocaleLowerCase()))unique=`${stem}_${n++}${ext}`;names.add(unique.toLocaleLowerCase());
      total+=content.length;out.files.push({name:unique,content,type,...(source?{source:{videoId:source.videoId,...(source.pageNumber?{pageNumber:source.pageNumber}:{})}}:{})});return unique;
    };
    for(const pick of picks){
      const {target,format}=pick,key=JSON.stringify([target,format]);if(seen.has(key))continue;seen.add(key);
      const before=out.files.length,previousTotal=total,previousNames=new Set(names);
      try{
        if(!formatsFor(target.entityType).includes(format)||target.entityType==='workspace')throw new Error('此资料不支持所选格式');
        const space=rows.workspaces.find(v=>v.id===target.workspaceId&&!v.deleted) as StoredWorkspace|undefined;
        if(!space)throw new Error('来源空间已删除或不可用');
        const source=space.source,labels=mediaDisplay(source),prefix=labels.prefix;
        const header=`来源视频：${labels.fullTitle}\n范围：${labels.part}\n视频：${sourceUrl(source)}\n`;
        const images=new Map<string,string>();
        const photos=(ids:readonly string[],chatId:string,title:string)=>ids.map(id=>{
              const image=rows.attachments.find(v=>v.id===id&&v.workspaceId===space.id&&v.chatId===chatId);
              if(!image||image.source?.videoId!==source.videoId||image.source?.partId!==source.partId)return '[历史截图不可用]';
              if(format==='txt')return `[截图 ${formatTime(image.time)}]`;
              let name=images.get(id);if(!name){if(!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl))throw new Error('截图数据无效');name=add(`${prefix}_${title}_截图${images.size+1}.png`,image.dataUrl.slice(22),'binary');images.set(id,name);}
              return `![视频截图 ${formatTime(image.time)}](./${encodeURIComponent(name)})`;
            }).join('\n');
        if(target.entityType==='chat'){
          const chat=space.chats.find(v=>v.id===target.id&&!v.deleted);if(!chat)throw new Error('对话已删除或不可用');
          const messages=(chat.messages??[]).filter(v=>v.state==='completed'&&v.kind!=='scribble-operation');
          if(!messages.length)throw new Error('无已完成的问答记录');
          // Artifact tasks are represented by saved cards rather than empty text.
          const body=messages.map(m=>{
            const photosText=photos(m.attachmentIds,chat.id,chat.title);
            return `${format==='md'?'## ':''}${m.role==='user'?'用户':'助手'}\n\n${m.role==='assistant'&&m.outputType==='html'?'[HTML 页面另行选择导出]':m.role==='assistant'&&m.outputType==='markdown'?'[已保存笔记另行选择导出]':m.text}\n${photosText}`;
          }).join('\n\n');
          add(`${prefix}_${chat.title}.${format}`,header+'\n'+body);continue;
        }
        if(target.entityType==='markdown'||target.entityType==='html'){
          const a=rows.artifacts.find(v=>v.workspaceId===space.id&&v.id===target.id&&!v.deleted);
          if(!a||target.entityType==='markdown'&&a.type!=='markdown'||target.entityType==='html'&&a.type!=='html-page')throw new Error('资料不可用或旧知识不支持源码导出');
          const revision=rows.noteRevisions.find(v=>v.artifactId===a.id&&v.id===a.revisionId);if(!revision)throw new Error('已保存版本不可用');
          const ids=[...new Set(space.chats.find(c=>c.id===a.sourceChatId)?.messages?.filter(m=>m.jobId===a.jobId).flatMap(m=>m.attachmentIds)??[])];
          const attachments=a.type==='markdown'?photos(ids,a.sourceChatId,a.title):'';
          add(`${prefix}_${a.title}.${format}`,a.type==='html-page'?revision.content:header+`保存版本：${a.revision}\n\n`+revision.content+(attachments?'\n\n来源截图：\n'+attachments:''),a.type==='html-page'?'html':'text',a.type==='html-page'?source:undefined);continue;
        }
        if(target.entityType==='scribble'){
          const ids=scribbleIds.get(JSON.stringify([space.id,format]))!;
          const items=rows.scribbles.filter(v=>v.workspaceId===space.id&&!v.deleted&&(ids.has('*')||ids.has(v.id))).sort((a,b)=>(a.time??Infinity)-(b.time??Infinity)||(a.creationOrder??0)-(b.creationOrder??0));
          if(!items.length)throw new Error('没有所选随笔');
          add(`${prefix}_${ids.has('*')||ids.size>1?'随笔汇总':items[0].text.slice(0,30)}.${format}`,header+'\n'+items.map(v=>`${v.time===null?'无时间点':format==='md'?`[${formatTime(v.time)}](vcamp-time:${v.time})`:formatTime(v.time)}\n${v.text}`).join('\n\n'));continue;
        }
        const versions=rows.subtitleVersions.filter(v=>v.workspaceId===space.id) as SubtitleVersion[];
        const isNative=isNativeTrackId(target.id);
        const version=isNative?undefined:versions.find(v=>v.id===target.id&&!v.deleted);
        const nativeTrack=native?.workspaceId===space.id?(target.id==='native'?native:nativeTracks({...native,status:'ready'}).find(t=>nativeTrackId(t.language)===target.id&&t.status==='ready')):undefined;
        if(!version&&!nativeTrack)throw new Error(isNative?'此语言的站点字幕未完整读取，请回源读取后重选':'字幕版本不可用');
        const language=version?.language??nativeTrack!.language,cues=version?.cues??nativeTrack!.cues;
        const chain:string[]=[],visited=new Set<string>();let current=version;
        while(current){
          if(visited.has(current.id)||visited.size>=100)throw new Error('字幕来源链异常');visited.add(current.id);
          const upstream='subtitleVersionId' in current.source?current.source.subtitleVersionId:null;
          chain.push(`版本 ${current.id}｜本插件AI${current.type==='translate'?'翻译':'字幕修正'}｜操作：${current.type==='translate'?'翻译':'字幕修正'}｜语言：${current.sourceLanguage??'未知'} → ${current.language}｜上游：${upstream??'站点字幕（原生AI/人工属性未知）'}`);
          current=upstream?versions.find(v=>v.id===upstream):undefined;
          if(upstream&&!current)chain.push(`上游版本 ${upstream}：历史元数据未知，来源链不完整`);
        }
        const category=version?`本插件AI${version.type==='translate'?'翻译':'字幕修正'}`:`站点字幕（${native?.category==='ai'?'站点AI':native?.category==='human'?'站点人工':'AI/人工属性未知'}）`;
        const meta=header+`语言：${language}\n来源类别：${category}\n操作类型：${version?version.type==='translate'?'翻译':'字幕修正':'站点读取（非插件AI生成）'}\n`+(chain.length?'来源链（当前到上游）：\n'+chain.join('\n'):'上游版本/语言：站点版本未知 / '+language)+'\n';
        if(!cues.length)throw new Error('没有可导出的完整字幕');
        for(const cue of cues){subtitleTime(cue.from,',');subtitleTime(cue.to,',');if(cue.to<=cue.from||!cue.content.trim())throw new Error('字幕时间轴或正文无效');}
        const index=version?[...versions].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)).findIndex(v=>v.id===version.id)+1:0;
        const base=safeFilename(`${prefix}_${version?version.type==='translate'?'AI翻译':'AI字幕修正':'站点字幕'}_${version?.sourceLanguage??language}到${language}_版本${index||'未知'}`).slice(0,150);
        if(format==='bili-json'){
          if(version||!nativeTrack||!('rawJson' in nativeTrack)||typeof nativeTrack.rawJson!=='string')throw new Error('该轨未保留实际 B 站原始响应，不支持原始 JSON；其他格式仍可导出');
          add(base+'.bilibili.json',nativeTrack.rawJson);
        }else if(format==='json')add(base+'.json',JSON.stringify({format:'vcamp-subtitles',version:1,language,source:{videoId:source.videoId,partId:source.partId,pageNumber:source.pageNumber,category,chain},cues},null,2));
        else if(format==='txt')add(base+'.txt',meta+'\n'+cues.map(c=>`${formatTime(c.from)} --> ${formatTime(c.to)}\n${c.content}`).join('\n\n'));
        else{
          const vtt=format==='vtt',body=cues.map((c,i)=>`${vtt?'':i+1+'\n'}${subtitleTime(c.from,vtt?'.':',')} --> ${subtitleTime(c.to,vtt?'.':',')}\n${c.content.replace(/\r\n?/g,'\n').split('\n').filter(line=>line.trim()).join('\n')}`).join('\n\n')+'\n';
          const subtitleName=add(base+'.'+format,vtt?'WEBVTT\n\nNOTE\n'+meta.replace(/-->/g,'→').split('\n').filter(Boolean).join('\n')+'\n\n'+body:body);
          if(!vtt)add(subtitleName.slice(0,-4)+'.source.txt',meta);
        }
      }catch(e){out.files.splice(before);total=previousTotal;names.clear();previousNames.forEach(name=>names.add(name));out.errors.push({file:`${target.entityType}:${target.id}.${format}`,reason:e instanceof Error?e.message:'无法导出'});}
    }
    return out;
  }
}
