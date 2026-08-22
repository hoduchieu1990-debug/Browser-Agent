const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html><html><body style="padding:24px;font-family:sans-serif">
  <div id="cellA" style="width:70px;height:32px;background:#eef">Alice</div>
</body></html>`;

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  const server = http.createServer((_req, res) => {
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
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;

    const tab = await context.newPage();
    await tab.setViewportSize({ width: 700, height: 500 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    // A real popup is its own OS window, not a tab in the main window — a
    // tab navigated to the popup URL doesn't share that property, and
    // CLOSE_POPUP's chrome.windows.getCurrent() needs the real thing to be
    // tested meaningfully (closing "the current window" of a tab would take
    // the whole window — including this content tab — down with it).
    const openPopupWindow = async () => {
      const [p] = await Promise.all([
        context.waitForEvent('page'),
        worker.evaluate((url) => chrome.windows.create({ url, type: 'popup', width: 480, height: 640 }), popupUrl),
      ]);
      await p.waitForLoadState();
      await p.waitForTimeout(200);
      return p;
    };

    let popup = await openPopupWindow();

    // This test is specifically about the plain (non-pinned) popup's own
    // behavior — Pin to Side now defaults to on, so turn it off first. Check
    // rather than assume the starting state: run-all.js reuses one profile
    // across every check, so whichever ran before this may have left it
    // either way.
    await popup.click('text=Settings');
    const pinToggle = popup.locator('.setting-item', { hasText: 'Pin to Side' }).locator('.toggle');
    if ((await pinToggle.getAttribute('class')).includes('on')) await pinToggle.click();
    await popup.click('text=Record');

    check('no bubble on the page', (await tab.locator('#__browser_agent_bubble__').count()) === 0);

    // ---------- Start closes the popup ----------
    await tab.bringToFront();
    const closedAfterStart = popup.waitForEvent('close', { timeout: 5000 }).then(
      () => true,
      () => false,
    );
    await popup.click('.record-btn.start');
    check('popup closed itself after Start', await closedAfterStart);
    check('the content tab survived (only the popup window closed)', !tab.isClosed());

    // ---------- Stop lives right beside Add, not a separate floating bubble ----------
    const badge = tab.locator('#__browser_agent_add_badge__');
    const box = await tab.locator('#cellA').boundingBox();
    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tab.waitForTimeout(300);

    check('no separate bubble appeared', (await tab.locator('#__browser_agent_bubble__').count()) === 0);
    const addBox = await badge.locator('[data-ba-role="add"]').boundingBox();
    const stopBox = await badge.locator('[data-ba-role="stop"]').boundingBox();
    check(
      'Stop sits right beside Add',
      stopBox !== null && Math.abs(stopBox.y - addBox.y) < 6 && stopBox.x > addBox.x,
      JSON.stringify({ add: addBox, stop: stopBox }),
    );

    // record something so there's a session worth archiving
    await badge.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(300);

    // capturing hides the badge — re-hover before reaching for Stop
    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tab.waitForTimeout(300);

    // ---------- clicking Stop actually stops recording and reopens the popup ----------
    const [reopened] = await Promise.all([
      context.waitForEvent('page'),
      badge.locator('[data-ba-role="stop"]').click(),
    ]);
    await reopened.waitForLoadState();
    await reopened.waitForTimeout(400);
    check('Stop reopened the popup', reopened.url().includes('popup.html'));

    const status = await reopened.locator('.recording-status span').textContent();
    check('recording actually stopped', status.includes('Ready'), status);

    await reopened.click('text=Saved');
    await reopened.waitForTimeout(300);
    check('session was archived', (await reopened.locator('.saved-item').count()) >= 1);

    // ---------- Start again from the reopened window also closes it, without touching the content tab ----------
    await reopened.click('text=Record');
    await tab.bringToFront();
    const closedAgain = reopened.waitForEvent('close', { timeout: 5000 }).then(
      () => true,
      () => false,
    );
    await reopened.click('.record-btn.start');
    check('reopened popup window also closes on Start', await closedAgain);
    check('the content tab still survived', !tab.isClosed());

    // Starting from that popup window must still target the site, not the
    // popup's own tab — the popup window is what the browser last focused.
    await tab.waitForTimeout(500);
    check('recording attached to the site, not the popup', await tab.locator('#cellA').isVisible());
    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tab.waitForTimeout(400);
    check('the on-page badge came back, so the site really is recording', await badge.isVisible());

    // clean up: stop the still-running recording so the context can close
    await badge.locator('[data-ba-role="stop"]').click().catch(() => {});
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
