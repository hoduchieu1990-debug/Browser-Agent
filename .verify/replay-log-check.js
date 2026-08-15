const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
  <button id="go">Go</button>
  <table id="results" border="1" cellpadding="6" style="border-collapse:collapse;margin-top:12px">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody>
  </table>
</body></html>`;

// Replay re-navigates to the starting URL, so a failure has to come from the
// page the server actually serves — deleting a node in the live DOM would just
// be undone by the reload.
let serveBrokenPage = false;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(serveBrokenPage ? PAGE.replace('<span id="total">1,284</span>', '<span>gone</span>') : PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  context.on('page', (page) => page.on('dialog', (d) => d.accept()));

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    const extensionId = worker.url().split('/')[2];

    const testPage = await context.newPage();
    await testPage.setViewportSize({ width: 700, height: 460 });
    await testPage.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // ---------- record: click + text + table ----------
    await testPage.bringToFront();
    await popup.click('text=Start');
    await testPage.waitForTimeout(400);

    await testPage.click('#go');
    await testPage.waitForTimeout(200);

    const badge = testPage.locator('#__browser_agent_add_badge__');
    const trigger = badge.locator('button', { hasText: 'Add' });

    await testPage.hover('#total');
    await testPage.waitForTimeout(300);
    await trigger.click(); // open the menu first
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await testPage.waitForTimeout(200);

    await testPage.hover('td >> text=Alice');
    await testPage.waitForTimeout(300);
    await trigger.click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Table data' }).click();
    await testPage.waitForTimeout(200);

    await testPage.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(300);

    // ---------- SUCCESS replay ----------
    await testPage.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.result-block').first().waitFor({ timeout: 30000 });
    await popup.waitForTimeout(600);

    console.log('--- SUCCESS RUN ---');
    console.log('steps:', await popup.locator('.step-row').allTextContents());
    console.log('variables:', await popup.locator('.result-name').allTextContents());
    await popup.setViewportSize({ width: 420, height: 640 });
    await popup.screenshot({ path: path.join(__dirname, 'replay-log-success.png') });

    // ---------- FAILURE replay: the page no longer has the element ----------
    serveBrokenPage = true;
    await testPage.bringToFront();
    await popup.click('.replay-btn');
    await popup.locator('.error-banner').waitFor({ timeout: 40000 });
    await popup.waitForTimeout(500);

    console.log('--- FAILURE RUN ---');
    console.log('error:', (await popup.locator('.error-banner').textContent()).trim());
    console.log('steps:', await popup.locator('.step-row').allTextContents());
    await popup.screenshot({ path: path.join(__dirname, 'replay-log-failure.png') });
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
