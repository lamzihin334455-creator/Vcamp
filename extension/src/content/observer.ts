// Isolated world only. No page message bridge, credentials, application DTOs or writes.
const state = globalThis as typeof globalThis & { __vcampObserver?: boolean };
if (!state.__vcampObserver) {
  state.__vcampObserver = true;
  const notify = () => { void chrome.runtime.sendMessage({ type: 'video.observe' }).catch(() => {}); };
  let lastPlayback = 0;
  const playback = (event: Event) => {
    if (!(event.target instanceof HTMLVideoElement)) return;
    const now = performance.now();
    if (event.type === 'timeupdate' && now - lastPlayback < 250) return;
    lastPlayback = now;
    void chrome.runtime.sendMessage({ type: 'video.playback' }).catch(() => {});
  };
  for (const event of ['timeupdate', 'play', 'pause', 'seeked', 'loadedmetadata']) document.addEventListener(event, playback, true);
  notify();
  let timer = setInterval(notify, 1000);
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.addEventListener('pageshow', () => { clearInterval(timer); timer = setInterval(notify, 1000); notify(); });
}
