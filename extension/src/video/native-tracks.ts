import type {NativeTrack,VideoView} from '../contracts/video';

export const nativeTrackId=(language:string)=>`native:${encodeURIComponent(language)}`;
export const isNativeTrackId=(id:string)=>id==='native'||id.startsWith('native:');
export function nativeTracks(video?:Pick<VideoView,'tracks'|'status'|'language'|'cues'>):NativeTrack[]{
  return video?.tracks??(video?.status==='ready'&&video.language?[{language:video.language,label:video.language,status:'ready',cues:video.cues}]:[]);
}
export const nativeTrackLabel=(track:Pick<NativeTrack,'language'|'label'>)=>`原始字幕 · ${track.label}${track.label!==track.language?`（${track.language}）`:''}`;
