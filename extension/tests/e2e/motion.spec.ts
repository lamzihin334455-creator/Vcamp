import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixEvidence, installedPanel } from './fix-support';

async function captureMotion(page: Page, phase: string, duration: number, easing: string, fromY: number, toY: number, fromBlur: number, toBlur: number) {
  await expect.poll(() => page.locator('main').evaluate(element => element.getAnimations().filter(a => a.playState === 'running').length)).toBeGreaterThan(0);
  const frames = await page.locator('main').evaluate((element, duration) => {
    const animation = element.getAnimations().find(a => a.playState === 'running')!;
    animation.pause();
    (window as any).testedAnimation = animation;
    const timing = animation.effect!.getTiming();
    const frames = [0, duration / 2, duration].map(time => {
      animation.currentTime = time;
      const style = getComputedStyle(element);
      return { time, opacity: Number(style.opacity), y: new DOMMatrixReadOnly(style.transform).m42, blur: parseFloat(style.filter.replace('blur(', '')) || 0 };
    });
    animation.currentTime = duration / 2;
    return { timing, frames };
  }, duration);
  expect(frames.timing.duration).toBe(duration);
  expect(frames.timing.easing).toBe(easing);
  expect(frames.frames[0].y).toBeCloseTo(fromY);
  expect(frames.frames[2].y).toBeCloseTo(toY);
  expect(frames.frames[0].blur).toBeCloseTo(fromBlur);
  expect(frames.frames[2].blur).toBeCloseTo(toBlur);
  expect(frames.frames[0].opacity).toBe(phase === 'exit' ? 1 : 0);
  expect(frames.frames[2].opacity).toBe(phase === 'exit' ? 0 : 1);
  expect(frames.frames[1].opacity).toBeGreaterThan(0);
  expect(frames.frames[1].opacity).toBeLessThan(1);
  expect(frames.frames[1].blur).toBeGreaterThan(0);
  await page.screenshot({ path: resolve(fixEvidence, `motion-${phase}-mid.png`) });
  return frames;
}

test('SPEC-02: browser renders approved exit/entry, cancels interrupted motion and honors reduced motion', async () => {
  const { context, page } = await installedPanel();
  try {
    await page.getByRole('navigation').getByRole('button', { name: '笔记', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    const exit = await captureMotion(page, 'exit', 115, 'cubic-bezier(0.4, 0, 1, 1)', 0, -5, 0, 1.4);
    await page.evaluate(() => (window as any).testedAnimation.finish());
    await expect(page.locator('main')).toHaveAttribute('data-module', 'markdown');
    const enter = await captureMotion(page, 'enter', 220, 'cubic-bezier(0.16, 1, 0.3, 1)', 9, 0, 1.8, 0);
    // Interrupt the actual paused mid-entry effect and then several exits.
    await page.evaluate(() => {
      (window as any).cancelledAnimations = 0;
      (window as any).testedAnimation.addEventListener('cancel', () => (window as any).cancelledAnimations++);
    });
    for (const name of ['HTML', '随笔', '字幕', '问答']) {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).evaluate(button => (button as HTMLButtonElement).click());
      await page.waitForTimeout(25);
    }
    await expect(page.locator('main')).toHaveAttribute('data-module', 'chat');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).cancelledAnimations)).toBeGreaterThan(0);
    const final = await page.locator('main').evaluate(element => ({ opacity: getComputedStyle(element).opacity, filter: getComputedStyle(element).filter, y: new DOMMatrixReadOnly(getComputedStyle(element).transform).m42, animations: element.getAnimations().length }));
    expect(final).toEqual({ opacity: '1', filter: 'none', y: 0, animations: 0 });
    // Live, unpaused requestAnimationFrame samples corroborate the timing-controlled screenshots.
    const live = await page.evaluate(async () => {
      const main = document.querySelector('main')!;
      const samples: { ms: number; module: string | null; opacity: number; filter: string; transform: string }[] = [];
      const start = performance.now();
      (document.querySelector('nav button[aria-label="HTML"]') as HTMLButtonElement).click();
      await new Promise<void>(resolve => {
        const sample = () => {
          const style = getComputedStyle(main);
          samples.push({ ms: performance.now() - start, module: main.getAttribute('data-module'), opacity: Number(style.opacity), filter: style.filter, transform: style.transform });
          if (performance.now() - start < 440) requestAnimationFrame(sample); else resolve();
        };
        requestAnimationFrame(sample);
      });
      return samples;
    });
    expect(live.some(frame => frame.module === 'chat' && frame.opacity > 0 && frame.opacity < 1 && frame.filter.includes('blur'))).toBe(true);
    expect(live.some(frame => frame.module === 'html' && frame.opacity > 0 && frame.opacity < 1 && frame.filter.includes('blur'))).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('navigation').getByRole('button', { name: '问答', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-module', 'chat');
    expect(await page.locator('main').evaluate(element => ({ opacity: getComputedStyle(element).opacity, animations: element.getAnimations().length }))).toEqual({ opacity: '1', animations: 0 });
    await writeFile(resolve(fixEvidence, 'motion.json'), JSON.stringify({ browser: context.browser()?.version(), exit, enter, final, live, reducedMotion: 'pass', interruption: 'actual entry cancelled; final route chat visible', screenshots: 'Browser rendered middle frames paused using Web Animations currentTime, not artificial CSS states' }, null, 2));
  } finally { await context.close(); }
});
