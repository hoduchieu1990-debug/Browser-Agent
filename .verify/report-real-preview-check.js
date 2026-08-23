const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

const PAGE = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
  <div id="box" style="width:80px;height:60px;background:#4f46e5;margin-top:12px;color:#4f46e5">box</div>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  // A dedicated profile — this test opens a hidden background window of its
  // own (the real preview run), which would collide with whatever the
  // shared .verify/profile/ has left mid-flight from other checks.
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'report-real-preview-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const badge = testPage.locator('#__browser_agent_add_badge__');

    // Record a text extraction and an image capture on a page already
    // navigated to before Start — the recorder stores that url as an
    // implicit leading "navigate" step, which is what makes the report
    // window's background preview run able to open its own hidden window.
    await testPage.bringToFront();
    await popup.click('text=Record');
    await popup.click('text=Start');
    await testPage.waitForTimeout(400);

    const totalBox = await testPage.locator('#total').boundingBox();
    await testPage.mouse.move(totalBox.x + totalBox.width / 2, totalBox.y + totalBox.height / 2);
    await testPage.waitForTimeout(400);
    await badge.locator('button', { hasText: 'Add' }).click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await testPage.waitForTimeout(400);
    await testPage.mouse.move(5, 5); // clear the hover state before targeting the next element
    await testPage.waitForTimeout(300);

    const imgBox = await testPage.locator('#box').boundingBox();
    await testPage.mouse.move(imgBox.x + imgBox.width / 2, imgBox.y + imgBox.height / 2);
    await testPage.waitForTimeout(400);
    await badge.locator('button', { hasText: 'Add' }).click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Image of this area' }).click();
    await testPage.waitForTimeout(400);

    await testPage.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(400);

    await popup.click('text=Saved');
    await popup.waitForTimeout(200);
    const [reportPage] = await Promise.all([
      context.waitForEvent('page'),
      popup.locator('.saved-schedule').first().click(),
    ]);
    reportPage.on('pageerror', (err) => console.log('REPORTPAGE-ERROR>', err.message));
    await reportPage.waitForLoadState();
    await reportPage.waitForTimeout(300);

    // Everything lives on one page now — result keys default to all-selected,
    // and the real run fires the moment the window opens (no tab, no click)
    // once it confirms there is no earlier stored result for this recording.
    const previewFrame = reportPage.frameLocator('.report-preview-frame');

    // Wait for that background run to actually finish rather than a fixed delay.
    await reportPage
      .locator('.report-preview-controls button', { hasText: 'Run again' })
      .waitFor({ timeout: 20000 });

    const realText = await previewFrame.locator('body').innerText();
    assert(realText.includes('1,284'), 'expected the real captured text value (1,284), not the sample placeholder');
    assert(!realText.includes('(sample value)'), 'sample placeholder should be gone once a real run finished');
    console.log('[ok] Review shows the real extracted text after running the recording for real');

    const imgCount = await previewFrame.locator('img').count();
    assert(imgCount >= 1, 'expected an <img> element in the preview, not a raw base64 string');
    const imgSrc = await previewFrame.locator('img').first().getAttribute('src');
    assert(imgSrc?.startsWith('data:image/'), 'expected the <img> src to be the real captured screenshot data url');
    console.log('[ok] Review renders the real captured image as an actual <img>, not raw text');
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: report-real-preview-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
