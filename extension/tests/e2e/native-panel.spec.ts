import { chromium, expect, test, type CDPSession } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';

// Native host target is intentionally distinct from an extension page opened in a tab.
async function targetSession(browser: CDPSession, targetId: string) {
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: false });
  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  browser.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
  });
  return {
    async send(method: string, params: object = {}): Promise<any> {
      const requestId = ++id;
      const result = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
      await browser.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: requestId, method, params }) });
      return result;
    }
  };
}

test('D target Chrome: native panel default width, close/reopen and full browser restart', async () => {
  test.setTimeout(60000);
  const executablePath = process.env.VCAMP_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  await mkdir(resolve('.profiles'), { recursive: true });
  await mkdir(resolve('../.tmp/e2e'), { recursive: true });
  const profile = await mkdtemp(resolve('.profiles/Native-T01-'));
  async function launch() {
    const context = await chromium.launchPersistentContext(profile, {
      executablePath, headless: false, viewport: null,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--window-size=1280,900']
    });
    const browser = await context.browser()!.newBrowserCDPSession();
    const { id } = await browser.send('Extensions.loadUnpacked', { path: resolve('dist-test') });
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${id}/sidepanel.html`);
    const driverSession = await context.newCDPSession(driver);
    const driverId = (await driverSession.send('Target.getTargetInfo')).targetInfo.targetId;
    await driver.evaluate(() => {
      // Test driver only: simulate a user gesture through a button; never bundled.
      const button = document.createElement('button'); button.id = 'open-native'; button.textContent = '打开原生侧栏';
      button.onclick = async () => { const window = await chrome.windows.getCurrent(); if (window.id === undefined) throw new Error('Missing window'); await chrome.sidePanel.open({ windowId: window.id }); };
      document.body.append(button);
    });
    async function open() {
      await driver.locator('#open-native').click();
      let targetId = '';
      await expect.poll(async () => {
        const { targetInfos } = await browser.send('Target.getTargets');
        targetId = targetInfos.find(t => t.type === 'page' && t.url === `chrome-extension://${id}/sidepanel.html` && t.targetId !== driverId)?.targetId ?? '';
        return targetId;
      }).not.toBe('');
      const target = await targetSession(browser, targetId);
      async function evaluate(expression: string) {
        const result = await target.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      }
      await expect.poll(() => evaluate('Boolean(document.querySelector("textarea") && !document.querySelector("textarea").disabled)')).toBe(true);
      return { target, evaluate, targetId };
    }
    return { context, driver, open };
  }
  let run = await launch();
  try {
    let host = await run.open();
    await expect.poll(() => host.evaluate('innerWidth')).toBeGreaterThan(0);
    const dimensions = await host.evaluate('({width:innerWidth,height:innerHeight,devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth})');
    expect(dimensions.overflow).toBe(false);
    expect(dimensions.width).toBeGreaterThan(0);
    await host.evaluate('document.querySelector("textarea").focus()');
    await host.target.send('Input.insertText', { text: '真实侧栏保存，重启恢复。' });
    await expect.poll(() => host.evaluate('document.querySelector("[role=status]").textContent')).toBe('草稿已保存');
    await host.evaluate('document.querySelector(".output-control > button").click()');
    await host.evaluate('[...document.querySelectorAll("[role=menuitemradio]")].find(button => button.textContent.includes("Markdown")).click()');
    await expect.poll(() => host.evaluate('document.querySelector("[role=status]").textContent')).toBe('草稿已保存');
    const screenshot = await host.target.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve('../.tmp/e2e/native-panel.png'), Buffer.from(screenshot.data, 'base64'));
    await run.driver.evaluate(async () => {
      const window = await chrome.windows.getCurrent();
      if (window.id === undefined) throw new Error('Missing window');
      // Chrome 141+ host test API; production only requires the Chrome 116 open API.
      const panel = chrome.sidePanel as typeof chrome.sidePanel & { close(options: { windowId: number }): Promise<void> };
      await panel.close({ windowId: window.id });
    });
    host = await run.open();
    await expect.poll(() => host.evaluate('document.querySelector("textarea").value')).toBe('真实侧栏保存，重启恢复。');
    await expect.poll(() => host.evaluate('document.querySelector(".output-control > button").textContent')).toBe('笔记');
    const version = run.context.browser()!.version();
    await run.context.close();
    run = await launch();
    host = await run.open();
    await expect.poll(() => host.evaluate('document.querySelector("textarea").value')).toBe('真实侧栏保存，重启恢复。');
    await expect.poll(() => host.evaluate('document.querySelector(".output-control > button").textContent')).toBe('笔记');
    await writeFile(resolve('../.tmp/e2e/native-environment.json'), JSON.stringify({ version, executablePath, profile, dimensions, target: host.targetId, headless: false, build: 'dist-test', closeReopen: 'pass', browserRestart: 'pass', restoredOutputType: 'markdown', caveat: 'Input.insertText validates text entry; not an operating-system IME test. Output selection uses the rendered native panel controls via DOM click. Native width is measured without viewport emulation.' }, null, 2));
  } finally { await run.context.close(); }
});
