const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Answers: "if the data at the spot I Added changes by the time I replay,
// does the result reflect the NEW value at that same spot, not the old
// recorded one?" — record against one value, then serve a DIFFERENT value on
// the next request (as a real site's price/stock/search result would), and
// confirm replay reads the current page, not a cached answer from record time.
let requestCount = 0;
const server = http.createServer((_req, res) => {
  requestCount++;
  const price = requestCount === 1 ? '$19.99' : '$24.50'; // changed by the time we replay
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><html><body style="padding:40px">
    <div id="product">
      <span id="price">${price}</span>
    </div>
  </body></html>`);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'stale-value-refresh-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    await tab.goto(`http://127.0.0.1:${port}/`); // request #1: $19.99

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('text=Record');
    await popup.click('text=Start');
    await tab.waitForTimeout(400);

    const badge = tab.locator('#__browser_agent_add_badge__');
    await tab.hover('#price');
    await tab.click('#price', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(300);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(300);

    await tab.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(300);

    // Replay re-navigates to the same URL — request #2 lands, serving $24.50.
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.waitForSelector('.replay-btn:not([disabled])', { timeout: 15000 });
    await popup.waitForTimeout(300);

    const resultValue = await popup.locator('.result-value').first().textContent();
    console.log('[recorded at $19.99, page now serves $24.50]');
    console.log('[replay result]', resultValue);

    assert.strictEqual(resultValue?.trim(), '$24.50', 'expected the replay to read the CURRENT page value, not the one recorded originally');
    console.log('[ok] the result at the Added position reflects the current page data, not a stale value from record time');
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: stale-value-refresh-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
