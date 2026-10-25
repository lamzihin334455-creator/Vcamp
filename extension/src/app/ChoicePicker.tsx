import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';

export type PickerChoice = { value: string; label: string; detail?: string; badge?: string };

/** Shared compact selector. The portal keeps long lists out of the narrow settings menu. */
export function ChoicePicker({ label, popupLabel, placeholder, options, value, selectedLabel, disabled, matchWidth = false, onChange }: {
  label: string; popupLabel: string; placeholder: string; options: PickerChoice[]; value: string;
  selectedLabel?: string; disabled?: boolean; matchWidth?: boolean; onChange: (value: string) => void;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>({ left: 12, top: 12, width: 280, maxHeight: 320 });
  const current = options.find(option => option.value === value);
  const text = selectedLabel ?? current?.label ?? placeholder;
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  function dismiss(focus = false) { setOpen(false); if (focus) trigger.current?.focus(); }
  function show() {
    window.dispatchEvent(new CustomEvent('vcamp:choice-picker', { detail: id }));
    setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true);
  }
  function choose(option: PickerChoice) { dismiss(true); onChange(option.value); }
  useEffect(() => {
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) setOpen(false); };
    window.addEventListener('vcamp:choice-picker', other);
    return () => window.removeEventListener('vcamp:choice-picker', other);
  }, [id]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    function place() {
      const rect = trigger.current!.getBoundingClientRect(), margin = 12, gap = 8;
      const width = Math.min(matchWidth ? rect.width : 320, window.innerWidth - margin * 2);
      const above = rect.top - margin - gap, below = window.innerHeight - rect.bottom - margin - gap;
      // Prefer opening above the bottom-anchored settings menu, below a page field.
      const up = above > below;
      const maxHeight = Math.min(360, Math.max(0, up ? above : below));
      setPosition({ left: Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin)), ...(up ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }), width, maxHeight });
    }
    place(); list.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) dismiss(); };
    const scroll = (event: Event) => {
      if (popup.current?.contains(event.target as Node)) return;
      const rect = trigger.current!.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) dismiss(); else place();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', place); };
  }, [open, matchWidth]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, id]);
  return <>
    <button ref={trigger} type="button" className="choice-trigger" aria-label={label} title={text} data-value={value} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-popup` : undefined} disabled={disabled} onClick={() => open ? dismiss() : show()} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
    }}><span>{text}</span><ChevronDown aria-hidden="true"/></button>
    {open && createPortal(<div ref={popup} id={`${id}-popup`} className="choice-popup" data-settings-picker role="dialog" aria-label={popupLabel} style={position} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); }
      if (event.key === 'Tab') dismiss(true);
    }}>
      <div className="choice-heading"><strong>{popupLabel}</strong><span>{options.length} 项</span><button type="button" aria-label={`关闭${popupLabel}`} onClick={() => dismiss(true)}><X/></button></div>
      <div ref={list} id={`${id}-list`} className="choice-list" role="listbox" tabIndex={0} aria-label={popupLabel} aria-activedescendant={options.length ? `${id}-option-${activeIndex}` : undefined} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % Math.max(1, options.length)); }
        if (event.key === 'Home') { event.preventDefault(); setActive(0); }
        if (event.key === 'End') { event.preventDefault(); setActive(Math.max(0, options.length - 1)); }
        if ((event.key === 'Enter' || event.key === ' ') && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex]); }
      }}>{options.map((option, index) => <button key={option.value} id={`${id}-option-${index}`} type="button" role="option" tabIndex={-1} data-value={option.value} data-active={index === activeIndex} aria-selected={option.value === value} className="choice-option" title={[option.label, option.detail, option.badge].filter(Boolean).join(' · ')} onPointerMove={() => setActive(index)} onClick={() => choose(option)}>
        <span className="choice-option-copy"><span className="choice-option-label">{option.label}</span>{option.badge && <small className="choice-option-badge">{option.badge}</small>}{option.detail && <small className="choice-option-detail">{option.detail}</small>}</span><span className="choice-check">{option.value === value && <Check aria-hidden="true"/>}</span>
      </button>)}{!options.length && <p className="choice-empty" role="status">暂无可选项</p>}</div>
    </div>, document.body)}
  </>;
}
