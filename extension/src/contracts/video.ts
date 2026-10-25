import { z } from 'zod';
import type { SourceBinding } from './generation';

export const bindingSchema = z.object({ platform: z.literal('bilibili'), videoId: z.string().min(1), partId: z.string().min(1), tabId: z.number().int().nonnegative(), documentId: z.string().min(1), epoch: z.number().int().positive() }).strict();
export const cueSchema = z.object({ from: z.number().finite().nonnegative(), to: z.number().finite().positive(), content: z.string() }).strict();
export type Cue = z.infer<typeof cueSchema>;
export const playbackSchema = z.object({ time: z.number().finite().nonnegative(), duration: z.number().finite().nonnegative().nullable(), paused: z.boolean() }).strict();
export const nativeTrackSchema = z.object({ language: z.string(), label: z.string(), rawJson:z.string().max(2000000).optional(), status: z.enum(['ready', 'auth-failed', 'permission-denied', 'read-failed']), cues: z.array(cueSchema) }).strict();
export type NativeTrack = z.infer<typeof nativeTrackSchema>;
export type Playback = z.infer<typeof playbackSchema>;
export const videoViewSchema = z.object({
  binding: bindingSchema.nullable(), status: z.enum(['unsupported', 'permission-denied', 'browser-permission-denied', 'auth-failed', 'loading', 'ready', 'no-subtitles', 'read-failed']),
  cues: z.array(cueSchema), language: z.string().nullable(), tracks: z.array(nativeTrackSchema).optional(), playback: playbackSchema.optional()
}).strict();
export type VideoView = z.infer<typeof videoViewSchema>;
export const sameBinding = (a: SourceBinding | null, b: SourceBinding | null) => !!a && !!b && a.platform === b.platform && a.videoId === b.videoId && a.partId === b.partId && a.tabId === b.tabId && a.documentId === b.documentId && a.epoch === b.epoch;
export const videoCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('video.retry'), binding: bindingSchema }).strict(),
  z.object({ type: z.literal('video.seek'), binding: bindingSchema, time: z.number().finite().nonnegative(), policy: z.literal('preserve') }).strict()
]);
export type VideoCommand = z.infer<typeof videoCommandSchema>;
export const videoStatusText: Record<VideoView['status'], string> = {
  unsupported: '尚未绑定视频', 'permission-denied': '浏览器未允许读取 B 站', 'browser-permission-denied':'浏览器未允许访问字幕站点', 'auth-failed': '字幕需要登录或重新鉴权', loading: '正在读取完整字幕…', ready: '完整字幕已就绪', 'no-subtitles': '无可用字幕 · 可使用自主画面识别', 'read-failed': '字幕读取失败，可重试'
};
export function videoStatusLabel(video: VideoView) {
  return video.status === 'permission-denied' && video.binding ? '字幕服务拒绝读取，可重试' : videoStatusText[video.status];
}
export function sendConditions(video?: VideoView) {
  return { subtitleReady: video?.status === 'ready' && !!video.binding && video.cues.length > 0, generationReady: false, canSend: false };
}
