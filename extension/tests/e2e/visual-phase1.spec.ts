import { expect, test } from '@playwright/test';
import { setup } from './interaction-fixture';

for (const mode of ['pair', 'overview', 'takeover'] as const) test(`phase one ${mode}: production extension plans windows, captures bounded candidates, restores playback and exposes audit`, async ({}, testInfo) => {
  test.setTimeout(60_000);
  const { context, page, site, worker } = await setup();
  try {
    await worker.evaluate(mode => {
      const original = fetch;
      (globalThis as any).phase1Requests = [];
      globalThis.fetch = (async (input: any, init: any) => {
        if (!String(input).startsWith('https://api.deepseek.com/')) return original(input, init);
        if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ object: 'list', data: [{ id: 'local-vision', name: 'Local vision', input_modalities: ['text', 'image'] }] }), { headers: { 'content-type': 'application/json' } });
        const body = JSON.parse(init.body), system = String(body.messages?.[0]?.content ?? '');
        const kind = system.includes('[P1:requirements-plan]') ? 'requirements' : system.includes('[P1:vision-plan]') ? 'vision' : system.includes('[P1:vision-review]')?'review':'answer';
        (globalThis as any).phase1Requests.push({ kind, body });
        const window = (from: number, to: number, anchor: number) => ({ from, to, anchor, cueIds: [0], basis: 'subtitle' });
        const content = kind === 'requirements' ? JSON.stringify({ version: 1, interpretedIntent: '查看相关图表或操作状态，按任务安排视觉证据', additionalSources: [], outputRequirements: ['依据实际画面回答'] })
          : kind === 'vision' ? JSON.stringify({ version: 2, scope: mode === 'pair' ? 'process' : 'focused', needsNewFrames: true,
            evidence: [{ id: 'states', need: mode === 'pair' ? '核对操作前后状态' : '辨认相关画面的总体结构', reason: '字幕用于定位候选窗口，音画时机有不确定性', priority: 'required', mode: mode === 'pair' ? 'pair' : 'single', reuseAttachmentIds: [],
              detailNeed: mode === 'pair' ? 'read-text' : 'overview', checkTargets:['画面结构与状态'],readTargets:[], windows: mode === 'pair' ? [window(1.234, 1.9, 1.5), window(2.5, 3.4, 3)] : [window(1.234, 1.9, 1.5)] }], unresolved: [] })
            :kind==='review'?JSON.stringify({version:3,results:JSON.parse(body.messages[1].content[0].text).targets.map((t:any)=>({evidenceId:t.evidenceId,checks:t.checks.map((c:any)=>({checkId:c.checkId,status:'confirmed',imageRefs:t.imageRefs,observation:'本地模拟核验结果'})),refinements:[]}))})
            : '已根据本次实际提供的画面回答；仍需人工判断任务所需的细节是否可读。';
        return new Response('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      }) as typeof fetch;
    }, mode);
    const command = (operation: any) => page.evaluate(operation => chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation }), operation);
    expect((await command({ type: 'provider.save-key', providerId: 'deepseek', expectedRevision: 0, key: 'SYNTHETIC_LOCAL_ONLY' })).ok).toBe(true);
    const fetched = await command({ type: 'provider.fetch', expectedRevision: 1 });
    expect((await command({ type:'provider.import-models',expectedRevision:fetched.view.provider.revision,modelIds:['local-vision'] })).ok).toBe(true);
    await page.reload(); await site.bringToFront();
    await page.getByRole('button', { name: '切换当前内容' }).click(); await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
    await page.getByRole('button', { name: '更多输入操作' }).click(); await page.getByRole('button', { name: /^开启自主识别画面/ }).click();
    await expect(page.getByRole('button', { name: '关闭自主识别画面', exact: true })).toBeVisible();
    const current = (await command({ type: 'workspace.query' })).view, target = { kind: 'chat', workspaceId: current.workspaceId, chatId: current.chatId };
    const initial = await site.locator('video').evaluate((v: HTMLVideoElement) => ({ time: v.currentTime, paused: v.paused }));
    if (mode === 'takeover') await site.locator('video').evaluate((v: HTMLVideoElement) => { v.addEventListener('seeking', () => { v.currentTime = .75; }, { once: true }); });
    await page.getByLabel('输入草稿').fill(mode === 'pair' ? '比较操作前后状态，请保留两个状态的画面依据。' : '这个相关画面的总体结构是什么？');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const query = async () => (await command({ type: 'generation.query', target })).view.generation;
    if (mode === 'takeover') {
      await expect.poll(async () => (await query()).jobs.at(-1)?.state, { timeout: 15_000 }).toBe('awaiting-permission');
      expect((await query()).jobs.at(-1).visual.mediaFailure).toBe('user-control');
      expect(await site.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(.75, 1);
      expect(await worker.evaluate(() => (globalThis as any).phase1Requests.map((r: any) => r.kind))).toEqual(['requirements', 'vision']);
      await page.getByRole('button', { name: '仅用字幕继续', exact: true }).click();
    }
    await expect.poll(async () => (await query()).jobs.at(-1)?.state ?? 'not-started', { timeout: 30_000 }).toBe('completed');
    const job = (await query()).jobs.at(-1), audit = job.visual.audit;
    expect(audit.frames).toHaveLength(mode === 'takeover' ? 0 : mode === 'pair' ? 2 : 1);
    expect(audit.budget.captures).toBeLessThanOrEqual(18); expect(audit.budget.mediaMs).toBeLessThan(45000);
    expect(audit.frames.every((f: any) => { const s = audit.slots.find((s: any) => s.key === f.slotKey); return f.time >= s.from - .1 && f.time <= s.to + .1; })).toBe(true);
    const requests = await worker.evaluate(() => (globalThis as any).phase1Requests);
    expect(requests.map((r: any) => r.kind)).toEqual(mode==='takeover'?['requirements','vision','answer']:['requirements', 'vision', 'review', 'answer']);
    expect(JSON.stringify(requests[1].body.messages)).toContain('cueId=0'); expect(JSON.stringify(requests[1].body.messages)).toContain('增强内容');
    expect(JSON.stringify(requests.at(-1).body.messages)).toContain('增强内容');
    const finalImages = requests.at(-1).body.messages.flatMap((m: any) => typeof m.content === 'string' ? [] : m.content).filter((p: any) => p.type === 'image_url');
    expect(finalImages).toHaveLength(audit.frames.length);
    expect(finalImages.every((p: any) => p.image_url.detail === (mode === 'pair' ? 'original' : 'low'))).toBe(true);
    const restoredTime = mode === 'takeover' ? .75 : initial.time;
    await expect.poll(() => site.locator('video').evaluate((v: HTMLVideoElement, time: number) => Math.abs(v.currentTime - time), restoredTime)).toBeLessThan(.15);
    expect(await site.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(initial.paused);
    await page.setViewportSize({ width: 400, height: 1600 });
    await page.locator('.visual-evidence > summary').click();
    await expect(page.locator('.visual-evidence')).toContainText(mode==='takeover'?'未作独立视觉语义核验':'模型判断足够');
    if (mode !== 'takeover') {
      await expect(page.locator('.visual-evidence')).toContainText('实际');
      await page.locator('.visual-evidence details > summary').click();
    } else await expect(page.locator('.visual-evidence')).toContainText('仅用字幕继续');
    await page.locator('.visual-evidence > summary').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator('.visual-evidence').screenshot({ path: testInfo.outputPath(`visual-${mode}-audit.png`) });
  } finally { await context.close(); }
});
