const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

const TEST_HTML = `<!doctype html>
<html><body>
<button id="go">Click me</button>
<input id="name" />
<select id="color"><option value="red">Red</option><option value="blue">Blue</option></select>
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
    console.log('Recording started');

    await testPage.click('#go');
    await testPage.evaluate(() => {
      const input = document.getElementById('name');
      input.value = 'Alice';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await testPage.selectOption('#color', 'blue');

    await popup.bringToFront();
    await popup.waitForTimeout(600);

    let items = await popup.locator('.action-item').count();
    console.log('Actions recorded:', items);

    // delete the first action (the click)
    await popup.locator('.action-item').first().locator('.action-delete').click();
    await popup.waitForTimeout(300);
    items = await popup.locator('.action-item').count();
    console.log('Actions after delete:', items);

    await popup.click('text=Stop');

    await popup.click('text=Export');
    await popup.fill('.form-input', 'edge-case-test');

    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('.export-btn')]);
    const savedPath = path.join(__dirname, 'workflow.json');
    await download.saveAs(savedPath);
    const workflowJson = fs.readFileSync(savedPath, 'utf-8');
    console.log('--- Exported workflow.json ---');
    console.log(workflowJson);
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err);
  process.exit(1);
});
