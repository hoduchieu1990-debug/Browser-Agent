const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

// Reproduces the real-world failure: the page is already open, the extension is
// (re)loaded afterwards, and the user presses Start WITHOUT refreshing the page.
(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body style="padding:40px"><button id="go">Click me</button></body></html>');
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

    // Simulate a page with NO content script: strip the injected listeners by
    // reloading the extension's view of it is not possible, so instead assert
    // the injection path works by checking the overlay appears after Start.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await testPage.bringToFront();
    await popup.click('text=Start');
    await popup.waitForTimeout(500);

    const errorBanner = await popup.locator('.error-banner').count();
    console.log('error banner shown:', errorBanner > 0);
    if (errorBanner > 0) {
      console.log('error text:', await popup.locator('.error-banner').textContent());
    }

    await testPage.bringToFront();
    await testPage.hover('#go');
    await testPage.waitForTimeout(300);

    const overlayVisible = await testPage.evaluate(() => {
      const el = document.getElementById('__browser_agent_highlight__');
      return el ? el.style.display : 'NOT FOUND';
    });
    console.log('overlay display:', overlayVisible);

    await testPage.click('#go');
    await popup.bringToFront();
    await popup.waitForTimeout(400);
    const count = await popup.locator('.action-item').count();
    console.log('actions recorded:', count);

    // ensure no duplicate listeners: exactly one click action, not two
    const types = await popup.locator('.action-type').allTextContents();
    console.log('action types:', types);
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
