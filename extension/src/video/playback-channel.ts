import { bindingSchema } from '../contracts/video';
import type { SourceBinding } from '../contracts/generation';
import type { Playback } from '../contracts/video';
import { ApplicationError } from '../contracts/application';

// Native event messages are hints only. Values always come from the bound VideoPort.
export function createPlaybackChannel(read: (binding: SourceBinding) => Promise<Playback>) {
  const clients = new Map<chrome.runtime.Port, { binding: SourceBinding; pending: boolean; dirty: boolean; retries: number; timer?: ReturnType<typeof setTimeout> }>();
  const remove = (port: chrome.runtime.Port) => { clearTimeout(clients.get(port)?.timer); clients.delete(port); };
  async function update(port: chrome.runtime.Port) {
    const entry = clients.get(port);
    if (!entry) return;
    if (entry.pending) { entry.dirty = true; return; }
    clearTimeout(entry.timer); entry.timer = undefined;
    entry.pending = true;
    let playback: Playback | null = null;
    let stale = false;
    try { playback = await read(entry.binding); } catch (error) { stale = error instanceof ApplicationError && error.code === 'stale-binding'; }
    if (clients.get(port) !== entry) return;
    entry.pending = false;
    try { port.postMessage({ binding: entry.binding, playback }); } catch { remove(port); return; }
    if (entry.dirty) { entry.dirty = false; void update(port); }
    else if (!playback && !stale) {
      // A paused decoder may emit no more events after a transient read error.
      entry.timer = setTimeout(() => void update(port), [1000, 2000, 5000][Math.min(entry.retries++, 2)]);
    } else entry.retries = 0;
  }
  return {
    connect(port: chrome.runtime.Port) {
      port.onMessage.addListener(message => {
        const parsed = bindingSchema.safeParse(message?.binding);
        if (!parsed.success) return port.disconnect();
        remove(port);
        clients.set(port, { binding: parsed.data, pending: false, dirty: false, retries: 0 }); void update(port);
      });
      port.onDisconnect.addListener(() => remove(port));
    },
    notify(tabId: number, documentId: string) {
      for (const [port, entry] of clients) if (entry.binding.tabId === tabId && entry.binding.documentId === documentId) void update(port);
    }
  };
}
