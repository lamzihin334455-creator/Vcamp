import { ApplicationError } from '../contracts/application';
import type { SourceBinding, SubtitleBasis } from '../contracts/generation';
import {cueSchema,type Cue} from '../contracts/video';
import {formatTime} from '../shared/time';
import {subtitleProcessingLimits,subtitleInputLimits} from '../contracts/subtitle-limits';

export const limits = { ...subtitleInputLimits, outputChars: 100000, summaryChars: 1800, concurrent: 2, pending: 10 } as const;
export interface SubtitleSegment { text: string; firstCue: number; lastCue: number }
export const subtitleCitation=(cue:Pick<Cue,'from'|'to'>)=>`[${formatTime(cue.from)}–${formatTime(cue.to)}](vcamp-time:${cue.from})`;
/** Long transcripts omit duplicate display timestamps and repeated field names,
 * never cue text or precision. The header defines each numeric column once. */
export function subtitleLines(cues:readonly Cue[],cueIds=false){
  const readable=cues.map((cue,id)=>cueIds?`[cueId=${id}; startSeconds=${cue.from}; endSeconds=${cue.to}] ${cue.content}`:`${subtitleCitation(cue)} [startSeconds=${cue.from}; endSeconds=${cue.to}] ${cue.content}`);
  if(readable.reduce((n,line)=>n+line.length+1,0)<=60000)return {header:'',lines:readable};
  return {header:`完整字幕；时间单位为秒。每行 [${cueIds?'cueId,':''}startSeconds,endSeconds] 后为原始字幕，数字保留原始精度。\n`,
    lines:cues.map((cue,id)=>`[${cueIds?`${id},`:''}${cue.from},${cue.to}] ${cue.content}`)};
}
export function segmentSubtitles(cues: readonly Cue[]): SubtitleSegment[] {
  if (!cues.length || cues.length > limits.cueCount) throw new ApplicationError('context-limit');
  const segments: SubtitleSegment[] = [];
  const serialized=subtitleLines(cues);
  let text = serialized.header, firstCue = 0;
  for (let index = 0; index < cues.length; index++) {
    const line = serialized.lines[index]+'\n';
    // One indivisible cue above the cap is an explicit failure, never truncated.
    if (serialized.header.length+line.length > limits.segmentChars) throw new ApplicationError('context-limit');
    if (index>firstCue && text.length + line.length > limits.segmentChars) {
      segments.push({ text, firstCue, lastCue: index - 1 }); text = serialized.header; firstCue = index;
    }
    text += line;
  }
  segments.push({ text, firstCue, lastCue: cues.length - 1 });
  if (segments.length > limits.segments) throw new ApplicationError('context-limit');
  return segments;
}
export async function timingFingerprint(cues: readonly Cue[]) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(cues.map(({ from, to }) => [from, to]))));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function subtitleBasis(binding: SourceBinding, language: string | null, cues: readonly Cue[], options?:{allowEmpty?:boolean;mediaDuration?:number;purpose?:'subtitle'}): Promise<SubtitleBasis> {
  if(cues.length){if(options?.purpose==='subtitle'){if(cues.length>subtitleProcessingLimits.cueCount||cues.reduce((size,cue)=>size+cue.content.length,0)>subtitleProcessingLimits.savedChars)throw new ApplicationError('context-limit');if(cues.some((cue,index)=>!cueSchema.safeParse(cue).success||cue.to<=cue.from||index>0&&cue.from<cues[index-1].from))throw new ApplicationError('invalid-message');}else segmentSubtitles(cues);}else if(!options?.allowEmpty)throw new ApplicationError('context-limit');
  const data = new TextEncoder().encode(JSON.stringify(cues));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const duration=options?.mediaDuration;
  validateSubtitleTimeline(cues,duration);
  return { locator: `bilibili:${binding.videoId}:${binding.partId}:${language ?? 'unknown'}`, fingerprint: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), timingFingerprint: await timingFingerprint(cues), language, binding: structuredClone(binding), cueCount: cues.length, ...(Number.isFinite(duration)&&duration!>0?{mediaDuration:duration}:{}), ...(!cues.length?{visionOnly:true as const,mediaDuration:Number.isFinite(duration)&&duration!>0?duration:1}:{}) };
}
export function validateSubtitleTimeline(cues:readonly Cue[],duration?:number){
  if(duration===undefined||!Number.isFinite(duration)||duration<=0)return;
  // Native ASR may end slightly after the last decoded frame. A different
  // timeline is rejected; guessing an offset or scaling would invent evidence.
  if(cues.some(cue=>cue.from>=duration||cue.to>duration+1))throw new ApplicationError('source-changed');
}
