const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

// Reproduces "the badge exists but the mouse can never reach it": hover a small
// value, then travel to the badge the way a human does — through the gap and
// over the parent container — and verify it is still there and clickable.
const TEST_HTML = `<!doctype html>
<html><body style="padding:60px;font-family:Segoe UI,sans-serif">
  <div id="row" style="padding:20px">Price: <span id="price">$129.99</span></div>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(TEST_HTML);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

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
    await testPage.setViewportSize({ width: 700, height: 400 });
    await testPage.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await testPage.bringToFront();
    await popup.click('text=Start');
    await testPage.waitForTimeout(300);

    const badge = testPage.locator('#__browser_agent_add_badge__');

    const priceBox = await testPage.locator('#price').boundingBox();
    await testPage.mouse.move(priceBox.x + priceBox.width / 2, priceBox.y + priceBox.height / 2);
    await testPage.waitForTimeout(250);

    const badgeBox = await badge.boundingBox();
    console.log('price box:', priceBox);
    console.log('badge box:', badgeBox);
    console.log('badge left-aligned with value:', Math.abs(badgeBox.x - priceBox.x) < 40);

    // walk the pointer step by step from the value up to the badge (crossing
    // the gap and the parent div on the way), like a real hand would
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const x = priceBox.x + ((badgeBox.x + badgeBox.width / 2 - priceBox.x) * i) / steps;
      const y = priceBox.y + ((badgeBox.y + badgeBox.height / 2 - priceBox.y) * i) / steps;
      await testPage.mouse.move(x, y);
      await testPage.waitForTimeout(40);
    }

    console.log('badge still visible after travelling to it:', await badge.isVisible());

    await testPage.mouse.down();
    await testPage.mouse.up();
    await testPage.waitForTimeout(400);

    await popup.bringToFront();
    await popup.waitForTimeout(300);
    console.log('recorded types:', await popup.locator('.action-type').allTextContents());
    console.log('recorded selectors:', await popup.locator('.action-selector').allTextContents());
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
