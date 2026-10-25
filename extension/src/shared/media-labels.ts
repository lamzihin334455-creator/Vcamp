import type {VideoKey} from '../contracts/application';

// Display only: never alter the identity, URL, pageNumber or persisted source.
export function mediaDisplay(source:VideoKey){
  const legacy=/^(.*?) · P(\d+) (.*)$/.exec(source.title);
  const title=source.videoTitle??legacy?.[1]??source.title;
  const pageNumber=source.pageNumber??(legacy?Number(legacy[2]):undefined);
  const single=source.partCount===1;
  const part=single?'本视频':pageNumber?`P${pageNumber}`:'来源分段';
  return {title,partTitle:single?title:source.partTitle??legacy?.[3]??source.title,pageNumber,partCount:source.partCount,single,part,
    fullTitle:single?title:source.title,prefix:single?title:`${title}_${pageNumber?`P${pageNumber}`:`分P_${source.partId}`}`};
}
