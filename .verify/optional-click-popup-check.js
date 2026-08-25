const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

// User-reported need: a login flow shows a popup the first time but not the
// next, and the workflow must not get stuck trying to click a "close popup"
// button that simply isn't there on a later run. The fix is a per-step
// "Optional — skip if not found" toggle (backed by the existing onError
// field) on click steps: try to click it, but move on instead of failing the
// whole run when it's absent.
const PAGE = (withPopup) => `<!doctype html><html><body style="padding:20px;font-family:sans-serif">
  ${withPopup ? '<button id="close-popup">Close popup</button>' : ''}
  <button id="next">Continue</button>
  <span id="done">All done</span>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    const withPopup = new URL(req.url, 'http://x').searchParams.get('popup') === '1';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE(withPopup));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const urlWithPopup = `http://127.0.0.1:${port}/?popup=1`;
  const urlNoPopup = `http://127.0.0.1:${port}/`;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'optional-click-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const results = [];
  const check = (name, passed, detail = '') => {
    results.push({ name, passed });
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    await tab.setViewportSize({ width: 900, height: 900 });
    await tab.goto(urlWithPopup);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(400);

    await tab.click('#close-popup');
    await tab.waitForTimeout(200);
    await tab.click('#next');
    await tab.waitForTimeout(200);

    // capture #done via the Add badge, the way a user actually would
    const badge = tab.locator('#__browser_agent_add_badge__');
    await tab.mouse.move(5, 5);
    await tab.waitForTimeout(150);
    const doneBox = await tab.locator('#done').boundingBox();
    await tab.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height / 2);
    await tab.waitForTimeout(300);
    await badge.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(200);

    await tab.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    // ---- mark the popup-close click optional ----
    const popupCloseItem = popup
      .locator('.action-item')
      .filter({ has: popup.locator('.action-selector', { hasText: '#close-popup' }) });
    await popupCloseItem.locator('.action-info').click();
    await popupCloseItem.locator('.action-optional-toggle input[type="checkbox"]').click();
    await popup.waitForTimeout(400); // let the UPDATE_ACTION round trip land before reading it back

    const badgeAfterCheck = await popupCloseItem.locator('.action-optional-badge').count();
    check('the "optional" badge appears on the popup-close step once checked', badgeAfterCheck === 1);

    // ---- run 1: popup present — the optional step must still actually click it ----
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.replay-btn:not([disabled])').waitFor({ timeout: 20000 });
    await popup.waitForTimeout(300);

    const doneRow1 = popup.locator('.step-row', { hasText: 'text1' });
    check('run 1 (popup present) finished with a captured value', (await doneRow1.count()) > 0);

    const popupCloseRow1 = popup.locator('.step-row.step-done', { hasText: '#close-popup' });
    check('run 1 (popup present) actually clicked it, not skipped', (await popupCloseRow1.count()) > 0);

    // ---- run 2: same recording, but pointed at the no-popup page ----
    await popup.click('text=Record');
    await popup.evaluate(
      async (url) => chrome.runtime.sendMessage({ type: 'UPDATE_ACTION', index: 0, patch: { url } }),
      urlNoPopup,
    );
    await popup.waitForTimeout(300);

    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    const finished2 = await popup
      .locator('.replay-btn:not([disabled])')
      .waitFor({ timeout: 20000 })
      .then(() => true, () => false);
    check('run 2 (no popup) finished instead of getting stuck', finished2);

    await popup.waitForTimeout(300);
    const errorCount = await popup.locator('.error-banner').count();
    check('run 2 reported no error', errorCount === 0, errorCount ? await popup.locator('.error-banner').textContent() : '');

    console.log('[debug] tab.url() after run2:', tab.url());
    console.log(
      '[debug] close-popup exists on real page after run2:',
      await tab.evaluate(() => !!document.getElementById('close-popup')),
    );
    const allRows2 = await popup.locator('.step-row').evaluateAll((els) =>
      els.map((el) => ({ cls: el.className, text: el.textContent })),
    );
    console.log('[debug] run 2 step rows:', JSON.stringify(allRows2, null, 2));
    const popupCloseRow2 = popup.locator('.step-row.step-skipped', { hasText: '#close-popup' });
    check('run 2 skipped the missing popup-close step instead of failing', (await popupCloseRow2.count()) > 0);

    const doneRow2 = popup.locator('.step-row', { hasText: 'text1' });
    check('run 2 still reached the final capture after the skip', (await doneRow2.count()) > 0);
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: optional-click-popup-check');
    process.exit(1);
  }
  console.log('PASS: optional-click-popup-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
