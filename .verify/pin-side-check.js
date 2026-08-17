const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:24px;font-family:sans-serif">
  <div id="cellA" style="width:200px;height:32px;background:#eef">Alice</div>
</body></html>`;

(async () => {
  const server = http.createServer((_r, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
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

    const tab = await context.newPage();
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const contextTypes = () =>
      worker.evaluate(() => chrome.runtime.getContexts({}).then((c) => c.map((x) => x.contextType)));

    // ---- off by default ----
    const initial = await worker.evaluate(() => chrome.sidePanel.getOptions({}));
    check('side panel is off until asked for', initial.enabled !== true, JSON.stringify(initial));

    // ---- the Settings toggle turns it on ----
    await popup.click('text=Settings');
    await popup.waitForTimeout(200);
    const row = popup.locator('.setting-item').filter({ hasText: 'Pin to Side' });
    check('Pin to Side appears in Settings', (await row.count()) === 1);
    await row.locator('.toggle').click();
    await popup.waitForTimeout(500);

    const options = await worker.evaluate(() => chrome.sidePanel.getOptions({}));
    const behavior = await worker.evaluate(() => chrome.sidePanel.getPanelBehavior());
    check('turning it on enables the panel', options.enabled === true, JSON.stringify(options));
    check('and points the toolbar button at it', behavior.openPanelOnActionClick === true, JSON.stringify(behavior));

    // ---- Stop from the page opens the panel rather than a popup window ----
    await popup.click('text=Record');
    await popup.waitForTimeout(200);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(700);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const box = await tab.locator('#cellA').boundingBox();
    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tab.waitForTimeout(400);

    const before = await contextTypes();
    check('no side panel open yet', !before.includes('SIDE_PANEL'), before.join(', '));

    const windowsBefore = await worker.evaluate(() => chrome.windows.getAll().then((w) => w.length));
    await badge.locator('[data-ba-role="stop"]').click();
    await tab.waitForTimeout(1500);

    const after = await contextTypes();
    check('Stop opened the side panel', after.includes('SIDE_PANEL'), after.join(', '));

    const windowsAfter = await worker.evaluate(() => chrome.windows.getAll().then((w) => w.length));
    check('and did not spawn a separate popup window', windowsAfter === windowsBefore, `${windowsBefore} → ${windowsAfter}`);
    check('the page is still there beside it', !tab.isClosed());

    // ---- turning it back off restores the popup-window behaviour ----
    await popup.click('text=Settings');
    await popup.waitForTimeout(200);
    await popup.locator('.setting-item').filter({ hasText: 'Pin to Side' }).locator('.toggle').click();
    await popup.waitForTimeout(500);

    const offAgain = await worker.evaluate(() => chrome.sidePanel.getOptions({}));
    check('turning it off disables the panel again', offAgain.enabled === false, JSON.stringify(offAgain));
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
