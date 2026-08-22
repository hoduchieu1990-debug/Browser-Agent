const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TEST_HTML = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <h3>Order results</h3>
  <div>Price: <span id="price">$129.99</span></div>
  <button id="go">Normal button</button>
  <table id="results" border="1" cellpadding="8" style="border-collapse:collapse;margin-top:16px">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>Alice</td></tr>
      <tr><td>2</td><td>Bob</td></tr>
    </tbody>
  </table>
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
    await testPage.setViewportSize({ width: 700, height: 420 });
    await testPage.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await testPage.bringToFront();
    await popup.click('text=Start');
    await testPage.waitForTimeout(300);

    const badge = testPage.locator('#__browser_agent_add_badge__');
    const tableBtn = badge.locator('button', { hasText: 'Table' });
    const textBtn = badge.locator('button', { hasText: 'Text' });

    // --- hover a plain text value -> only "Text" offered ---
    await testPage.hover('#price');
    await testPage.waitForTimeout(250);
    console.log('over #price  | badge:', await badge.isVisible(), '| table btn:', await tableBtn.isVisible(), '| text btn:', await textBtn.isVisible());
    await textBtn.click();
    await testPage.waitForTimeout(300);

    // --- hover a table cell -> both offered ---
    await testPage.hover('td >> text=Alice');
    await testPage.waitForTimeout(250);
    console.log('over table   | badge:', await badge.isVisible(), '| table btn:', await tableBtn.isVisible(), '| text btn:', await textBtn.isVisible());
    await testPage.screenshot({ path: path.join(__dirname, 'badge-both.png') });
    await tableBtn.click();
    await testPage.waitForTimeout(300);

    // --- normal click still recorded ---
    await testPage.click('#go');
    await testPage.waitForTimeout(300);

    await popup.bringToFront();
    await popup.waitForTimeout(300);
    console.log('recorded types:', await popup.locator('.action-type').allTextContents());

    await popup.click('text=Export');
    await popup.fill('.form-input', 'badge-test');
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('.export-btn')]);
    await download.saveAs(path.join(__dirname, 'workflow.json'));
    console.log(fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf-8'));
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
