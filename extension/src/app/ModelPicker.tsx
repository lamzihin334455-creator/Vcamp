import { useEffect, useRef, useState } from 'react';
import type { ProviderView } from '../contracts/provider';
import { Icon } from './Icons';
import { SoftText, PickerPopover, focusPicker } from './PickerMotion';
export function ModelPicker({ provider, selected, disabled, select, configure, mode, opening, otherOpen, scope }: { scope: string; mode: string; opening: () => void; otherOpen: boolean; provider?: ProviderView; selected?: string | null; disabled: boolean; select: (id: string) => void; configure: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => { if (otherOpen || disabled) setOpen(false); }, [otherOpen, disabled]);
  useEffect(() => { setOpen(false); }, [scope]);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = root.current?.animate?.([{opacity:.62,transform:'translateY(3px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:210,easing:'cubic-bezier(.16,1,.3,1)'});
    return () => animation?.cancel();
  }, [mode]);
  const label = provider?.models.find(m => m.id === selected)?.name ?? selected ?? '选择模型';
  return <div className="model-control" data-mode={mode} ref={root} onKeyDown={e => { if (open && focusPicker(root.current, e.key)) e.preventDefault(); if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } }}>
    <button className="model-pill" ref={button} aria-label={`当前模型：${label}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => { opening(); setOpen(!open); }}><SoftText text={label}/><Icon name="chevron"/></button>
    <PickerPopover open={open} className="model-menu" label="模型选择"><p>当前模型</p>{provider?.models.map(model => <button key={model.id} role="menuitemradio" aria-checked={selected === model.id} disabled={model.text === 'unsupported'} onClick={() => { select(model.id); setOpen(false); button.current?.focus(); }}><span>{model.name}<small>文字 {model.text === 'declared' ? '支持' : model.text === 'unsupported' ? '不支持' : '待确认'} · 视觉 {model.vision === 'declared' ? '支持' : model.vision === 'unsupported' ? '不支持' : '待确认'}</small></span></button>)}{!provider?.hasKey && <p>缺少 API Key，选择仅保留在草稿中</p>}<button role="menuitem" onClick={() => { setOpen(false); configure(); }}>管理 API 与模型</button></PickerPopover>
  </div>;
}
