const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const TEST_HTML = `<!doctype html>
<html><body style="padding:40px">
  <button id="save-btn" style="padding:10px 20px;">
    <span id="icon">💾</span>
    <span id="label">Save</span>
  </button>
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
    await testPage.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await testPage.bringToFront();
    await popup.click('text=Start');

    // hover the inner icon span, NOT the button itself
    await testPage.hover('#icon');
    await testPage.waitForTimeout(200);
    const outline = await testPage.locator('#save-btn').evaluate((el) => el.style.outline);
    const iconOutline = await testPage.locator('#icon').evaluate((el) => el.style.outline);
    console.log('button outline while hovering icon:', outline);
    console.log('icon outline while hovering icon:', iconOutline);

    // click the inner icon span
    await testPage.click('#icon');
    await popup.bringToFront();
    await popup.waitForTimeout(500);
    const selectorText = await popup.locator('.action-selector').first().textContent();
    console.log('recorded selector for click on inner icon:', selectorText);
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
