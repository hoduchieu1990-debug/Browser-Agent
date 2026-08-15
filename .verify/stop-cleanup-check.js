const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const TEST_HTML = `<!doctype html>
<html><body style="padding:40px"><button id="go">Click me</button></body></html>`;

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

    await testPage.hover('#go');
    await testPage.waitForTimeout(200);
    let overlay = await testPage.evaluate(() => {
      const el = document.getElementById('__browser_agent_highlight__');
      return el ? el.style.display : 'NOT FOUND';
    });
    console.log('overlay while recording + hovering:', overlay);

    await testPage.bringToFront(); // keep the real page "active" — the popup is an overlay in real Chrome, not a tab
    await popup.click('text=Stop');
    await popup.waitForTimeout(300);

    // move away then hover again — is the outline gone / does it stay stuck?
    await testPage.bringToFront();
    await testPage.mouse.move(10, 10);
    await testPage.waitForTimeout(100);
    overlay = await testPage.evaluate(() => {
      const el = document.getElementById('__browser_agent_highlight__');
      return el ? el.style.display : 'NOT FOUND (removed)';
    });
    console.log('overlay right after Stop:', overlay);

    await testPage.hover('#go');
    await testPage.waitForTimeout(200);
    overlay = await testPage.evaluate(() => {
      const el = document.getElementById('__browser_agent_highlight__');
      return el ? el.style.display : 'NOT FOUND (removed)';
    });
    console.log('overlay after Stop + hover again (should stay gone):', overlay);

    // clicking now should NOT be recorded
    await testPage.click('#go');
    await popup.bringToFront();
    await popup.waitForTimeout(300);
    const count = await popup.locator('.action-item').count();
    console.log('actions recorded after Stop + click (should be 0):', count);
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
