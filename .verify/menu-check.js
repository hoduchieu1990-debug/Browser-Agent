const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PAGE = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
  <table id="results" border="1" cellpadding="6" style="border-collapse:collapse;margin-top:14px">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody>
  </table>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
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
    await testPage.setViewportSize({ width: 700, height: 460 });
    await testPage.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await testPage.bringToFront();
    await popup.click('text=Start');
    await testPage.waitForTimeout(400);

    const badge = testPage.locator('#__browser_agent_add_badge__');
    const trigger = badge.locator('button', { hasText: 'Add' });

    // ---- text value: menu must hide the table option ----
    await testPage.hover('#total');
    await testPage.waitForTimeout(300);
    await trigger.click();
    await testPage.waitForTimeout(200);
    await testPage.screenshot({ path: path.join(__dirname, 'menu-open.png') });
    console.log('table option visible over plain text:', await badge.locator('button', { hasText: 'Table data' }).isVisible());
    await badge.locator('button', { hasText: 'Text value' }).click();
    await testPage.waitForTimeout(300);

    // ---- table: all three options ----
    await testPage.hover('td >> text=Alice');
    await testPage.waitForTimeout(300);
    await trigger.click();
    await testPage.waitForTimeout(200);
    console.log('over a table -> table option visible:', await badge.locator('button', { hasText: 'Table data' }).isVisible());
    await badge.locator('button', { hasText: 'Table data' }).click();
    await testPage.waitForTimeout(300);

    // ---- image of the table area ----
    await testPage.hover('td >> text=Bob');
    await testPage.waitForTimeout(300);
    await trigger.click();
    await testPage.waitForTimeout(200);
    await badge.locator('button', { hasText: 'Image' }).click();
    await testPage.waitForTimeout(300);

    await testPage.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(400);
    console.log('recorded types:', await popup.locator('.action-type').allTextContents());

    // ---- replay: image must come back as a real picture ----
    await testPage.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.result-image').waitFor({ timeout: 40000 });
    await popup.waitForTimeout(600);

    const errCount = await popup.locator('.error-banner').count();
    if (errCount) console.log('ERROR:', (await popup.locator('.error-banner').textContent()).trim());

    console.log('steps:', await popup.locator('.step-row').allTextContents());
    console.log('variables:', await popup.locator('.result-name').allTextContents());

    const imgInfo = await popup.locator('.result-image').evaluate((img) => ({
      w: img.naturalWidth,
      h: img.naturalHeight,
      prefix: img.src.slice(0, 22),
    }));
    console.log('captured image:', imgInfo);

    await popup.setViewportSize({ width: 420, height: 680 });
    await popup.screenshot({ path: path.join(__dirname, 'menu-results.png') });

    // ---- exported workflow must still validate ----
    await popup.click('text=Export');
    await popup.fill('.form-input', 'menu-test');
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
