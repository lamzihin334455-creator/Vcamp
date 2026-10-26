import { nativeDeepSeek } from '../contracts/provider-config';
import {WebSources} from './WebSources';
import { RequestInstructionButton } from './Instructions';
import {nativeTracks as getNativeTracks,nativeTrackId,nativeTrackLabel,isNativeTrackId} from '../video/native-tracks';
import {DocumentExportDialog} from '../library/DocumentExport';
import { DeleteButton } from '../library/Management';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApplicationClient } from '../contracts/application';
import type { ModuleProps } from '../app/modules';
import type { AnalysisSource, SubtitlesView, SubtitleVersion } from '../contracts/subtitles';
import { NativeSubtitles, type SubtitleRefreshAction } from '../video/NativeSubtitles';
import { SubtitleTimeline } from '../video/SubtitleTimeline';
import { useProvider } from '../app/ProviderSettings';
import { useGeneration, taskLabels, failureLabels } from '../app/use-generation';
import { terminal } from '../contracts/generation';
import { subtitleBatches } from '../generation/run-subtitle';
import { SubtitleTranslationStatus } from './SubtitleTranslationStatus';

const sourceSelection = (source: AnalysisSource) => source.kind === 'native' ? source.language ? nativeTrackId(source.language) : 'native' : source.versionId;

export function useSubtitles(client: ApplicationClient, workspaceId: string | null, versionId?: string) {
  const scope = useMemo(() => ({ active: false, sequence: 0 }), [client, workspaceId, versionId]);
  const [state, setState] = useState<{ scope: typeof scope; view?: SubtitlesView; error: string }>({ scope, error: '' });
  const accept = useCallback((value: SubtitlesView) => {
    if (!scope.active) return;
    ++scope.sequence;
    setState(previous => previous.scope === scope && previous.view && previous.view.sourceRevision > value.sourceRevision ? previous : { scope, view: value, error: '' });
  }, [scope]);
  useEffect(() => {
    scope.active = true;
    setState({ scope, error: '' });
    if (!workspaceId || !client.subtitles) return;
    const refresh = async () => {
      const token = ++scope.sequence;
      try {
        const value = await client.subtitles!({ type: 'subtitles.query', workspaceId, ...(versionId ? { versionId } : {}) });
        if (scope.active && token === scope.sequence) setState(previous => previous.scope === scope && previous.view && previous.view.sourceRevision > value.sourceRevision ? previous : { scope, view: value, error: '' });
      } catch { if (scope.active && token === scope.sequence) setState(previous => ({ scope, view: previous.scope === scope ? previous.view : undefined, error: '字幕版本读取失败，请重试；已显示的字幕仍可查看。' })); }
    };
    const dispose = client.subscribe(() => void refresh(), state => { if (state === 'connected') void refresh(); });
    void refresh(); return () => { scope.active = false; ++scope.sequence; dispose(); };
  }, [client, workspaceId, versionId, scope]);
  return { view: state.scope === scope ? state.view : undefined, error: state.scope === scope ? state.error : '', accept };
}

