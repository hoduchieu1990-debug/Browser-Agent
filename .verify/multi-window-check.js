const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = (label) => `<!doctype html><html><body style="padding:24px;font-family:sans-serif">
  <div id="cellA" style="width:120px;height:32px;background:#eef">${label}</div>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE(req.url === '/second' ? 'SECOND' : 'FIRST'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const first = await context.newPage();
    await first.goto(`http://127.0.0.1:${port}/first`);

    await worker.evaluate((url) => chrome.windows.create({ url, type: 'normal' }), `http://127.0.0.1:${port}/second`);
    await first.waitForTimeout(800);
    const second = context.pages().find((p) => p.url().endsWith('/second'));
    check('second browser window opened', !!second);

    const badgeVisibleOn = async (page) => {
      await page.bringToFront();
      await page.hover('#cellA');
      await page.click('#cellA', { button: 'right', modifiers: ['Control'] });
      await page.waitForTimeout(500);
      const visible = await page.locator('#__browser_agent_add_badge__').isVisible().catch(() => false);
      await page.keyboard.press('Escape').catch(() => {});
      return visible;
    };

    // The user is working in the SECOND window. Starting from a popup window
    // (the state Stop leaves behind) must record that window's site — not
    // whichever normal window happens to come first in the tab query.
    await second.bringToFront();
    await second.waitForTimeout(400);

    const [popupWin] = await Promise.all([
      context.waitForEvent('page'),
      worker.evaluate(
        (url) => chrome.windows.create({ url, type: 'popup', width: 480, height: 640 }),
        `chrome-extension://${extensionId}/popup.html`,
      ),
    ]);
    await popupWin.waitForLoadState();
    await popupWin.waitForTimeout(300);

    // This test is specifically about the plain (non-pinned) popup's own
    // behavior — Pin to Side now defaults to on, so turn it off first. Check
    // rather than assume the starting state: run-all.js reuses one profile
    // across every check, so whichever ran before this may have left it
    // either way.
    await popupWin.click('text=Settings');
    const pinToggle = popupWin.locator('.setting-item', { hasText: 'Pin to Side' }).locator('.toggle');
    if ((await pinToggle.getAttribute('class')).includes('on')) await pinToggle.click();
    await popupWin.click('text=Record');

    const closed = popupWin.waitForEvent('close', { timeout: 5000 }).then(() => true, () => false);
    await popupWin.click('.record-btn.start');
    check('popup window closed on Start', await closed);

    check('recording attached to the window the user was in', await badgeVisibleOn(second));
    check('and not to the other browser window', !(await badgeVisibleOn(first)));

    // stop cleanly so the archived-session state doesn't leak into other runs
    // — Stop lives only in the popup now, not on a badge row on the page.
    const stopWin = await context.newPage();
    await stopWin.goto(`chrome-extension://${extensionId}/popup.html`);
    await stopWin.click('.record-btn.stop').catch(() => {});
    await stopWin.waitForTimeout(300);
    await stopWin.close();
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
