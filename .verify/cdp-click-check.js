const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');

// Confirms replay dispatches a plain (non-Nexacro) click through the
// debugger (extension/src/utils/cdp-click.ts), not a synthetic DOM
// MouseEvent — the whole point is event.isTrusted === true, which some
// enterprise frameworks require and a synthetic click can't produce.
// Reuses nexacro-check.js's harness shape (real extension, real popup UI).
const PAGE = `<!doctype html>
<html><body>
  <button id="btn">Click</button>
  <div id="result"></div>
  <script>
    document.getElementById('btn').addEventListener('click', (e) => {
      document.getElementById('result').textContent = e.isTrusted ? 'trusted' : 'untrusted';
    });
  </script>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  // A dedicated profile, not the shared .verify/profile other checks reuse —
  // this one drives real replays through chrome.debugger, and leftover
  // replay/storage state from a previous run in a shared profile is exactly
  // the kind of thing that made this check flaky to develop against.
  const profileDir = path.join(__dirname, 'profile-cdp-click');
  fs.rmSync(profileDir, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];
    worker.on('console', (msg) => console.log('BG>', msg.text()));

    const tab = await context.newPage();
    tab.on('pageerror', (err) => console.log('PAGEERROR>', err.message));
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(300);
    await tab.click('#btn'); // recorded as a plain click step
    await tab.waitForTimeout(200);
    await popup.click('.record-btn.stop');
    await tab.waitForTimeout(200);

    // Isolate replay's own click from the one just used to record it.
    await tab.evaluate(() => {
      document.getElementById('result').textContent = '';
    });

    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.replay-btn:not([disabled])').waitFor({ timeout: 20000 });
    await tab.waitForTimeout(300);

    const resultText = await tab.locator('#result').textContent();
    console.log('[result]', resultText);
    assert.strictEqual(
      resultText,
      'trusted',
      `expected replay's click to be dispatched via the debugger (event.isTrusted === true), got: ${JSON.stringify(resultText)}`,
    );
    console.log('[ok] replay dispatches a plain click through chrome.debugger (Input.dispatchMouseEvent), not a synthetic DOM event');

    await popup.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: cdp-click-check');
})().catch((err) => {
  console.error('FAILED:', err.stack || err.message || err);
  process.exit(1);
});
