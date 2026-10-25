import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Reference's 105ms lift-out / 185ms rise-in, with cancellation on fast swaps. */
export function SoftText({ text }: { text: string }) {
  const [shown, setShown] = useState(text), node = useRef<HTMLSpanElement>(null), first = useRef(true);
  useLayoutEffect(() => {
    const element = node.current;
    if (first.current) { first.current = false; return; }
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches || !element.animate) { setShown(text); return; }
    let alive = true, enter: Animation | undefined;
    const out = element.animate([{opacity:1,transform:'translateY(0)',filter:'blur(0)'},{opacity:0,transform:'translateY(-6px)',filter:'blur(1.6px)'}], {duration:105,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});
    void out.finished.then(() => {
      if (!alive) return;
      setShown(text); out.cancel();
      enter = element.animate([{opacity:0,transform:'translateY(7px)',filter:'blur(1.8px)'},{opacity:1,transform:'translateY(0)',filter:'blur(0)'}],{duration:185,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'});
    }).catch(() => {});
    return () => { alive = false; out.cancel(); enter?.cancel(); };
  }, [text]);
  return <span className="soft-text" ref={node} aria-hidden="true">{shown}</span>;
}

/** Keep only the exit surface briefly; closed menus immediately become inert. */
export function PickerPopover({ open, className, children, label, role = 'menu', id }: { open: boolean; className: string; children: ReactNode; label: string; role?: string; id?: string }) {
  const [present, setPresent] = useState(open);
  const lastOpenChildren = useRef(children);
  if (open) lastOpenChildren.current = children;
  useEffect(() => {
    if (open) { setPresent(true); return; }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setPresent(false); return; }
    const timer = setTimeout(() => setPresent(false), 110);
    return () => clearTimeout(timer);
  }, [open]);
  return present || open ? <div id={id} className={`${className} picker-popover`} data-closing={!open} inert={!open} aria-hidden={!open} role={role} aria-label={label}>{open ? children : lastOpenChildren.current}</div> : null;
}

export function focusPicker(root: HTMLElement | null, key: string) {
  if (!['ArrowDown','ArrowUp','Home','End'].includes(key) || !root) return false;
  const items = [...root.querySelectorAll<HTMLButtonElement>('[role="menu"] button:not(:disabled)')].filter(item=>!item.closest('[inert]'));
  if (!items.length) return false;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const index = key === 'Home' ? 0 : key === 'End' ? items.length - 1 : (current + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[index].focus(); return true;
}
