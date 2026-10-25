import { useEffect, useMemo, useRef } from 'react';
import type { Cue, Playback } from '../contracts/video';

export function alignSubtitles(primary: readonly Cue[], auxiliary: readonly Cue[]) {
  let start = 0;
  return primary.map(cue => {
    while (start < auxiliary.length && auxiliary[start].to <= cue.from) start++;
    const matches: Cue[] = [];
    for (let i = start; i < auxiliary.length && auxiliary[i].from < cue.to; i++) if (auxiliary[i].to > cue.from) matches.push(auxiliary[i]);
    return matches;
  });
}
export {formatTime} from '../shared/time';
import {formatTime} from '../shared/time';

// Data-only reusable view: saved versions can use it without any live subscription.
export function SubtitleTimeline({ primary, auxiliary, bilingual, fontSize, auxiliaryFontSize=14, playback, follow, scrollRequest, onUserScroll, onSeek }: {
  primary: readonly Cue[]; auxiliary?: readonly Cue[]; bilingual: boolean; fontSize: number;auxiliaryFontSize?:number;
  playback?: Playback | null; follow: boolean; scrollRequest: number;
  onUserScroll?: () => void; onSeek?: (time: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => alignSubtitles(primary, auxiliary ?? []), [primary, auxiliary]);
  let low = 0, high = primary.length;
  while (low < high) { const mid = (low + high) >>> 1; if (primary[mid].from <= (playback?.time ?? -1)) low = mid + 1; else high = mid; }
  const nearest = Math.max(0, low - 1), active = playback && low > 0 && primary[nearest].to > playback.time ? nearest : -1;
  useEffect(() => {
    if (!follow || !playback || !container.current) return;
    const element = container.current;
    const scroll = () => {
      const row = element.children[active < 0 ? nearest : active] as HTMLElement | undefined;
      if (row) element.scrollTo({ top: row.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop - element.clientHeight / 3, behavior: 'instant' });
    };
    scroll();
    const observer = new ResizeObserver(scroll); observer.observe(element);
    return () => observer.disconnect();
  }, [active, nearest, follow, scrollRequest, primary, fontSize, auxiliaryFontSize, bilingual, auxiliary]);
  return <div ref={container} className="subtitle-list" aria-label="字幕时间轴" tabIndex={0} style={{ fontSize }}
    onWheel={onUserScroll} onTouchMove={onUserScroll}
    onPointerDown={() => onUserScroll?.()}
    onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) onUserScroll?.(); }}>
    {primary.map((cue, i) => {
      const Row = onSeek ? 'button' : 'div';
      return <Row type={onSeek ? 'button' : undefined} onClick={onSeek ? () => onSeek(cue.from) : undefined} aria-label={onSeek ? `跳转到 ${formatTime(cue.from)}` : undefined} className={`subtitle-row${i === active ? ' current' : ''}`} aria-current={i === active ? 'true' : undefined} key={`${i}-${cue.from}`}>
        <span className="subtitle-time">{formatTime(cue.from)}</span>
        <span className="subtitle-text"><span>{cue.content}</span>{bilingual && <span style={{fontSize:auxiliaryFontSize}} className={`subtitle-secondary${rows[i].length ? '' : ' unmatched'}`}>{rows[i].length ? rows[i].map(cue => cue.content).join('\n') : '此时间段无匹配辅助字幕'}</span>}</span>
      </Row>;
    })}
  </div>;
}
