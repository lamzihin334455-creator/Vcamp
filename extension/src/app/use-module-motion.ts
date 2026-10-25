import { useLayoutEffect, useRef, useState } from 'react';
import type { ModuleId } from './modules';

// Own only the current module's visual transition. New navigation cancels both
// pending completion and the rendered effect; persistence remains with the caller.
export function useModuleMotion(flush: () => Promise<boolean>, initial: ModuleId = 'chat') {
  const element = useRef<HTMLElement>(null);
  const animation = useRef<Animation | null>(null);
  const navigation = useRef(0);
  const [visible, setVisible] = useState({ id: initial, sequence: 0 });
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  useLayoutEffect(() => () => {
    navigation.current++;
    animation.current?.cancel();
  }, []);

  useLayoutEffect(() => {
    if (!element.current || reduced()) return;
    const enter = element.current.animate([
      { opacity: 0, transform: 'translateY(9px)', filter: 'blur(1.8px)' },
      { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' }
    ], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
    animation.current = enter;
    void enter.finished.then(() => {
      if (animation.current === enter) { animation.current = null; enter.cancel(); }
    }, () => { /* superseded or unmounted */ });
    return () => enter.cancel();
  }, [visible]);

  async function navigate(id: ModuleId) {
    const token = ++navigation.current;
    animation.current?.cancel();
    animation.current = null;
    if (!await flush() || token !== navigation.current || !element.current) return;
    if (!reduced()) {
      const exit = element.current.animate([
        { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
        { opacity: 0, transform: 'translateY(-5px)', filter: 'blur(1.4px)' }
      ], { duration: 115, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      animation.current = exit;
      try { await exit.finished; } catch { return; }
      if (token !== navigation.current) return;
      exit.cancel(); animation.current = null;
    }
    setVisible({ id, sequence: token });
  }
  return { element, active: visible.id, navigate };
}
