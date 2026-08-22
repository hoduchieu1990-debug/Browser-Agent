const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Reported bug: opening Preview before pressing Replay showed the STEP LOG
// from a previous replay run instead of the current recording — stale data
// left in storage/memory that nothing cleared when the recording changed.
const PAGE = `<!doctype html><html><body>
  <button id="btn1">One</button>
  <button id="btn2">Two</button>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'profile'), {
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

    // --- Recording #1: click btn1, then replay it so a real ReplayState exists ---
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(300);
    await tab.click('#btn1');
    await tab.waitForTimeout(200);
    await popup.click('.record-btn.stop');
    await tab.waitForTimeout(300);

    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.replay-btn:not([disabled])').waitFor({ timeout: 20000 });
    await popup.waitForTimeout(300);

    const oldSteps = await popup.locator('.step-target').allTextContents();
    console.log('[old replay steps]', JSON.stringify(oldSteps));
    assert(oldSteps.some((t) => t.includes('#btn1')), 'sanity check: the first replay should show #btn1');

    // --- Recording #2: a fresh, different recording ---
    await popup.click('text=Record');
    await popup.click('.record-btn.start');
    await tab.bringToFront();
    await tab.waitForTimeout(300);
    await tab.click('#btn2');
    await tab.waitForTimeout(200);
    await popup.click('.record-btn.stop');
    await tab.waitForTimeout(300);

    // Go straight to Preview WITHOUT pressing Replay — this is the reported bug.
    await popup.click('text=Preview');
    await popup.waitForTimeout(300);

    const replayBtnLabel = await popup.locator('.replay-btn').textContent();
    assert(!replayBtnLabel.includes('Replaying'), 'no replay should be running');

    const currentSteps = await popup.locator('.step-target').allTextContents();
    console.log('[preview before replay]', JSON.stringify(currentSteps));
    assert(
      currentSteps.some((t) => t.includes('#btn2')),
      `Preview should show the CURRENT recording (#btn2), got: ${JSON.stringify(currentSteps)}`,
    );
    assert(
      !currentSteps.some((t) => t.includes('#btn1')),
      `Preview must not still show the stale previous replay's step (#btn1), got: ${JSON.stringify(currentSteps)}`,
    );
    console.log('[ok] Preview shows the current recording, not a stale previous replay');

    // --- Label rename check ---
    const panelTitles = await popup.locator('.panel-title').allTextContents();
    console.log('[panel titles]', JSON.stringify(panelTitles));
    assert(!panelTitles.some((t) => t.includes('Captured data')), 'old "Captured data" label should be gone');
    console.log('[ok] "Captured data" label no longer present (renamed)');

    await popup.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: preview-stale-check');
})();
