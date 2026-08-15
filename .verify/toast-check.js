const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const TEST_HTML = `<!doctype html>
<html><body style="padding:40px">
  <button id="go">Click me</button>
  <input id="name" />
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

    await testPage.click('#go');
    await testPage.waitForTimeout(200);
    const toastText1 = await testPage.locator('#__browser_agent_toast_container__ div').first().textContent();
    console.log('toast after click:', toastText1);

    await testPage.evaluate(() => {
      const input = document.getElementById('name');
      input.value = 'Alice';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await testPage.waitForTimeout(200);
    const toasts = await testPage.locator('#__browser_agent_toast_container__ div').allTextContents();
    console.log('toasts after input:', toasts);

    // step numbers in popup
    await popup.bringToFront();
    await popup.waitForTimeout(300);
    const steps = await popup.locator('.action-step').allTextContents();
    console.log('popup step numbers:', steps);

    // toast should auto-dismiss
    await testPage.waitForTimeout(2200);
    const remaining = await testPage.locator('#__browser_agent_toast_container__ div').count();
    console.log('toasts remaining after 2.2s:', remaining);
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
