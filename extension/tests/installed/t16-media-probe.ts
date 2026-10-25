import { decodedFrame } from '../../src/video/decoded-frame';
import { createOriginalMedia, grantKey } from '../../src/video/original-media';
import { inspectMedia } from '../../src/video/page';
import type { SourceBinding } from '../../src/contracts/generation';

const controller = new AbortController();
let media: Awaited<ReturnType<typeof createOriginalMedia>> | undefined;
// Isolated test entry, excluded from production and ordinary test builds.
Object.assign(window, {
  async acquireOriginal(tabId: number) {
    if (media) throw new Error('already-owned');
    const [observed] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: inspectMedia });
    if (observed?.result?.status !== 'supported' || !observed.documentId) throw new Error('source-not-ready');
    const binding: SourceBinding = { platform: 'bilibili', videoId: observed.result.source.videoId!, partId: observed.result.source.partId, tabId, documentId: observed.documentId, epoch: 1 };
    const jobId = crypto.randomUUID(), attemptId = crypto.randomUUID();
    const consent = await chrome.runtime.sendMessage({ type: 'media.probe-consent', jobId, attemptId, binding });
    if (!consent?.ok) throw new Error('consent');
    media = await createOriginalMedia(jobId, attemptId, binding, controller.signal);
    return { binding, duration: media.duration, initialization: media.initialization };
  },
  captureDiagnostics() { return media?.diagnostics; },
  async captureOriginal(time: number) { if (!media) throw new Error('not-ready'); return media.capture(time); },
  async releaseOriginal() { await media?.release(); media = undefined; }
});

// Trusted test-build control; media activation/return use production logic.
Object.assign(window, { prepareConsent(tabId: number) {
  document.body.replaceChildren();
  const explanation = document.createElement('p');
  explanation.textContent = '本请求只在原视频页短暂暂停并跳转取帧，完成后恢复；你主动操作后保留你的最新选择。';
  const confirm = document.createElement('button'); confirm.id = 'confirm'; confirm.textContent = '允许本请求当前页取帧';
  confirm.onclick = () => { confirm.disabled = true; const api = window as any; api.readyOutcome = null; void api.acquireOriginal(tabId).then((value: unknown) => api.readyOutcome = { ok: true, value }, (error: unknown) => api.readyOutcome = { ok: false, error: String(error) }); };
  const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.onclick = () => { confirm.disabled = true; };
  document.body.append(explanation, confirm, cancel);
} });

// Known H.264 colour sample: diagnostic only; never used as original-site proof.
Object.assign(window, {
  async prepareLocalMedia(dataUrl: string) {
    const video = document.createElement('video'); video.muted = true; video.src = dataUrl; document.body.append(video);
    await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('local-media')); });
    (window as any).__vcampMediaOwner = 'diagnostic-local';
  },
  async captureLocal(time: number) {
    const id = crypto.randomUUID(); document.addEventListener(id, event => event.preventDefault(), { once: true });
    const result = await decodedFrame('diagnostic-local', id, time);
    if (!result.ok) return result;
    const image = new Image(); image.src = result.frame.dataUrl; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    return { ...result, pixel: [...context.getImageData(0, 0, 1, 1).data] };
  }
});
