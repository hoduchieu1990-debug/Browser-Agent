const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

// Screenshots every popup screen at its real size, for eyeballing design changes.
const PAGE = `<!doctype html><html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
  <button id="go">Go</button>
  <table id="results" border="1" cellpadding="6" style="border-collapse:collapse;margin-top:12px">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody>
  </table></body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 460, height: 600 }); // Chrome's popup ceiling
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(400);
    await popup.screenshot({ path: path.join(__dirname, 'ui-empty.png') });

    await page.bringToFront();
    await popup.click('.record-btn.start');
    await page.waitForTimeout(500);
    await popup.screenshot({ path: path.join(__dirname, 'ui-recording.png') });

    await page.click('#go');
    await page.waitForTimeout(250);

    const badge = page.locator('#__browser_agent_add_badge__');
    await page.hover('#total');
    await page.waitForTimeout(400);
    await badge.locator('button', { hasText: 'Add' }).click();
    await page.waitForTimeout(200);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await page.waitForTimeout(300);

    await page.hover('td >> text=Alice');
    await page.waitForTimeout(400);
    await badge.locator('button', { hasText: 'Add' }).click();
    await page.waitForTimeout(200);
    await badge.locator('button', { hasText: 'Table data' }).click();
    await page.waitForTimeout(400);

    await page.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);
    await popup.screenshot({ path: path.join(__dirname, 'ui-record.png') });

    await page.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.result-block').first().waitFor({ timeout: 40000 });
    await popup.waitForTimeout(600);
    await popup.screenshot({ path: path.join(__dirname, 'ui-preview.png') });

    await popup.click('text=Export');
    await popup.waitForTimeout(300);
    await popup.screenshot({ path: path.join(__dirname, 'ui-export.png') });

    await popup.click('text=Settings');
    await popup.waitForTimeout(300);
    await popup.screenshot({ path: path.join(__dirname, 'ui-settings.png') });

    console.log('screenshots saved');
  } finally {
    await context.close();
    server.close();
  }
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
