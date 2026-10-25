import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModuleProps } from '../app/modules';
import type { ApplicationClient } from '../contracts/application';
import { sameBinding, videoStatusLabel, type VideoView, type Playback, type NativeTrack } from '../contracts/video';
import { SubtitleTimeline, formatTime } from './SubtitleTimeline';
import { SubtitleSettingsPopover } from './SubtitleSettingsPopover';
import {Icon} from '../app/Icons';

export type SubtitleRefreshAction={run:()=>void;disabled:boolean};

export function VideoActions({ video, client }: { video?: VideoView; client: ApplicationClient }) {
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    if (!video?.binding) return;
    setBusy(true); setNotice('');
    try { await client.command({ type: 'video.retry', binding: video.binding }); }
    catch { setNotice('读取未完成，请确认视频仍在当前页面后重试。'); }
    finally { setBusy(false); }
  };
  const refresh=async()=>{setBusy(true);try{await client.query();}catch{setNotice('读取未完成，请检查浏览器站点访问。');}finally{setBusy(false);}};
  const grant = async () => {
    try { await chrome.tabs.create({url:`chrome://extensions/?id=${chrome.runtime.id}`}); setNotice('请在浏览器扩展详情恢复 B 站站点访问，然后重新打开视频。'); }
    catch {setNotice('请在浏览器扩展管理中恢复 B 站站点访问。');}
  };
  return <div className="video-actions">
    {video&&(video.status === 'browser-permission-denied'||video.status==='permission-denied'&&!video.binding) && <button onClick={() => void grant()}>恢复浏览器站点访问</button>}
    {video?.status === 'read-failed' && !video.binding && <button onClick={() => void refresh()}>重试识别视频</button>}
    {video?.binding && ['read-failed', 'auth-failed', 'no-subtitles', 'permission-denied'].includes(video.status) && <button disabled={busy} onClick={() => void retry()}>{busy ? '正在重试…' : '重新读取字幕'}</button>}
    {notice && <span role="alert">{notice}</span>}
  </div>;
}
export function NativeSubtitles({ view, client, heading = '原生字幕', settingsOpen, onSettingsClose, headingInHeader, selectedTrack, trackBusy, onTrackChange, onRefreshAction, children }: ModuleProps & { heading?: string; settingsOpen?: boolean; onSettingsClose?:()=>void; headingInHeader?:boolean; selectedTrack?: string; trackBusy?: boolean; onTrackChange?: (language:string)=>void; onRefreshAction?:(action:SubtitleRefreshAction)=>void;children?: ReactNode }) {
  const [error, setError] = useState('');
  const video = view.video;
  const binding = video?.binding;
  const [primaryLanguage, setPrimaryLanguage] = useState<string | null>(null);
  const [auxLanguage, setAuxLanguage] = useState<string | null>(null);
  const [bilingual, setBilingual] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [auxiliaryFontSize,setAuxiliaryFontSize]=useState(14),[autoReturn,setAutoReturn]=useState(true),[scrollActivity,setScrollActivity]=useState(0);
  const optionsEdited=useRef({font:false,autoReturn:false});
  useEffect(()=>{let alive=true,sequence=0;const read=async(initial=false)=>{const token=++sequence;try{const value=await client.subtitlePreferences?.readOptions?.();if(alive&&value&&token===sequence){if(!initial||!optionsEdited.current.font)setAuxiliaryFontSize(value.auxiliaryFontSize);if(!initial||!optionsEdited.current.autoReturn)setAutoReturn(value.autoReturn);}}catch{}};void read(true);const dispose=client.subscribePreferences?.(keys=>{if(keys.some(key=>key==='vcamp.subtitleAuxiliaryFontSize'||key==='vcamp.subtitleAutoReturn'))void read();});return()=>{alive=false;dispose?.();};},[client]);
  const fontEdited = useRef(false);
  useEffect(()=>{let alive=true;const dispose=client.subscribePreferences?.(keys=>{if(keys.includes('vcamp.subtitleFontSize'))void client.subtitlePreferences?.read().then(size=>{if(alive)setFontSize(size);}).catch(()=>{});});return()=>{alive=false;dispose?.();};},[client]);
  const [follow, setFollow] = useState(true);
  const [manual, setManual] = useState(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [playback, setPlayback] = useState<Playback | null>(video?.playback ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [localSettings, setLocalSettings] = useState(false);
  const mounted = useRef(true);
  const currentBinding = useRef(binding); currentBinding.current = binding;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(()=>{if(!follow||!manual||!autoReturn)return;const timer=setTimeout(()=>{setManual(false);setScrollRequest(value=>value+1);},5000);return()=>clearTimeout(timer);},[follow,manual,autoReturn,scrollActivity,binding?.tabId,binding?.documentId,binding?.epoch]);
  useEffect(() => {
    let alive = true;
    void client.subtitlePreferences?.read().then(size => { if (alive && !fontEdited.current) setFontSize(size); }).catch(() => {});
    return () => { alive = false; };
  }, [client]);
  useEffect(() => {
    if (view.mode === 'readonly' || !binding) { setPlayback(null); return; }
    let alive = true;
    setPlayback(video?.playback ?? null);
    const dispose = client.subscribePlayback?.(binding, value => { if (alive) setPlayback(value); });
    return () => { alive = false; dispose?.(); };
  }, [client, view.mode, binding?.tabId, binding?.documentId, binding?.epoch]);
  useEffect(() => {
    if (!client.subscribePlayback) setPlayback(binding ? video?.playback ?? null : null);
  }, [client, binding, video?.playback]);
  const tracks: NativeTrack[] = video?.tracks ?? (video?.status === 'ready' && video.language ? [{ language: video.language, label: video.language, status: 'ready', cues: video.cues }] : []);
  const mainLanguage = selectedTrack ?? primaryLanguage ?? video?.language ?? tracks[0]?.language ?? '';
  const secondLanguage = auxLanguage === mainLanguage ? tracks.find(track => track.language !== mainLanguage)?.language ?? '' : auxLanguage ?? tracks.find(track => track.language !== mainLanguage)?.language ?? '';
  const primary = tracks.find(track => track.language === mainLanguage);
  const secondary = tracks.find(track => track.language === secondLanguage && track.language !== mainLanguage);
  const loading = refreshing || video?.status === 'loading';
  const resume = useCallback(() => { setFollow(true); setManual(false); setScrollRequest(value => value + 1); },[]);
  const jump = async (time: number) => {
    if (!video?.binding) return;
    setError('');
    const requested = video.binding;
    try {
      const result = await client.command({ type: 'video.seek', binding: requested, time, policy: 'preserve' });
      if (mounted.current && sameBinding(currentBinding.current ?? null, requested)) {
        if (sameBinding(result.video?.binding ?? null, requested) && result.video?.playback) setPlayback(result.video.playback);
        if (follow) { setManual(false); setScrollRequest(value => value + 1); }
      }
    } catch { if (mounted.current && sameBinding(currentBinding.current ?? null, requested)) setError('未能定位。请确认视频仍在当前页面并已加载，再重试。'); }
  };
  const refresh = useCallback(async () => {
    if (!binding) return;
    resume(); setRefreshing(true); setError('');
    try {
      const result = await client.command({ type: 'video.retry', binding });
      if (mounted.current && sameBinding(currentBinding.current ?? null, binding) && sameBinding(result.video?.binding ?? null, binding) && result.video?.playback) setPlayback(result.video.playback);
    } catch { if (mounted.current && sameBinding(currentBinding.current ?? null, binding)) setError('刷新未完成，请确认当前视频后重试。已有资料不受影响。'); }
    finally { if (mounted.current && sameBinding(currentBinding.current ?? null, binding)) setRefreshing(false); }
  },[binding,client,resume]);
  useEffect(()=>{onRefreshAction?.({run:()=>void refresh(),disabled:!binding||loading||!!trackBusy});},[onRefreshAction,refresh,loading,trackBusy,!!binding]);
  if (view.mode === 'readonly') return <div className="empty-state"><h1>暂无已保存字幕</h1><p>只读资料页仅展示已保存的 AI 字幕。</p></div>;
  const trackError = (track?: NativeTrack) => !track ? '该语言已不可用，请重新选择。' : track.status === 'auth-failed' ? '此轨道需要登录后刷新。' : track.status === 'permission-denied' ? '此轨道被字幕服务拒绝，请刷新重试。' : '此轨道读取失败，请刷新重试。';
  return <section className="native-subtitles" aria-label={heading}>
    {!headingInHeader && <div className="subtitle-heading"><strong>{heading}</strong><small>{loading ? '正在读取完整字幕…' : primary?.status === 'ready' ? `${primary.label} · ${primary.cues.length} 条` : video ? videoStatusLabel(video) : '尚未绑定视频'}</small></div>}
    {settingsOpen === undefined && <div className="subtitle-inline-actions"><button aria-label="刷新" title="重新读取字幕并回到当前播放位置" disabled={!binding||loading||trackBusy} onClick={()=>void refresh()}><Icon name="refresh"/></button><button className="subtitle-settings-trigger" data-subtitle-settings-trigger aria-expanded={localSettings} onClick={()=>setLocalSettings(value=>!value)}>字幕设置</button></div>}
    {(settingsOpen ?? localSettings) && <SubtitleSettingsPopover close={onSettingsClose ?? (()=>setLocalSettings(false))}><div className="subtitle-options">
      <label>主字幕<select aria-label="主字幕" disabled={loading || trackBusy || !tracks.length} value={mainLanguage} onChange={event => { setPrimaryLanguage(event.target.value); onTrackChange?.(event.target.value); }}>
        {!primary && <option value={mainLanguage}>{mainLanguage ? `${mainLanguage}（已不可用）` : '暂无语言'}</option>}{tracks.map(track => <option value={track.language} key={track.language}>{track.label}{track.status !== 'ready' ? '（读取失败）' : ''}</option>)}
      </select></label>
      <label className="subtitle-toggle"><input type="checkbox" checked={bilingual} onChange={event => setBilingual(event.target.checked)}/>双语显示</label>
      {bilingual && <label>辅助语言<select aria-label="辅助语言" disabled={loading || tracks.length < 2} value={secondLanguage} onChange={event => setAuxLanguage(event.target.value)}>
        {!secondary && <option value={secondLanguage}>{secondLanguage ? `${secondLanguage}（不可用或与主语言相同）` : '暂无辅助语言'}</option>}{tracks.filter(track => track.language !== mainLanguage).map(track => <option value={track.language} key={track.language}>{track.label}{track.status !== 'ready' ? '（读取失败）' : ''}</option>)}
      </select></label>}
      <label>{bilingual?'主字幕字号':'字号'} {fontSize}px<input aria-label={bilingual?'主字幕字号':'字幕字号'} type="range" min="14" max="24" step="2" value={fontSize} onChange={event => { const value = Number(event.target.value); fontEdited.current = true; setFontSize(value); void client.subtitlePreferences?.write(value).catch(() => setError('字号未保存，本次显示仍有效。')); }}/></label>
      {bilingual&&<label>辅助字幕字号 {auxiliaryFontSize}px<input aria-label="辅助字幕字号" type="range" min="14" max="24" step="2" value={auxiliaryFontSize} onChange={event=>{const value=Number(event.target.value);optionsEdited.current.font=true;setAuxiliaryFontSize(value);void client.subtitlePreferences?.writeOptions?.({auxiliaryFontSize:value}).catch(()=>setError('字号未保存，本次显示仍有效。'));}}/></label>}
      <div className="subtitle-follow-options"><label className="subtitle-toggle"><input type="checkbox" checked={follow} onChange={event => { setFollow(event.target.checked); setManual(false); }}/>跟随播放</label><label className="subtitle-toggle" title="停止滚动 5 秒后回到当前播放位置"><input type="checkbox" checked={autoReturn} disabled={!follow} onChange={event=>{const value=event.target.checked;optionsEdited.current.autoReturn=true;setAutoReturn(value);void client.subtitlePreferences?.writeOptions?.({autoReturn:value}).catch(()=>setError('归位偏好未保存，本次设置仍有效。'));}}/>自动归位</label></div>
    </div>{children}</SubtitleSettingsPopover>}
    <div className="subtitle-position" aria-live="off">{playback ? `${playback.paused ? '暂停' : '播放中'} · ${formatTime(playback.time)}` : '播放位置暂不可用'}{manual ? ' · 已暂停跟随' : !follow ? ' · 跟随已关闭' : ''}</div>
    <VideoActions video={video} client={client}/>
    {video?.status === 'auth-failed' && <p className="video-help">请在 B 站页面登录，再重新读取。</p>}
    {video?.status === 'no-subtitles' && <p className="video-help">当前视频无可用字幕，可在问答中使用自主识别画面。已有本地资料和草稿仍可访问。</p>}
    {!loading && mainLanguage && primary?.status !== 'ready' && <p role="alert">主字幕：{trackError(primary)}</p>}
    {!loading && bilingual && secondary?.status !== 'ready' && <p role="alert">辅助字幕：{trackError(secondary)}</p>}
    {primary?.status === 'ready' && <SubtitleTimeline primary={primary.cues} auxiliary={secondary?.status === 'ready' ? secondary.cues : undefined} bilingual={bilingual} fontSize={fontSize} auxiliaryFontSize={auxiliaryFontSize} playback={playback} follow={follow && !manual} scrollRequest={scrollRequest} onUserScroll={() => { if (follow){setManual(true);setScrollActivity(value=>value+1);} }} onSeek={binding ? time => void jump(time) : undefined}/>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
