// Installed only for a library-controlled open. It does not grant reader pages
// media access. Pause on site play attempts while identity and native seek settle.
export function pauseLibraryMedia() {
  const state = window as unknown as { __vcampLibraryPause?: () => void };
  if (state.__vcampLibraryPause) return;
  const pause = () => { document.querySelectorAll('video').forEach(video => video.pause()); };
  const observer = new MutationObserver(pause);
  document.addEventListener('play', pause, true);
  observer.observe(document, { childList: true, subtree: true }); pause();
  const dispose = () => { observer.disconnect(); document.removeEventListener('play', pause, true); delete state.__vcampLibraryPause; };
  state.__vcampLibraryPause = dispose;
  window.addEventListener('pagehide', dispose, { once: true });
  setTimeout(dispose, 30000);
}
