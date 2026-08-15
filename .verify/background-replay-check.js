const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
  <table id="results" border="1" cellpadding="6" style="border-collapse:collapse;margin-top:12px">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody>
  </table>
</body></html>`;

const OTHER = `<!doctype html><html><body style="padding:40px"><h1>Unrelated page I am reading</h1></body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url.startsWith('/other') ? OTHER : PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    const extensionId = worker.url().split('/')[2];

    const testPage = await context.newPage();
    await testPage.goto(`${base}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // ---------- record ----------
    await testPage.bringToFront();
    await popup.click('text=Start');
    await testPage.waitForTimeout(400);

    const badge = testPage.locator('#__browser_agent_add_badge__');
    await testPage.hover('#total');
    await testPage.waitForTimeout(300);
    await badge.locator('button', { hasText: 'Add' }).click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await testPage.waitForTimeout(250);

    await testPage.hover('td >> text=Alice');
    await testPage.waitForTimeout(300);
    await badge.locator('button', { hasText: 'Add' }).click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Table data' }).click();
    await testPage.waitForTimeout(250);

    // the whole point of this run: an image must come back from background mode too
    await testPage.hover('td >> text=Bob');
    await testPage.waitForTimeout(300);
    await badge.locator('button', { hasText: 'Add' }).click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Image' }).click();
    await testPage.waitForTimeout(250);

    await testPage.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(300);

    // ---------- the user navigates away to read something else ----------
    await testPage.goto(`${base}/other`);
    await testPage.bringToFront();
    const tabsBefore = context.pages().length;
    console.log('tabs before replay:', tabsBefore);
    console.log('page the user is looking at:', await testPage.locator('h1').textContent());

    // ---------- background replay ----------
    await popup.click('text=Preview');
    await popup.check('.replay-option input');
    await popup.click('.replay-btn');

    // The capture falls back to captureVisibleTab if the devtools route fails,
    // and that fallback happens to work here — so watch for a live debugger
    // session to prove which path actually ran.
    let sawDebuggerAttached = false;
    const watcher = (async () => {
      for (let i = 0; i < 60 && !sawDebuggerAttached; i++) {
        try {
          const targets = await worker.evaluate(() => chrome.debugger.getTargets());
          if (targets.some((t) => t.attached && t.type === 'page')) sawDebuggerAttached = true;
        } catch {
          /* worker busy */
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    })();

    await popup.locator('.result-block').first().waitFor({ timeout: 40000 });
    await watcher;
    console.log('devtools capture path used:', sawDebuggerAttached);
    await popup.waitForTimeout(1200); // let the hidden tab close

    const errCount = await popup.locator('.error-banner').count();
    if (errCount) console.log('ERROR:', (await popup.locator('.error-banner').textContent()).trim());

    console.log('steps:', await popup.locator('.step-row').allTextContents());
    console.log('variables:', await popup.locator('.result-name').allTextContents());
    console.log('text value:', await popup.locator('.result-value').first().textContent());
    console.log('table rows:', await popup.locator('.result-table tbody tr').count());

    const imageCount = await popup.locator('.result-image').count();
    console.log('image returned in background mode:', imageCount > 0);
    if (imageCount > 0) {
      const dataUrl = await popup.locator('.result-image').evaluate((img) => img.src);
      const info = await popup.locator('.result-image').evaluate((img) => ({ w: img.naturalWidth, h: img.naturalHeight }));
      console.log('image size:', info);
      require('fs').writeFileSync(
        path.join(__dirname, 'background-image.png'),
        Buffer.from(dataUrl.split(',')[1], 'base64'),
      );
    }

    console.log('--- did it disturb the user? ---');
    console.log('user page still showing:', await testPage.locator('h1').textContent());
    console.log('user page url unchanged:', testPage.url().endsWith('/other'));
    console.log('tabs after replay (hidden tab closed):', context.pages().length, '(was', tabsBefore + ')');

    await popup.setViewportSize({ width: 420, height: 640 });
    await popup.screenshot({ path: path.join(__dirname, 'background-replay.png') });
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
