const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

const PAGE = `<!doctype html><html><body style="padding:24px">
  <button id="btn1" style="width:80px;height:32px">Click me</button>
  <input id="text1" style="width:120px;height:24px" />
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
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(400);

    // --- "no lag" check: the click's own step must appear near-instantly,
    // not wait on the (much slower) screenshot capture behind it. ---
    const t0 = Date.now();
    await tab.click('#btn1');
    await popup.locator('.action-item').filter({ hasText: 'click' }).waitFor({ timeout: 2000 });
    const stepAppearedMs = Date.now() - t0;
    console.log(`[perf] click step appeared in the list after ${stepAppearedMs}ms`);
    assert(stepAppearedMs < 500, `recording the step itself took ${stepAppearedMs}ms — should be near-instant, unaffected by the thumbnail capture`);
    console.log('[ok] the step is recorded immediately, not blocked on the screenshot');

    await tab.fill('#text1', 'hello');
    await tab.locator('#text1').dispatchEvent('change');
    await tab.waitForTimeout(200);

    // --- thumbnails eventually show up, without the user doing anything else ---
    await popup.locator('.action-thumb').first().waitFor({ timeout: 5000 });
    const thumbCount = await popup.locator('.action-thumb').count();
    console.log('[thumb count in Record tab]', thumbCount);
    assert(thumbCount >= 2, `expected a thumbnail for both recorded steps, got ${thumbCount}`);

    const firstThumbSrc = await popup.locator('.action-thumb').first().getAttribute('src');
    assert(firstThumbSrc && firstThumbSrc.startsWith('data:image/jpeg'), `expected a jpeg data URL, got ${firstThumbSrc?.slice(0, 30)}`);
    console.log('[ok] Record tab shows a real captured thumbnail per step');

    // --- Preview tab shows the same thumbnails before Replay too ---
    await popup.click('text=Preview');
    await popup.waitForTimeout(200);
    const previewThumbCount = await popup.locator('.action-thumb').count();
    console.log('[thumb count in Preview tab, pre-replay]', previewThumbCount);
    assert(previewThumbCount >= 2, `expected thumbnails in the pending Preview list too, got ${previewThumbCount}`);
    console.log('[ok] Preview tab shows thumbnails before Replay has ever run');

    // --- Reset clears them ---
    await popup.click('text=Record');
    await popup.click('.reset-btn');
    await popup.click('.reset-btn.danger');
    await popup.waitForTimeout(300);
    const thumbsAfterReset = await popup.locator('.action-thumb').count();
    assert.strictEqual(thumbsAfterReset, 0, `expected 0 thumbnails after Reset, got ${thumbsAfterReset}`);
    console.log('[ok] Reset clears thumbnails along with the actions');

    await popup.click('.record-btn.stop').catch(() => {});
    await popup.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: step-thumbnail-check');
})();
