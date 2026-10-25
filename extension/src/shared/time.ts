export function createTimeTools(){
const MAX_TIME=359999;
function validTime(value:number,duration?:number|null){return Number.isFinite(value)&&value>=0&&value<=MAX_TIME&&(duration==null||Number.isFinite(duration)&&value<=duration);}
function formatTime(seconds:number){
  if(!validTime(seconds))return '时间未知';
  const n=Math.floor(seconds),pad=(v:number)=>String(v).padStart(2,'0');
  return n>=3600?`${pad(Math.floor(n/3600))}:${pad(Math.floor(n/60)%60)}:${pad(n%60)}`:`${pad(Math.floor(n/60))}:${pad(n%60)}`;
}
function parseTime(value:string):number|null {
  const explicit=/^vcamp-time:(\d+(?:\.\d+)?)$/.exec(value);
  if(explicit){const n=Number(explicit[1]);return validTime(n)?n:null;}
  const m=/^\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]$/.exec(value);
  if(!m||Number(m[3])>=60||m[1]!==undefined&&Number(m[2])>=60)return null;
  const n=Number(m[1]??0)*3600+Number(m[2])*60+Number(m[3]);return validTime(n)?n:null;
}
// Only canonicalize plain point labels. Descriptions and intervals carry
// meaning beyond the seek target and must survive preview and export.
function markdownTimeLink(value:string){
  const match=/^\[([^\[\]\r\n]{1,200})\]\([\t ]*(vcamp-time:[^\s()]*)[\t ]*\)$/.exec(value.trim());
  if(!match)return null;
  const time=parseTime(match[2]);
  return time===null?null:{label:match[1],time};
}
function secondsRange(value:string){
  const text=value.startsWith('[')&&value.endsWith(']')?value.slice(1,-1):value;
  const match=/^(\d+(?:\.\d+)?)([\t ]*[-–—~～至到][\t ]*)(\d+(?:\.\d+)?)$/.exec(text);
  if(!match)return null;
  const from=Number(match[1]),to=Number(match[3]);
  return validTime(from)&&validTime(to)&&from<=to?{from,to,separator:match[2]}:null;
}
function timeLinkLabel(label:string,time:number){
  const markdown=markdownTimeLink(label),visible=markdown?.time===time?markdown.label:label,text=visible.trim();
  const range=secondsRange(text);
  if(range)return `${formatTime(range.from)}${range.separator}${formatTime(range.to)}`;
  return !text||parseTime(text)!==null||parseTime(`[${text}]`)!==null?formatTime(time):visible;
}
// Shared by the Markdown AST adapter and the serialized HTML bridge. A range
// is recognized anywhere in prose as a whole, so a bad/reversed range cannot
// leave behind a valid-looking half link. Single bare points stay contextual.
function videoTimeParts(value:string,options:{leading?:boolean;standalone?:boolean;markdownLinks?:boolean}={}){
  const parts:{text:string;time?:number}[]=[];
  const stamp='\\d{1,3}:\\d{2}(?::\\d{2})?';
  const candidate='(?:\\d+:){1,2}\\d+';
  const prefix='(?:视频(?:时间|进度)?|时间点|进度)[\\t ]*[:：]?[\\t ]*';
  const separator='[\\t ]*[-–—~～至到][\\t ]*';
  const clock=`(?:会议时间|预约时间|营业时间|北京时间|钟点|UTC)[\\t ]*[:：]?[\\t ]*${candidate}${separator}${candidate}`;
  // Consume the complete Markdown-shaped reference before matching its point
  // label. Otherwise HTML leaks the destination and seeks to rounded seconds.
  const markdown=options.markdownLinks?'(?<markdown>\\[[^\\[\\]\\r\\n]{1,200}\\]\\([\\t ]*vcamp-time:[^\\s()]*[\\t ]*\\))|':'';
  const seconds='(?<seconds>\\[\\d+(?:\\.\\d+)?'+separator+'\\d+(?:\\.\\d+)?\\])';
  const pattern=new RegExp(`${markdown}https?:\\/\\/\\S+|(?<clock>${clock})|${seconds}|(?<![\\d:./A-Za-z])(?<rangePrefix>${prefix})?(?<from>${candidate})(?<separator>${separator})(?<to>${candidate})(?![\\d:.])|\\[(?<point>${stamp})\\]|(?<prefix>${prefix})(?<labelled>${stamp})(?![\\d:])|^(?<indent>[\\t ]*)(?<leading>${stamp})(?![\\d:])`,'gm');
  const push=(text:string,time?:number)=>{if(text)parts.push(time===undefined?{text}:{text,time});};
  const point=(text:string)=>parseTime(`[${text}]`);
  let cursor=0;
  for(const match of value.matchAll(pattern)){
    const index=match.index!,groups=match.groups!,raw=match[0];
    push(value.slice(cursor,index));
    if(groups.markdown){
      const link=markdownTimeLink(raw);
      if(link)push(timeLinkLabel(link.label,link.time),link.time);else push(raw);
    }else if(groups.seconds){
      const range=secondsRange(raw),before=value.slice(Math.max(0,index-24),index),after=value.slice(index+raw.length);
      const videoContext=/(?:视频|时间|进度|片段|原片|原声|字幕)[^。！？\n]{0,12}$/.test(before);
      const ordinaryLabel=/(?:年份|年度|公元|版本|概率|参数|编号|页码|文献|数值|尺寸)[\t :：]*$/.test(before)||/^[\t ]*(?:年|岁|%|％)/.test(after);
      const ambiguous=/(?:范围|区间)[\t :：]*$/.test(before)||!!range&&(range.to<=1||Number.isInteger(range.from)&&Number.isInteger(range.to)&&range.from>=1900&&range.to<=2100);
      const ordinary=ordinaryLabel||!videoContext&&ambiguous;
      if(!range||ordinary)push(raw);
      else{push(formatTime(range.from),range.from);push(range.separator);push(formatTime(range.to),range.to);}
    }else if(groups.from){
      const from=point(groups.from),to=point(groups.to);
      if(from===null||to===null||from>to)push(raw);
      else {push(groups.rangePrefix??'');push(formatTime(from),from);push(groups.separator);push(formatTime(to),to);}
    }else if(groups.point){
      const time=point(groups.point);time===null?push(raw):push(formatTime(time),time);
    }else if(groups.labelled){
      const time=point(groups.labelled);if(time===null)push(raw);else{push(groups.prefix);push(formatTime(time),time);}
    }else if(groups.leading&&(options.leading!==false||options.standalone&&value.trim()===groups.leading)){
      const time=point(groups.leading);if(time===null)push(raw);else{push(groups.indent);push(formatTime(time),time);}
    }else push(raw);
    cursor=index+raw.length;
  }
  push(value.slice(cursor));
  return parts;
}
// SRT/VTT retain milliseconds, unlike UI display. Round once before splitting.
function subtitleTime(seconds:number,separator:','|'.'){
  if(!validTime(seconds))throw new Error('字幕时间无效');
  const n=Math.round(seconds*1000),pad=(v:number,width=2)=>String(v).padStart(width,'0');
  return `${pad(Math.floor(n/3600000))}:${pad(Math.floor(n/60000)%60)}:${pad(Math.floor(n/1000)%60)}${separator}${pad(n%1000,3)}`;
}

return {MAX_TIME,validTime,formatTime,parseTime,subtitleTime,timeLinkLabel,videoTimeParts,markdownTimeLink};
}
export const {MAX_TIME,validTime,formatTime,parseTime,subtitleTime,timeLinkLabel,videoTimeParts}=createTimeTools();
