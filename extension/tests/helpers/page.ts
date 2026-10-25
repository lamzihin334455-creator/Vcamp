import type { SourceBinding } from '../../src/contracts/generation';
import { inspectMedia } from '../../src/video/page';
import { guardMedia } from '../../src/video/seek-guard';

// Direct page fixtures exercise the same preparation and isolated commit. The
// full capability chain is exercised separately through the public router.
export async function seekMedia(binding: SourceBinding, time: number) {
  const win = window as unknown as { navigation?: EventTarget; addEventListener?: unknown };
  if (!win.navigation) win.navigation = new EventTarget();
  if (!win.addEventListener) { const events = new EventTarget(); window.addEventListener = events.addEventListener.bind(events); }
  if (!document.dispatchEvent) {
    const events = new EventTarget();
    Object.assign(document, { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) });
  }
  const token = crypto.randomUUID(), guard = await guardMedia('observe');
  const armed = await guardMedia('prepare', guard.revision, token);
  if (armed.code) return armed;
  const proof = await inspectMedia(binding, token);
  if (proof.status !== 'supported') return { code: 'stale-binding' };
  const result = await guardMedia('commit', guard.revision, token, time);
  if ((await inspectMedia(binding)).status !== 'supported') return { code: 'stale-binding' };
  return result;
}
