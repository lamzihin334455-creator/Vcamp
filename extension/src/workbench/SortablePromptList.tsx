import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, GripVertical } from 'lucide-react';

export type PromptListItem = { id: string; name: string; detail?: string; description?: string; label?: string };
type Session = { id: string; pointerId: number | null; x: number; y: number; offsetY: number; left: number; width: number; height: number; index: number; active: boolean; timer: ReturnType<typeof setTimeout> };

export function SortablePromptList({ items, label, onOpen, onReorder }: { items: PromptListItem[]; label: string; onOpen(id: string): void; onReorder(ids: string[]): Promise<void> }) {
  const root = useRef<HTMLDivElement>(null), session = useRef<Session | null>(null);
  const latest = useRef({ items, onReorder }); latest.current = { items, onReorder };
  const [drag, setDrag] = useState<Session | null>(null), [pending, setPending] = useState<string[] | null>(null);
  const [error, setError] = useState(''), [announcement, setAnnouncement] = useState('');
  const suppressClick = useRef(false), saving = useRef(false), mounted = useRef(true);

  async function persist(ids: string[]) {
    if (saving.current) return;
    saving.current = true; setPending(ids); setError('');
    try { await latest.current.onReorder(ids); if (mounted.current) setAnnouncement('顺序已保存'); }
    catch { if (mounted.current) { setPending(null); setError('排序未保存，请重试。'); } }
    finally { saving.current = false; }
  }
  useEffect(() => {
    if (pending && pending.join('\0') === items.map(row => row.id).join('\0')) setPending(null);
  }, [items, pending]);

  function slotAt(y: number, id: string) {
    const rows = [...(root.current?.querySelectorAll<HTMLElement>('[data-prompt-id]') ?? [])].filter(row => row.dataset.promptId !== id);
    const index = rows.findIndex(row => { const rect = row.getBoundingClientRect(); return y < rect.top + rect.height / 2; });
    return index < 0 ? rows.length : index;
  }
  function start(id: string, x: number, y: number, pointerId: number | null) {
    if (session.current || saving.current) return;
    const row = [...(root.current?.querySelectorAll<HTMLElement>('[data-prompt-id]') ?? [])].find(row => row.dataset.promptId === id);
    if (!row) return;
    suppressClick.current = false;
    const rect = row.getBoundingClientRect();
    const next: Session = { id, pointerId, x, y, offsetY: y - rect.top, left: rect.left, width: rect.width, height: rect.height, index: latest.current.items.findIndex(row => row.id === id), active: false, timer: setTimeout(() => {
      if (session.current !== next) return;
      next.active = true; suppressClick.current = true; setDrag({ ...next });
      setAnnouncement(`正在移动${latest.current.items.find(row => row.id === id)?.name}，按 Escape 取消`);
      // Keep mouse/pen movement tracked even when leaving the narrow panel list.
      if (pointerId !== null) { try { root.current?.setPointerCapture(pointerId); } catch { /* pointer already released */ } }
    }, 360) };
    session.current = next;
  }
  function move(x: number, y: number) {
    const current = session.current; if (!current) return;
    if (!current.active) {
      if (Math.hypot(x - current.x, y - current.y) > 8) { clearTimeout(current.timer); session.current = null; }
      return;
    }
    current.x = x; current.y = y; current.index = slotAt(y, current.id); setDrag({ ...current });
  }
  function finish(cancelled = false) {
    const current = session.current; if (!current) return;
    clearTimeout(current.timer); session.current = null; setDrag(null);
    if (current.pointerId !== null) { try { root.current?.releasePointerCapture(current.pointerId); } catch { /* capture already lost */ } }
    if (!current.active) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 500);
    if (cancelled) { setAnnouncement('已取消排序'); return; }
    const ids = latest.current.items.map(row => row.id), originalIndex = ids.indexOf(current.id);
    if (originalIndex < 0) return;
    ids.splice(originalIndex, 1); ids.splice(current.index, 0, current.id);
    if (current.index !== originalIndex) void persist(ids);
  }
  useEffect(() => {
    mounted.current = true;
    const pointerMove = (event: PointerEvent) => { if (session.current?.pointerId === event.pointerId) move(event.clientX, event.clientY); };
    const pointerUp = (event: PointerEvent) => { if (session.current?.pointerId === event.pointerId) finish(); };
    const pointerCancel = (event: PointerEvent) => { if (session.current?.pointerId === event.pointerId) finish(true); };
    // A passive start preserves normal touch scrolling; prevent only an activated hold.
    const touchMove = (event: TouchEvent) => {
      if (!session.current || session.current.pointerId !== null) return;
      if (event.touches.length !== 1) return finish(true);
      if (session.current.active) event.preventDefault();
      move(event.touches[0].clientX, event.touches[0].clientY);
    };
    const touchEnd = () => { if (session.current?.pointerId === null) finish(); };
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && session.current?.active) { event.preventDefault(); finish(true); } };
    window.addEventListener('pointermove', pointerMove); window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('touchmove', touchMove, { passive: false }); window.addEventListener('touchend', touchEnd); window.addEventListener('touchcancel', cancel);
    window.addEventListener('blur', cancel); window.addEventListener('keydown', key);
    return () => {
      mounted.current = false; if (session.current) clearTimeout(session.current.timer); session.current = null;
      window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('touchmove', touchMove); window.removeEventListener('touchend', touchEnd); window.removeEventListener('touchcancel', cancel);
      window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key);
    };
  }, []);
  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    const scroll = () => {
      const current = session.current;
      if (current?.active) {
        const container = root.current?.closest<HTMLElement>('.settings-page');
        if (container) {
          const rect = container.getBoundingClientRect(), edge = 40;
          const speed = current.y < rect.top + edge ? -8 : current.y > rect.bottom - edge ? 8 : 0;
          if (speed) { container.scrollTop += speed; current.index = slotAt(current.y, current.id); setDrag({ ...current }); }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [!!drag]);

  function keyboardMove(event: React.KeyboardEvent, id: string) {
    if (!event.altKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || saving.current || session.current) return;
    event.preventDefault();
    const ids = items.map(row => row.id), from = ids.indexOf(id);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, from + (event.key === 'ArrowUp' ? -1 : 1)));
    if (from === to) return;
    ids.splice(from, 1); ids.splice(to, 0, id); void persist(ids);
  }
  const ordered = pending ? [...items].sort((a, b) => { const rank = (id: string) => { const index = pending.indexOf(id); return index < 0 ? pending.length : index; }; return rank(a.id) - rank(b.id); }) : items;
  const remaining = ordered.filter(row => row.id !== drag?.id), before = drag ? remaining[drag.index]?.id : undefined;
  const moving = items.find(row => row.id === drag?.id);
  function content(row: PromptListItem) {
    return <><strong className="prompt-row-name">{row.name}</strong>{row.detail && <span className="prompt-row-detail">{row.detail}</span>}<ChevronRight className="prompt-row-chevron" aria-hidden="true"/></>;
  }
  return <>
    <div ref={root} className="prompt-sortable-list" role="list" aria-label={label} aria-busy={pending !== null && saving.current} data-dragging={!!drag} onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      {ordered.map(row => <div key={row.id} role="listitem" data-prompt-id={row.id} className="prompt-row" data-lifted={drag?.id === row.id} data-insert-before={before === row.id} onPointerDown={event => { if (event.pointerType !== 'touch' && event.button === 0) start(row.id, event.clientX, event.clientY, event.pointerId); }} onTouchStart={event => { if (event.touches.length === 1) start(row.id, event.touches[0].clientX, event.touches[0].clientY, null); }} onContextMenu={event => { if (session.current) event.preventDefault(); }}>
        <button className="prompt-row-grip" type="button" aria-label={`调整${row.name}顺序`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+Home Alt+End" title="长按拖动；Alt + ↑↓ 调整顺序" onKeyDown={event => keyboardMove(event, row.id)} disabled={saving.current}><GripVertical aria-hidden="true"/></button>
        <button className="prompt-row-open" type="button" aria-label={row.label ?? row.name} title={row.description || row.name} onClick={() => onOpen(row.id)}>{content(row)}</button>
      </div>)}
      {drag && !before && <div className="prompt-insert-end" aria-hidden="true"/>}
    </div>
    {!items.length && <p className="prompt-empty">暂无{label}，点击右上角新建。</p>}
    {error && <p className="prompt-sort-error" role="alert">{error}</p>}<span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    {drag && moving && createPortal(<div className="prompt-row prompt-drag-preview" aria-hidden="true" style={{ left: drag.left, top: drag.y - drag.offsetY, width: drag.width, height: drag.height }}><span className="prompt-row-grip"><GripVertical/></span><span className="prompt-row-open">{content(moving)}</span></div>, document.body)}
  </>;
}
