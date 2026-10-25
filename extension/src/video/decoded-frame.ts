// Only called on a freshly created, muted, inactive host, never the source tab.
export async function decodedFrame(token: string, confirmation: string, time: number | null) {
  const scope = window as unknown as { __vcampMediaOwner?: string; __vcampMediaCancel?: () => void; __vcampCaptureId?: string; __vcampCaptureTrace?: unknown[]; __vcampCancelledCapture?: string };
  const started = performance.now(), trace: Record<string, unknown>[] = [];
  const mark = (stage: string, extra: Record<string, unknown> = {}) => { if (trace.length < 48) trace.push({ stage, ms: Math.round(performance.now() - started), target: time, currentTime: video?.currentTime, readyState: video?.readyState, networkState: video?.networkState, seeking: video?.seeking, paused: video?.paused, visibility: document.visibilityState, ...extra }); };
  if (scope.__vcampMediaOwner !== token) throw new Error('owner');
  const video = document.querySelector('video');
  if (!video || video.readyState < 2) throw new Error('decoder');
  if (scope.__vcampCancelledCapture === confirmation) throw new Error('cancelled');
  scope.__vcampCaptureId = confirmation; scope.__vcampCaptureTrace = trace;
  mark('injection-start');
  const source = video.currentSrc;
  let cancelled = false;
  const disposals = new Set<() => void>();
  scope.__vcampMediaCancel = () => { cancelled = true; for (const dispose of [...disposals]) dispose(); };
  const check = () => {
    if (cancelled || scope.__vcampMediaOwner !== token || document.querySelector('video') !== video || source !== video.currentSrc) throw new Error('media-changed');
  };
  const waitForSeek = (target: number) => new Promise<void>((resolve, reject) => {
    let finished = false, sawSeeking = false;
    const finish = (error?: string) => {
      if (finished) return; finished = true; clearTimeout(timer);
      video.removeEventListener('seeking', seeking); video.removeEventListener('seeked', seeked); video.removeEventListener('error', mediaError);
      disposals.delete(cancel);
      if (error) { mark(error); reject(new Error(error)); } else resolve();
    };
    const cancel = () => finish('capture-cancelled');
    const seeking = () => { sawSeeking = true; mark('seeking'); };
    const seeked = () => {
      mark('seeked');
      try { check(); } catch { finish('media-changed'); return; }
      if (!sawSeeking || video.seeking || !video.paused || video.readyState < 2 || Math.abs(video.currentTime - target) >= 0.01) finish('seek-unconfirmed');
      else finish();
    };
    const mediaError = () => { mark('media-error', { code: video.error?.code }); finish('media-error'); };
    const timer = setTimeout(() => finish('seek-timeout'), 9000); disposals.add(cancel);
    video.addEventListener('seeking', seeking); video.addEventListener('seeked', seeked); video.addEventListener('error', mediaError);
    try { check(); mark('seek-set'); video.currentTime = target; } catch { finish('seek-set-failed'); }
  });
  try {
    video.pause(); // owned media only; no wrappers or restore on the user's player
    if (time !== null) {
      if (!Number.isFinite(time) || time < 0 || time >= video.duration) throw new Error('time');
      // rVFC describes compositor presentation, which a hidden tab need not do.
      // Seek completion follows target decode (HTML seeking algorithm step 12).
      // Always issue a seek, including repeated times; do not trust a stale clock.
      let callback = 0;
      if (video.requestVideoFrameCallback) {
        callback = video.requestVideoFrameCallback((_, meta) => mark('frame-callback', { mediaTime: meta.mediaTime }));
        disposals.add(() => video.cancelVideoFrameCallback(callback));
      }
      await waitForSeek(time);
    }
    check();
    // MAIN identity proof is checked synchronously just before copying pixels.
    if (document.dispatchEvent(new Event(confirmation, { cancelable: true }))) throw new Error('identity');
    if (time !== null && (video.seeking || !video.paused || video.readyState < 2 || Math.abs(video.currentTime - time) >= 0.01)) throw new Error('seek-unconfirmed');
    mark('canvas-start');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
    canvas.width = Math.floor(video.videoWidth * scale); canvas.height = Math.floor(video.videoHeight * scale);
    if (!canvas.width || !canvas.height) throw new Error('empty');
    const context = canvas.getContext('2d')!; context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels.some((v, i) => i % 4 === 3 && v !== 0)) throw new Error('empty');
    check();
    const frame = { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, time: video.currentTime };
    mark('canvas-read'); return { ok: true as const, frame, trace };
  } catch (error) {
    const code = error instanceof Error && ['seek-timeout', 'capture-cancelled', 'seek-unconfirmed', 'seek-set-failed', 'media-error', 'media-changed', 'time', 'identity', 'empty'].includes(error.message) ? error.message : 'canvas-or-media-error';
    mark(code); return { ok: false as const, error: code, trace };
  } finally { for (const dispose of [...disposals]) dispose(); if (scope.__vcampCaptureId === confirmation) delete scope.__vcampMediaCancel; }
}

