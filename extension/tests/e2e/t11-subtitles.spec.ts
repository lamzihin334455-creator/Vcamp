import { chromium, expect, test } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('T11: installed bilingual timeline, font, event follow, manual pause, preserve seek and refresh/part ownership at 360px', async () => {
  test.setTimeout(90000);
  const output = resolve('../.tmp/t11-installed'); await mkdir(output, { recursive: true });
  const bundle = await mkdtemp(resolve(output, 'package-')); await cp(process.env.EXPERIENCE_BUNDLE ?? resolve('dist'), bundle, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(bundle, 'manifest.json'), 'utf8'));
  if(manifest.optional_host_permissions){manifest.host_permissions = manifest.optional_host_permissions;delete manifest.optional_host_permissions;}
  await writeFile(resolve(bundle, 'manifest.json'), JSON.stringify(manifest));
  const media = (await readFile(resolve('tests/fixtures/t02-synthetic.mp4'))).toString('base64');
  const context = await chromium.launchPersistentContext(await mkdtemp(resolve(output, 'profile-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`], viewport: { width: 360, height: 800 } });
  let removeEnglish = false, pass = false;
  const evidence: unknown[] = [];
  try {
    await context.route('https://www.bilibili.com/video/**', route => {
      const cid = new URL(route.request().url()).searchParams.get('p') === '3' ? 30 : 20;
      const source = `https://upos-synthetic.bilivideo.com/media/opaque-${cid}.m4s`;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><video muted playsinline></video><script>
        window.__playinfo__=${JSON.stringify({ code: 0, data: { dash: { video: [{ baseUrl: source }] } } })};</script><script>
        window.__INITIAL_STATE__={videoData:{bvid:'BVfixture',title:'T11 合成双语演示',pages:[{page:2,cid:20,part:'P2'},{page:3,cid:30,part:'P3'}]}};
        window.player={getManifest:()=>({bvid:'BVfixture',cid:${cid}}),getMediaInfo:()=>({playUrl:'${source}'}),mediaElement:()=>document.querySelector('video')};
        document.querySelector('video').src='data:video/mp4;base64,${media}';fetch('https://api.bilibili.com/x/player/wbi/v2?cid=${cid}');
      </script>` });
    });
    await context.route('https://api.bilibili.com/**', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: 0, data: { subtitle: { subtitles: (removeEnglish ? ['zh-CN', 'ja'] : ['zh-CN', 'en', 'ja']).map(lan => ({ lan, lan_doc: { 'zh-CN': '中文', en: 'English', ja: '日本語' }[lan], subtitle_url: `https://aisubtitle.hdslb.com/${lan}.json` })) } } }) }));
    await context.route('https://aisubtitle.hdslb.com/**', route => {
      const language = new URL(route.request().url()).pathname;
      const body = language === '/en.json' ? Array.from({ length: 20 }, (_, i) => ({ from: i * .4 + .03, to: i * .4 + .2, content: `English interval ${i + 1}` })) : Array.from({ length: 80 }, (_, i) => ({ from: i * .1, to: (i + 1) * .1, content: `合成字幕第 ${i + 1} 行：每个语言依照时间区间匹配。` }));
      return route.fulfill({ status: language === '/ja.json' ? 403 : 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ body }) });
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const site = await context.newPage(); await site.goto('https://www.bilibili.com/video/BVfixture/?p=2');
    const query = () => panel.evaluate(async () => (await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), windowId: (await chrome.windows.getCurrent()).id, operation: { type: 'workspace.query' } })).view);
    await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪', { timeout: 20000 });
    const initial = await query();
    await panel.getByRole('textbox', { name: '输入草稿' }).fill('T11 保留的草稿'); await expect(panel.getByRole('status')).toHaveText('草稿已保存');
    await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    await expect(panel.locator('.titlebar').getByRole('button',{name:'导出',exact:true})).toHaveCount(0);
    await expect(panel.getByRole('button',{name:'切换字幕轨道'})).toContainText('80 条');
    await panel.getByRole('button',{name:'字幕设置',exact:true}).click();
    await expect(panel.getByRole('dialog',{name:'字幕设置'})).toBeVisible();
    await panel.getByLabel('双语显示').check(); await panel.getByLabel('辅助语言').selectOption('en');
    await expect(panel.locator('.subtitle-secondary').first()).toHaveText('English interval 1');
    await expect(panel.locator('.subtitle-secondary.unmatched').first()).toHaveText('此时间段无匹配辅助字幕');
    await panel.getByLabel('主字幕', { exact: true }).selectOption('en');
    await panel.getByLabel('辅助语言').selectOption('zh-CN');
    expect((await query()).video.cues).toEqual(initial.video.cues);
    await panel.getByLabel('主字幕', { exact: true }).selectOption('zh-CN');
    await panel.getByLabel('辅助语言').selectOption('ja'); await expect(panel.getByRole('alert')).toContainText('此轨道被字幕服务拒绝');
    await panel.getByLabel('辅助语言').selectOption('en');
    await panel.getByLabel('主字幕字号',{exact:true}).fill('20');
    const timeline = panel.getByLabel('字幕时间轴'); await expect(timeline).toHaveCSS('font-size', '20px');
    const listBox = await timeline.boundingBox();
    await panel.getByRole('button',{name:'字幕设置',exact:true}).click();
    expect(await timeline.boundingBox()).toEqual(listBox);
    expect(await timeline.evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight>100)).toBe(true);
    const setTime = (time: number, paused: boolean) => site.evaluate(async ({ time, paused }) => { const video = document.querySelector('video')!; video.currentTime = time; if (paused) video.pause(); else await video.play(); }, { time, paused });
    await setTime(4, true); await expect(panel.locator('.subtitle-position')).toContainText('暂停 · 00:04');
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
    const currentVisible = () => timeline.evaluate(el => { const row = el.querySelector('.current')!.getBoundingClientRect(), box = el.getBoundingClientRect(); return row.top >= box.top && row.top < box.bottom; });
    expect(await currentVisible()).toBe(true);
    await timeline.hover(); await panel.mouse.wheel(0, -250); await expect(panel.locator('.subtitle-position')).toContainText('已暂停跟随');
    // Wait for the user wheel animation itself before measuring viewport retention.
    await panel.waitForTimeout(250); const manualTop = await timeline.evaluate(el => el.scrollTop);
    await setTime(6, true); await expect(panel.locator('.subtitle-position')).toContainText('00:06');
    expect(await timeline.evaluate(el => el.scrollTop)).toBe(manualTop);
    const refreshAndFollow = async () => {
      await panel.locator('.titlebar').getByRole('button',{name:'刷新',exact:true}).click();
      await expect(panel.locator('.titlebar').getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
    };
    await refreshAndFollow(); await expect(panel.locator('.subtitle-position')).not.toContainText('已暂停跟随'); expect(await currentVisible()).toBe(true);
    await panel.getByRole('button',{name:'字幕设置',exact:true}).click();
    await panel.getByLabel('跟随播放', { exact: true }).uncheck(); const offTop = await timeline.evaluate(el => el.scrollTop);
    await panel.keyboard.press('Escape');
    await setTime(2, true); await expect(panel.locator('.subtitle-position')).toContainText('00:02'); expect(await timeline.evaluate(el => el.scrollTop)).toBe(offTop);
    await refreshAndFollow(); expect(await currentVisible()).toBe(true);
    await setTime(2, false); await expect(panel.locator('.subtitle-position')).toContainText('播放中');
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    const playingTop = await timeline.evaluate(el => el.scrollTop); await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeGreaterThan(playingTop);
    for (const paused of [true, false]) {
      await setTime(3, paused);
      if(paused)await panel.getByText('合成字幕第 11 行：每个语言依照时间区间匹配。',{exact:true}).click();
      else await panel.getByRole('button', { name: '跳转到 00:01', exact: true }).first().click();
      await expect.poll(() => site.evaluate(() => Math.abs(document.querySelector('video')!.currentTime - 1))).toBeLessThan(.8);
      expect(await site.evaluate(() => document.querySelector('video')!.paused)).toBe(paused);
      await expect(panel.getByRole('region', { name: '字幕轨道' })).toBeVisible();
    }
    await setTime(4, true); await refreshAndFollow();
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: resolve(output, 'bilingual-360.png') });
    await panel.setViewportSize({width:490,height:360});await expect.poll(currentVisible).toBe(true);
    expect(await timeline.evaluate(el=>el.clientHeight>100&&el.scrollHeight>el.clientHeight)).toBe(true);
    await panel.setViewportSize({width:360,height:800});
    removeEnglish = true; await refreshAndFollow();
    await expect(panel.getByRole('alert')).toContainText('该语言已不可用'); expect((await query()).draft.text).toBe('T11 保留的草稿');
    await site.goto('https://www.bilibili.com/video/BVfixture/?p=3');
    await expect.poll(async () => (await query()).video.binding?.partId).toBe('30');
    await expect(panel.locator('.context-current-button .sr-only')).toHaveText('完整字幕已就绪');
    await panel.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    await expect(panel.getByRole('button',{name:'切换字幕轨道'})).toContainText('80 条');
    expect((await query()).workspaceId).not.toBe(initial.workspaceId);
    const prefs = await panel.evaluate(() => chrome.storage.local.get('vcamp.subtitleFontSize')); expect(prefs).toEqual({ 'vcamp.subtitleFontSize': 20 });
    const reader = await context.newPage(); await reader.goto(`chrome-extension://${extensionId}/reader.html?workspaceId=${initial.workspaceId}`);
    await reader.getByRole('navigation').getByRole('button', { name: '字幕', exact: true }).click();
    await expect(reader.getByText('请从资料库打开具体的已保存字幕版本。', { exact: true })).toBeVisible(); await expect(reader.getByLabel('字幕时间轴')).toHaveCount(0);
    evidence.push({ languages: 3, failedAuxiliaryExplicit: true, timeOverlapAndGaps: true, analysisCuesUnchanged: true, font: 20, eventProgress: true, manualPauseAndReturn: true, followOff: true, preservePausedAndPlaying: true, refreshMissingSelection: true, draftRetained: true, part: 30, readerNoNativeTimeline: true });
    pass = true;
  } finally { await writeFile(resolve(output, 'results.json'), JSON.stringify({ pass, evidence, fixture: 'synthetic only; formal JS/CSS; required fixture hosts; decoded 8s MP4' }, null, 2)); await context.close(); }
});
