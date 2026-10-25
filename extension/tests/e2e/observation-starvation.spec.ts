import {expect, test} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setup} from './interaction-fixture';

test('panel connection, retry and six video changes finish while playback notifications keep arriving', async () => {
  test.setTimeout(45_000);
  const {context, page, site} = await setup();
  const output = resolve(process.env.OBSERVATION_EVIDENCE ?? '../.tmp/observation-starvation-fixed');
  await mkdir(output, {recursive: true});
  const results: unknown[] = [];
  // Drive the real content-script -> Worker notification path. One notification
  // arrives during every player identity inspection, without pausing the flood
  // to let a query pass. Product bundles and Chrome APIs remain unmodified.
  const flood = () => {
    const win = window as any, player = win.player, original = player.getVideoMessage;
    win.__observationProbes = 0;
    player.getVideoMessage = () => {
      win.__observationProbes++;
      document.querySelector('video')?.dispatchEvent(new Event('play'));
      return original();
    };
    win.__stopObservationFlood = () => {player.getVideoMessage = original;};
  };
  const request = (operation: unknown) => page.evaluate(async op => Promise.race([
    chrome.runtime.sendMessage({version: 1, requestId: crypto.randomUUID(), operation: op}),
    new Promise(resolve => setTimeout(() => resolve({timedOut: true}), 1500))
  ]), operation) as Promise<any>;
  try {
    await site.evaluate(flood);
    await page.reload();
    const connected = await request({type: 'workspace.query'});
    results.push({stage: 'connect', ...connected, probes: await site.evaluate(() => (window as any).__observationProbes)});
    await page.screenshot({path: resolve(output, 'connection-under-playback.png')});
    expect(connected, 'The panel must receive a binding while notifications are still arriving').toMatchObject({ok: true, view: {video: {binding: {videoId: 'BVexperience'}}}});
    const binding = connected.view.video.binding;
    expect(await request({type: 'video.retry', binding}), 'Manual retry must not wait for playback to stop').toMatchObject({ok: true});
    for (let index = 1; index <= 6; index++) {
      await site.evaluate(() => (window as any).__stopObservationFlood());
      const videoId = `BVreconnect${index}`;
      await site.goto(`https://www.bilibili.com/video/${videoId}/?p=1`);
      await site.evaluate(flood);
      const response = await request({type: 'workspace.query'});
      results.push({stage: videoId, ...response, probes: await site.evaluate(() => (window as any).__observationProbes)});
      expect(response).toMatchObject({ok: true, view: {video: {binding: {videoId}}}});
      await expect.poll(async () => (await request({type: 'workspace.query'})).view?.video?.status).toBe('ready');
    }
    await page.getByRole('navigation').getByRole('button', {name: '字幕', exact: true}).click();
    await expect(page.locator('.subtitle-row').first()).toBeVisible();
    await page.screenshot({path: resolve(output, 'subtitles-under-playback.png')});
  } finally {
    await writeFile(resolve(output, 'result.json'), JSON.stringify(results, null, 2));
    await site.evaluate(() => (window as any).__stopObservationFlood?.()).catch(() => {});
    await context.close();
  }
});
