import { useCallback, useEffect, useId, useRef, useState } from 'react';

export type RegisterPromptLeaveGuard = (guard: (() => Promise<boolean>) | null) => void;

/** Keep unfinished settings edits when changing lists, pages, or modules. */
export function usePromptLeaveGuard(dirty: boolean, busy: boolean, register?: RegisterPromptLeaveGuard) {
  const [pending, setPending] = useState(false);
  const resolver = useRef<((allowed: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const requestLeave = useCallback(async () => {
    if (busy || resolver.current) return false;
    if (!dirty) return true;
    return new Promise<boolean>(resolve => { resolver.current = resolve; setPending(true); });
  }, [dirty, busy]);
  useEffect(() => { register?.(requestLeave); return () => register?.(null); }, [register, requestLeave]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);
  useEffect(() => { if (pending) dialog.current?.showModal(); }, [pending]);
  useEffect(() => () => { resolver.current?.(false); resolver.current = null; }, []);
  function resolve(allowed: boolean) {
    dialog.current?.close(); resolver.current?.(allowed); resolver.current = null; setPending(false);
  }
  return { requestLeave, leaveDialog: pending ? <dialog ref={dialog} aria-labelledby={headingId} onCancel={event => { event.preventDefault(); resolve(false); }}>
    <h2 id={headingId}>修改尚未保存</h2><p>继续编辑以保存修改，或放弃本次修改后离开。</p>
    <button type="button" autoFocus onClick={() => resolve(false)}>继续编辑</button>
    <button type="button" onClick={() => resolve(true)}>放弃修改并离开</button>
  </dialog> : null };
}
