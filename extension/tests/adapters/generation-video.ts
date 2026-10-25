import { ApplicationError } from '../../src/contracts/application';
import { sameBinding } from '../../src/contracts/video';
import type { PanelVideo } from '../../src/app/message-router';
import { getBinding } from './binding';
import type { VideoView } from '../../src/contracts/video';
export async function getGenerationVideo(): Promise<VideoView> {
  const source = await getBinding();
  const fixture = (await chrome.storage.local.get('vcamp.test.playback'))['vcamp.test.playback'] ?? { time: 12.5, duration: 20, paused: true };
  const status: VideoView['status'] = (await chrome.storage.local.get('vcamp.test.status'))['vcamp.test.status'] ?? 'ready';
  return { playback: fixture, binding: { platform: source.platform, videoId: source.videoId, partId: source.partId, tabId: 99, documentId: 't05-synthetic-document', epoch: 1 }, status, language: 'zh',
    cues: status !== 'ready' ? [] : [{ from: 0, to: 10, content: `${source.partId} 首条完整字幕` }, { from: 10, to: 20, content: `${source.partId} 尾条完整字幕` }] };
}

// Test build only: controlled VideoPort, production keeps createChromeVideo.
export const testPanelVideo: PanelVideo = {
  async current() { return { ...await getGenerationVideo(), source: await getBinding() }; },
  async retry() {},
  async seek(binding, time) {
    const video = await getGenerationVideo();
    if (!sameBinding(video.binding, binding)) throw new ApplicationError('stale-binding');
    await chrome.storage.local.set({ 'vcamp.test.playback': { ...video.playback, time }, 'vcamp.test.lastSeek': { binding, time, policy: 'preserve', paused: video.playback?.paused } });
  }
};