export function SubtitleWorkbench({ client, view, subtitleVersionId, onChromeChange }: ModuleProps) {
  const [exportOpen,setExportOpen]=useState(false);
  const [subtitleWeb,setSubtitleWeb]=useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshAction,setRefreshAction]=useState<SubtitleRefreshAction>();
  const receiveRefresh=useCallback((action:SubtitleRefreshAction)=>setRefreshAction(action),[]);
  const readonly = view.mode === 'readonly';
  const fixedId = readonly ? subtitleVersionId ?? new URLSearchParams(location.search).get('subtitleVersionId') ?? undefined : undefined;
  const subtitles = useSubtitles(client, readonly && !fixedId ? null : view.workspaceId, fixedId);
  const latestSubtitles = useRef(subtitles.view); latestSubtitles.current = subtitles.view;
  const provider = useProvider(client, !readonly);
  const generation = useGeneration(client, !readonly && view.workspaceId ? { kind: 'subtitle', workspaceId: view.workspaceId, operation: 'translate' } : null);
  const [selected, setSelected] = useState(fixedId ?? 'native'), [language, setLanguage] = useState('en'), [translationOpen, setTranslationOpen] = useState(false), [diffOpen, setDiffOpen] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [translationFocus,setTranslationFocus]=useState<{workspaceId:string;jobId:string}|null>(null);
  const pendingTranslation=useRef<{workspaceId:string;known:Set<string>}|null>(null);
  const selection = useRef({ busy: false, epoch: 0 });
  useEffect(() => { const current = selection.current; current.busy = false; ++current.epoch; setSelecting(false); return () => { ++current.epoch; current.busy = false; }; }, [view.workspaceId, fixedId]);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const dismissTranslation = useCallback(() => setTranslationFocus(null), []);
  const model = provider.view?.defaultModelId ?? '';
  useEffect(() => { if (provider.view && !nativeDeepSeek(provider.view)) setSubtitleWeb(false); }, [provider.view?.providerId, provider.view?.baseUrl, subtitleWeb]);
  useEffect(() => { setSelected(fixedId ?? 'native'); setTranslationOpen(false); setDiffOpen(false); setNotice(''); setError(''); setTranslationFocus(null); pendingTranslation.current=null; }, [view.workspaceId, fixedId]);
  useEffect(() => {
    if (fixedId || !subtitles.view) return;
    setSelected(sourceSelection(subtitles.view.analysisSource));
  }, [fixedId, subtitles.view?.sourceRevision]);
  const versions = subtitles.view?.versions ?? view.subtitles?.versions ?? [];
  const translationJobs=generation.view?.jobs.filter(job=>job.target.kind==='subtitle')??[];
  useEffect(()=>{
    const pending=pendingTranslation.current;
    if(!pending||pending.workspaceId!==view.workspaceId)return;
    const submitted=translationJobs.find(job=>!pending.known.has(job.jobId));
    if(submitted){setTranslationFocus({workspaceId:pending.workspaceId,jobId:submitted.jobId});pendingTranslation.current=null;}
  },[generation.view,view.workspaceId]);
  const activeTranslation=translationJobs.find(job=>!terminal(job.state));
  // Reopening can resume a live task, but must not announce saved history.
  useEffect(()=>{
    if(activeTranslation&&view.workspaceId)setTranslationFocus({workspaceId:view.workspaceId,jobId:activeTranslation.jobId});
  },[view.workspaceId,activeTranslation?.jobId,activeTranslation?.attemptId]);
  const translationJob=activeTranslation??translationJobs.find(job=>translationFocus?.workspaceId===view.workspaceId&&job.jobId===translationFocus.jobId);
  const translatedVersion=translationJob?versions.find(version=>version.jobId===translationJob.jobId&&version.attemptId===translationJob.attemptId&&version.type===(translationJob.target.kind==='subtitle'?translationJob.target.operation:'translate')):undefined;
  const saved = versions.find(version => version.id === selected);
  const savedTracks = versions.map(version => ({ language: `saved:${version.id}`, label: `${version.type === 'translate' ? 'AI 翻译' : 'AI 字幕修正'} · ${version.language} · ${new Date(version.createdAt).toLocaleString()}`, status: 'ready' as const, cues: version.cues }));
  const nativeTracks = getNativeTracks(view.video).map(track=>({...track,label:nativeTrackLabel(track)}));
  const native = selected==='native' ? nativeTracks.find(t=>t.language===view.video?.language)??nativeTracks[0] : nativeTracks.find(t=>nativeTrackId(t.language)===selected);
  const sourceCues = saved?.cues ?? native?.cues ?? [];
  let segments = 0, limitError = '';
  try { if (sourceCues.length) segments = subtitleBatches(sourceCues).length; } catch { limitError = '字幕超出本轮上限，未截断或发送。'; }
  const subtitleWebReady=!subtitleWeb||nativeDeepSeek(provider.view) && provider.view?.models.some(m=>m.id==='deepseek-flash'&&m.text!=='unsupported');
  const ready = subtitleWebReady && !selecting && !!view.workspaceId && !!client.generation && !!sourceCues.length && !!segments && !!provider.view?.hasKey && provider.view.models.some(m => m.id === model && m.text !== 'unsupported') && (!!saved || !!view.video?.binding);
  async function send(operation: 'translate' | 'enhance') {
    if (!ready || !view.workspaceId) return;
    setError(''); setNotice('');
    pendingTranslation.current={workspaceId:view.workspaceId,known:new Set(translationJobs.map(job=>job.jobId))};
    const accepted = await generation.command({ type: 'generation.subtitle.send', target: { kind: 'subtitle', workspaceId: view.workspaceId, operation }, subtitleWorkflow:2,webEnabled:subtitleWeb,modelId: model, targetLanguage: operation === 'translate' ? language : null, ...(saved ? { sourceVersionId: saved.id } : { binding: view.video!.binding!, sourceLanguage: native?.language }) });
    if (accepted) { setSettingsOpen(false); setTranslationOpen(false); }
    else pendingTranslation.current=null;
  }
  async function selectMain(value: string) {
    if (!view.workspaceId || !client.subtitles || !subtitles.view || selection.current.busy) return;
    selection.current.busy = true; const epoch = selection.current.epoch; setSelecting(true);
    const next = value.startsWith('saved:') ? value.slice(6) : nativeTrackId(value);
    const previous = selected;
    setSelected(next);
    setError(''); setNotice('');
    try {
      const source = value.startsWith('saved:') ? { kind: 'version' as const, versionId: value.slice(6) } : { kind: 'native' as const, language: value };
      const result = await client.subtitles({ type: 'subtitles.source.select', workspaceId: view.workspaceId, expectedRevision: subtitles.view.sourceRevision, source });
      if (selection.current.epoch === epoch) {
        subtitles.accept(result);
        if(translatedVersion&&next===translatedVersion.id) dismissTranslation();
      }
    } catch { if (selection.current.epoch === epoch) { setSelected(latestSubtitles.current ? sourceSelection(latestSubtitles.current.analysisSource) : previous); setError('主字幕已变化或不可用，请刷新后重新选择。'); } }
    finally { if (selection.current.epoch === epoch) { selection.current.busy = false; setSelecting(false); } }
  }
  const trackChoices = [...nativeTracks, ...savedTracks];
  const currentTrack = saved ? savedTracks.find(track => track.language === `saved:${saved.id}`) : native;
  useEffect(() => { onChromeChange?.({
    title: currentTrack ? `${currentTrack.label} · ${currentTrack.cues.length} 条` : '字幕轨道',
    status: selecting ? '正在切换字幕轨道' : currentTrack?.status === 'ready' ? '完整字幕已就绪' : '所选字幕暂不可用',
    items: trackChoices.map(track => ({ id: track.language, title: `${track.label}${track.status === 'ready' ? ` · ${track.cues.length} 条` : '（读取失败）'}`, disabled: selecting || !subtitles.view, select: () => void selectMain(track.language) })),
    actions: readonly ? [] : [{label:'刷新',iconOnly:true,tooltip:'重新读取字幕并回到当前播放位置',disabled:!refreshAction||refreshAction.disabled,run:()=>refreshAction?.run()},{ label: '字幕设置', active: settingsOpen, run: () => setSettingsOpen(value => !value) }]
  }); }, [onChromeChange, settingsOpen, selecting, readonly, selected, subtitles.view, view.video,refreshAction]);
  const exportDialog=exportOpen&&view.workspaceId?<DocumentExportDialog client={client} entities={[...getNativeTracks(view.video).filter(t=>t.status==='ready'&&t.cues.length).map(t=>({workspaceId:view.workspaceId!,entityType:'subtitle' as const,id:nativeTrackId(t.language),title:nativeTrackLabel(t)})),...versions.map(v=>({workspaceId:view.workspaceId!,entityType:'subtitle' as const,id:v.id,title:`${v.type==='translate'?'AI翻译':'AI字幕修正'} · ${v.language} · ${new Date(v.createdAt).toLocaleString()}`}))]} close={()=>setExportOpen(false)}/>:null;
  if (readonly) return <section className="native-subtitles" aria-label="已保存 AI 字幕"><h2>已保存 AI 字幕</h2><button onClick={()=>setExportOpen(true)}>导出字幕</button>{exportDialog}{saved ? <><p className="note-meta">只读 · {saved.type === 'translate' ? 'AI 翻译' : 'AI 字幕修正'} · {saved.language} · {new Date(saved.createdAt).toLocaleString()} · 时间对齐</p><SubtitleTimeline primary={saved.cues} bilingual={false} fontSize={16} follow={false} scrollRequest={0}/></> : <p>{!fixedId ? '请从资料库打开具体的已保存字幕版本。' : subtitles.error || '正在读取已保存版本…'}</p>}</section>;
  const displayLanguage = saved ? `saved:${saved.id}` : native?.language ?? selected;
  const displayVideo = { binding: view.video?.binding ?? null, status: saved ? 'ready' as const : view.video?.status ?? 'unsupported' as const, language: displayLanguage, cues: saved?.cues ?? native?.cues ?? [], tracks: [...nativeTracks, ...savedTracks], playback: view.video?.playback };
  const latestCorrection = [...versions].filter(version => version.type === 'enhance').sort((a, b) => b.createdAt - a.createdAt)[0];
  const correctionSource = latestCorrection ? sourceFor(latestCorrection, versions, nativeTracks) : undefined;
  const corrections = latestCorrection && correctionSource ? latestCorrection.cues.flatMap((cue, index) => correctionSource[index] && correctionSource[index].content !== cue.content ? [{ before: correctionSource[index].content, after: cue.content }] : []) : [];
  return <div className="ai-subtitle-workbench">{exportDialog}{!onChromeChange&&<button onClick={()=>setExportOpen(true)}>导出字幕</button>}
    {translationJob&&<SubtitleTranslationStatus key={`${translationJob.jobId}:${translationJob.attemptId}`} job={translationJob} version={translatedVersion} busy={generation.busy} selecting={selecting} command={generation.command} dismiss={dismissTranslation} viewTranslation={()=>{if(translatedVersion){setSettingsOpen(false);void selectMain(`saved:${translatedVersion.id}`);}}}/>}
    <NativeSubtitles selectedTrack={displayLanguage} trackBusy={selecting || !subtitles.view} onTrackChange={value=>void selectMain(value)} onRefreshAction={receiveRefresh} settingsOpen={onChromeChange ? settingsOpen : undefined} onSettingsClose={closeSettings} headingInHeader={!!onChromeChange} heading="字幕轨道" key={view.workspaceId} client={client} view={{ ...view, video: displayVideo }}>
    <section className="subtitle-ai-controls" aria-label="AI 字幕工具">
      {saved && <div className="subtitle-saved-actions"><a target="_blank" rel="noopener noreferrer" href={`reader.html?workspaceId=${encodeURIComponent(view.workspaceId ?? '')}&subtitleVersionId=${encodeURIComponent(saved.id)}`}>只读查看</a><DeleteButton client={client} target={{ workspaceId: saved.workspaceId, entityType: 'subtitle', id: saved.id }}/></div>}
      {!saved && !isNativeTrackId(selected) && <p>所选保存版已删除或不可用，请重新选择主字幕。</p>}
      {saved && view.video?.status !== 'ready' && <p>已保存字幕可独立查看；原生主轨不可用，需重新读取后才能显示原生双语。</p>}
      <label className="subtitle-web-option"><input type="checkbox" checked={subtitleWeb} disabled={!nativeDeepSeek(provider.view) && !subtitleWeb} onChange={event=>setSubtitleWeb(event.target.checked)}/>联网核对专有名词、人名和产品名称</label><div className="subtitle-ai-actions"><button aria-expanded={translationOpen} onClick={()=>setTranslationOpen(value=>!value)}>AI 翻译</button><button disabled={!ready || generation.busy} onClick={() => void send('enhance')}>AI 字幕修正</button></div>
      {translationOpen && <div className="subtitle-translation-options"><label>目标语言<select aria-label="翻译目标语言" value={language} onChange={e => setLanguage(e.target.value)}><option value="en">英语</option><option value="zh">中文</option><option value="ja">日语</option><option value="ko">韩语</option><option value="fr">法语</option><option value="de">德语</option></select></label><button disabled={!ready || generation.busy} onClick={() => void send('translate')}>开始翻译</button></div>}
      {!subtitleWebReady&&<p role="status">联网核对需要可用的 deepseek-flash 模型，请在 API 设置中刷新模型，或关闭联网核对后继续。</p>}
      {limitError && <p role="alert">{limitError}</p>}
      {latestCorrection && <div className="subtitle-correction-result" role="status"><strong>最近一次字幕修正已保存</strong><span>{correctionSource ? `共 ${corrections.length} 处替换` : '原字幕暂不可用，可将修正版设为主字幕查看'}</span>{correctionSource && <button onClick={()=>setDiffOpen(value=>!value)}>{diffOpen?'收起修正效果':'查看修正效果'}</button>}{diffOpen && <div className="subtitle-diff" aria-label="字幕修正效果">{corrections.length ? corrections.slice(0,100).map((item,index)=><p key={index}>“{item.before}”替换为“{item.after}”</p>) : <p>本次未发现需要替换的内容。</p>}</div>}</div>}
      {notice && <p className="subtitle-task-notice" role="status">{notice}</p>}
      {!!generation.view?.jobs.length && <details className="subtitle-task-history"><summary>字幕任务记录</summary><div className="subtitle-jobs" aria-label="字幕任务">{generation.view.jobs.map(job => <div className="task-status" key={job.jobId} data-subtitle-job-id={job.jobId}><span>{job.target.kind === 'subtitle' && job.target.operation === 'enhance' ? '字幕修正' : '翻译'} · {taskLabels[job.state]} · 覆盖 {job.coverage.covered}/{job.coverage.total}{job.error && ` · ${failureLabels[job.error]}`}</span><WebSources evidence={job.webEvidence}/><RequestInstructionButton client={client} jobId={job.jobId} target={{ workspaceId: job.target.workspaceId }}/>{terminal(job.state) ? job.state !== 'completed' && <button disabled={generation.busy} onClick={() => void generation.command({ type: 'generation.retry', jobId: job.jobId })}>重试原字幕请求</button> : <button disabled={generation.busy} onClick={() => void generation.command({ type: 'generation.stop', jobId: job.jobId })}>停止此字幕任务</button>}</div>)}</div></details>}
    </section>
    </NativeSubtitles>
      {(generation.error || subtitles.error || error) && <p role="alert">{generation.error || subtitles.error || error}</p>}
  </div>;
}

function sourceFor(version: SubtitleVersion, versions: readonly SubtitleVersion[], nativeTracks: readonly { language: string; cues: SubtitleVersion['cues'] }[]) {
  if ('subtitleVersionId' in version.source) {
    const sourceId = version.source.subtitleVersionId;
    return versions.find(item => item.id === sourceId)?.cues;
  }
  return nativeTracks.find(track => track.language === version.sourceLanguage)?.cues;
}
