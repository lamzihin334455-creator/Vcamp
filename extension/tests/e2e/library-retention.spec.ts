import {expect, test} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setup} from './interaction-fixture';

test('production library excludes native-subtitle browsing and drafts, adds saved scribbles, and survives reload and trash restoration', async () => {
  test.setTimeout(60_000);
  const {context, page, site} = await setup();
  const output = resolve('../.tmp/library-retention');
  await mkdir(output, {recursive: true});
  const request = (operation: unknown) => page.evaluate(async op => chrome.runtime.sendMessage({version: 1, requestId: crypto.randomUUID(), operation: op}), operation);
  const videoIds = async () => (await request({type: 'library.query'})).view.library.videos.map((row: {videoId: string}) => row.videoId);
  try {
    expect(await videoIds()).toEqual(expect.arrayContaining(['BVexperience', 'BVotherVideo']));
    await site.goto('https://www.bilibili.com/video/BVbrowseOnly/?p=1');
    await expect.poll(async () => (await request({type: 'workspace.query'})).view.video?.binding?.videoId).toBe('BVbrowseOnly');
    await expect(page.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    const workspace = (await request({type: 'workspace.query'})).view;
    const draft = {...workspace.draft, text: '未发送草稿不会成为历史'};
    expect((await request({type: 'draft.save', target: {workspaceId: workspace.workspaceId, chatId: workspace.chatId}, expectedRevision: draft.revision, draft})).ok).toBe(true);
    expect(await videoIds()).not.toContain('BVbrowseOnly');
    await page.bringToFront();
    await page.getByRole('button', {name: '资料库', exact: true}).click();
    await expect(page.locator('.library-video-card')).toHaveCount(2);
    await page.screenshot({path: resolve(output, 'browsed-video-excluded.png')});
    const saved = await request({type: 'scribble.create', workspaceId: workspace.workspaceId, text: '这里保存了有用的随笔', time: null});
    expect(saved.ok).toBe(true);
    await expect(page.locator('.library-video-card')).toHaveCount(3);
    expect(await videoIds()).toContain('BVbrowseOnly');
    await page.reload();
    await page.getByRole('button', {name: '资料库', exact: true}).click();
    await expect(page.locator('.library-video-card')).toHaveCount(3);
    const notes = (await request({type: 'scribble.query', workspaceId: workspace.workspaceId})).view.scribbles.scribbles;
    const target = {workspaceId: workspace.workspaceId, entityType: 'scribble', id: notes[0].id};
    expect((await request({type: 'library.trash.move', target, expectedRevision: 0})).ok).toBe(true);
    await expect(page.locator('.library-video-card')).toHaveCount(2);
    expect((await request({type: 'library.trash.restore', target, expectedRevision: 1})).ok).toBe(true);
    await expect(page.locator('.library-video-card')).toHaveCount(3);
    const current = (await request({type: 'workspace.query', target: {workspaceId: workspace.workspaceId, chatId: workspace.chatId}})).view;
    expect(current.draft.text).toBe(draft.text);
    await page.screenshot({path: resolve(output, 'saved-video-retained.png')});
  } finally {
    await context.close();
  }
});
