const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body style="padding:40px"><button id="go">Click</button></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  // auto-accept the confirm() dialog for reset
  context.on('page', (page) => {
    page.on('dialog', (dialog) => dialog.accept());
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

    await testPage.click('#go');
    await testPage.click('#go');
    await testPage.click('#go');

    await popup.bringToFront();
    await popup.waitForTimeout(400);
    console.log('actions before reset:', await popup.locator('.action-item').count());

    await popup.click('.reset-btn');
    await popup.waitForTimeout(300);
    console.log('actions after reset:', await popup.locator('.action-item').count());

    const status = await popup.locator('.recording-status span').textContent();
    console.log('status after reset (should still be recording):', status);

    // recording should still be active — a click after reset should be captured
    await testPage.bringToFront();
    await testPage.click('#go');
    await popup.bringToFront();
    await popup.waitForTimeout(400);
    console.log('actions after reset + new click:', await popup.locator('.action-item').count());
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
