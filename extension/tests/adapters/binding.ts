import type { VideoKey } from '../../src/contracts/application';
// Only included by the explicit test-extension build; no messages/data are seeded.
export const getBinding = async (): Promise<VideoKey> => (await chrome.storage.local.get('vcamp.test.video'))['vcamp.test.video'] ?? ({ platform: 'bilibili', videoId: 'T01-fixture-video', partId: 'T01-fixture-part', title: 'T01 测试视频 · 一个用于检查长标题截断的独立分 P' });
