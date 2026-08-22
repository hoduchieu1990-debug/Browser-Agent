const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:24px;font-family:sans-serif">
  <div id="cellA" style="width:120px;height:32px;background:#eef">Alice</div>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // Exactly the shape that failed: a landing page whose URL carries tracking
  // parameters in the #fragment, recorded and replayed from that same page.
  const url = `http://127.0.0.1:${port}/#vn_source=Spotlight&vn_campaign=Header&vn_medium=Logo`;

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
    await tab.setViewportSize({ width: 800, height: 600 });
    await tab.goto(url);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // This test is specifically about Stop reopening a plain popup WINDOW —
    // Pin to Side now defaults to on, under which Stop opens the side panel
    // instead, so turn it off first. Check rather than assume the starting
    // state: run-all.js reuses one profile across every check, so whichever
    // ran before this may have left it either way.
    await popup.click('text=Settings');
    const pinToggle = popup.locator('.setting-item', { hasText: 'Pin to Side' }).locator('.toggle');
    if ((await pinToggle.getAttribute('class')).includes('on')) await pinToggle.click();
    await popup.click('text=Record');

    // ---- record a capture, which also stores the starting url ----
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(600);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const box = await tab.locator('#cellA').boundingBox();
    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tab.waitForTimeout(400);
    await badge.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(400);

    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tab.waitForTimeout(300);
    const [reopened] = await Promise.all([
      context.waitForEvent('page'),
      badge.locator('[data-ba-role="stop"]').click(),
    ]);
    await reopened.waitForLoadState();
    await reopened.waitForTimeout(400);

    const navTarget = await reopened.locator('.action-selector').first().textContent();
    check('the recorded start url kept its #fragment', navTarget?.includes('#vn_source=') ?? false, navTarget ?? '');

    // ---- replay: the tab is already sitting on that exact url, so the
    // navigate step changes nothing and fires no page load ----
    await reopened.click('text=Preview');
    await reopened.click('.replay-btn');

    const finished = await reopened
      .locator('.replay-btn:not([disabled])')
      .waitFor({ timeout: 25000 })
      .then(() => true, () => false);
    check('replay finished instead of hanging on navigate', finished);

    await reopened.waitForTimeout(500);
    const errorCount = await reopened.locator('.error-banner').count();
    const errorText = errorCount ? (await reopened.locator('.error-banner').textContent())?.trim() : '';
    check('no navigation timeout reported', errorCount === 0, errorText ?? '');

    const navStatus = await reopened.locator('.step-type').first().textContent();
    check('the navigate step ran', navStatus?.includes('navigate') ?? false, navStatus ?? '');
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
