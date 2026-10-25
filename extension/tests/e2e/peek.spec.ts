import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixEvidence, installedPanel } from './fix-support';

test('SPEC-01: edge/rail leave closes after 240ms, re-entry and pin cancel stale timers', async () => {
  const { context, page } = await installedPanel();
  try {
    const rail = page.getByRole('navigation');
    const composer = page.locator('.composer');
    const pin = page.locator('.sidebar-toggle');
    const originalX = (await pin.boundingBox())!.x;
    const pinnedWidth = (await composer.boundingBox())!.width;
    await pin.click();
    await page.mouse.move(150, 400);
    await page.waitForTimeout(350);
    const wide = (await composer.boundingBox())!.width;
    expect(wide).toBeGreaterThan(pinnedWidth);
    await page.mouse.move(358, 400);
    await expect(rail).toHaveClass(/peeking/);
    await page.waitForTimeout(300);
    expect((await composer.boundingBox())!.width).toBe(wide);
    // Direct edge -> content, the exact previously broken path.
    await page.evaluate(() => {
      const start = performance.now();
      (window as any).peekElapsed = null;
      const rail = document.querySelector('.rail')!;
      const observer = new MutationObserver(() => {
        if (!rail.classList.contains('peeking')) { (window as any).peekElapsed = performance.now() - start; observer.disconnect(); }
      });
      observer.observe(rail, { attributes: true, attributeFilter: ['class'] });
    });
    await page.mouse.move(150, 400);
    await page.waitForTimeout(100);
    expect(await rail.getAttribute('class')).toContain('peeking');
    await expect(rail).not.toHaveClass(/peeking/);
    const elapsed = await page.evaluate(() => (window as any).peekElapsed as number);
    expect(elapsed).toBeGreaterThanOrEqual(220);
    expect(elapsed).toBeLessThan(600);
    // Edge -> rail cancels edge's exit timer; rail -> content starts a new delay.
    await page.mouse.move(358, 400);
    await page.waitForTimeout(280);
    await page.mouse.move(326, 400);
    await page.waitForTimeout(320);
    expect(await rail.getAttribute('class')).toContain('peeking');
    await page.mouse.move(150, 400);
    await page.waitForTimeout(100);
    expect(await rail.getAttribute('class')).toContain('peeking');
    await page.mouse.move(326, 400);
    await page.waitForTimeout(320);
    expect(await rail.getAttribute('class')).toContain('peeking');
    await page.mouse.move(150, 400);
    await expect(rail).not.toHaveClass(/peeking/);
    // Leaving the browser content bounds also schedules close.
    await page.mouse.move(358, 400);
    await page.waitForTimeout(280);
    await page.mouse.move(-10, -10);
    await expect(rail).not.toHaveClass(/peeking/);
    // Pin during an outstanding delay, then unpin and reopen: old timer must not close it.
    await page.mouse.move(358, 400);
    await page.mouse.move(150, 400);
    await pin.click();
    await expect(page.locator('.app-shell')).toHaveClass(/pinned/);
    await page.waitForTimeout(300);
    expect((await composer.boundingBox())!.width).toBe(pinnedWidth);
    await pin.click();
    await page.mouse.move(358, 400);
    await page.waitForTimeout(320);
    expect(await rail.getAttribute('class')).toContain('peeking');
    expect((await pin.boundingBox())!.x).toBe(originalX);
    // Keyboard navigation keeps the focused navigation visible until focus leaves.
    await pin.focus();
    await page.keyboard.press('Tab');
    await expect(rail.getByRole('button', { name: '问答', exact: true })).toBeFocused();
    await page.mouse.move(150, 400);
    await page.waitForTimeout(320);
    expect(await rail.getAttribute('class')).toContain('peeking');
    await page.getByRole('textbox').focus();
    await expect(rail).not.toHaveClass(/peeking/);
    await writeFile(resolve(fixEvidence, 'peek.json'), JSON.stringify({ browser: context.browser()?.version(), elapsedMs: elapsed, expectedDelayMs: 240, pinnedWidth, previewWidth: wide, fixedToggleX: originalX, paths: ['edge-content', 'edge-rail', 'rail-content', 'leave-content-bounds', 'reenter-during-delay', 'pin-during-delay', 'keyboard-focus'], result: 'pass' }, null, 2));
  } finally { await context.close(); }
});
