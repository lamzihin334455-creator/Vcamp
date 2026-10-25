import { z } from 'zod';
import { cueSchema, type VideoView, type NativeTrack } from '../contracts/video';
export interface SubtitleNetwork {
  metadata(signal: AbortSignal): Promise<{ http: number; json: unknown }>;
  track(url: string, signal: AbortSignal): Promise<{ http: number; json: unknown; rawText?:string }>;
}
const metadataSchema = z.object({ code: z.number(), data: z.object({ need_login_subtitle: z.boolean().optional(), subtitle: z.object({ need_login_subtitle: z.boolean().optional(), subtitles: z.array(z.object({ lan: z.string(), lan_doc: z.string().optional(), subtitle_url: z.string().min(1) })) }).optional() }).optional() });
export type SubtitleRead = Pick<VideoView, 'status' | 'cues' | 'language' | 'tracks'>;
export async function readCompleteSubtitles(network: SubtitleNetwork, signal: AbortSignal): Promise<SubtitleRead> {
  const empty = (status: VideoView['status']) => ({ status, cues: [], language: null });
  try {
    const response = await network.metadata(signal);
    const access = z.object({ code: z.number(), data: z.object({ need_login_subtitle: z.boolean().optional(), subtitle: z.object({ need_login_subtitle: z.boolean().optional() }).optional() }).optional() }).safeParse(response.json);
    if (response.http === 401 || (access.success && access.data.code === -101)) return empty('auth-failed');
    if (response.http === 403 || (access.success && access.data.code === -403)) return empty('permission-denied');
    if (response.http === 200 && access.success && access.data.code === 0 && (access.data.data?.need_login_subtitle || access.data.data?.subtitle?.need_login_subtitle)) return empty('auth-failed');
    const parsed = metadataSchema.safeParse(response.json);
    if (response.http === 401 || (parsed.success && parsed.data.code === -101)) return empty('auth-failed');
    if (response.http === 403 || (parsed.success && parsed.data.code === -403)) return empty('permission-denied');
    if (response.http !== 200 || !parsed.success || parsed.data.code !== 0) return empty('read-failed');
    if (parsed.data.data?.need_login_subtitle || parsed.data.data?.subtitle?.need_login_subtitle) return empty('auth-failed');
    const tracks = parsed.data.data?.subtitle?.subtitles;
    if (!tracks) return empty('read-failed');
    if (!tracks.length) return empty('no-subtitles');
    const unique = tracks.filter((track, i) => tracks.findIndex(item => item.lan === track.lan) === i);
    const loaded = await Promise.all(unique.map(async (track): Promise<NativeTrack> => {
      const failed = (status: NativeTrack['status']): NativeTrack => ({ language: track.lan, label: track.lan_doc ?? track.lan, status, cues: [] });
      try {
        const url = new URL(track.subtitle_url.startsWith('//') ? `https:${track.subtitle_url}` : track.subtitle_url);
        if (signal.aborted || url.protocol !== 'https:' || url.hostname !== 'aisubtitle.hdslb.com' || url.username || url.password || url.port) return failed('read-failed');
        const body = await network.track(url.href, signal);
        if (body.http === 401) return failed('auth-failed');
        if (body.http === 403) return failed('permission-denied');
        const cues = z.object({ body: z.array(cueSchema.passthrough()).min(1) }).safeParse(body.json);
        if (body.http !== 200 || !cues.success || signal.aborted) return failed('read-failed');
        const normalized = cues.data.body.map(({ from, to, content }) => ({ from, to, content }));
        if (normalized.some((cue, i) => cue.to <= cue.from || (i > 0 && cue.from < normalized[i - 1].from))) return failed('read-failed');
        const rawJson=body.rawText??JSON.stringify(body.json);
        return { ...failed('ready'), cues: normalized,...(rawJson.length<=2000000?{rawJson}:{}) };
      } catch { return failed('read-failed'); }
    }));
    if (signal.aborted) return empty('read-failed');
    // Choose a usable initial default; an explicit user selection is owned by
    // the workspace and is never silently changed here.
    const primary = loaded.find(item => item.language === 'zh-CN' && item.status === 'ready') ?? loaded.find(item => item.status === 'ready') ?? loaded.find(item => item.language === 'zh-CN') ?? loaded[0];
    return { status: primary.status, cues: primary.cues, language: primary.status === 'ready' ? primary.language : null, tracks: loaded };
  } catch { return empty('read-failed'); }
}
