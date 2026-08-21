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

    // --- must stay light and fast: a crop of the element's own area (plus a
    // little padding), not a photo of the whole window — the aspect ratio
    // should track the 80x32 button (+12px padding each side = 104x56),
    // nowhere near the window's own, much wider-or-taller shape. ---
    const realWindow = await tab.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    console.log('[real window]', JSON.stringify(realWindow));

    const dims = await popup.evaluate(
      (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = reject;
          img.src = src;
        }),
      firstThumbSrc,
    );
    console.log('[thumbnail dimensions]', JSON.stringify(dims));
    assert(dims.w <= 210 && dims.h <= 210, `expected a small crop (<=~200px), got ${JSON.stringify(dims)} — looks like the whole window got captured instead`);
    const expectedAspect = (80 + 24) / (32 + 24); // button + 12px padding each side
    const aspect = dims.w / dims.h;
    assert(
      Math.abs(aspect - expectedAspect) < 0.15,
      `expected an aspect ratio near the padded button's ${expectedAspect.toFixed(2)}, got ${aspect.toFixed(2)} (dims ${JSON.stringify(dims)})`,
    );
    console.log('[ok] the captured image is a light crop of just the element, not the whole window');

    // --- hovering the small thumb reveals a larger inline preview, no new
    // tab (Chrome silently blocks window.open() straight to a data: URL —
    // it lands on about:blank, which is what this replaces). ---
    const firstWrap = popup.locator('.action-thumb-wrap').first();
    const preview = firstWrap.locator('.action-thumb-preview');
    assert(!(await preview.isVisible()), 'the enlarged preview should be hidden before hovering');
    await firstWrap.hover();
    await preview.waitFor({ state: 'visible', timeout: 2000 });
    const previewSrc = await preview.getAttribute('src');
    assert.strictEqual(previewSrc, firstThumbSrc, 'the hover preview should show the same captured image as the small thumb');
    console.log('[ok] hovering the thumbnail reveals an enlarged inline preview (no new-tab navigation involved)');

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
