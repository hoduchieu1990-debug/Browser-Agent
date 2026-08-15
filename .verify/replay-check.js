const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

// Two pages so the replay has to survive a real navigation: the recording
// clicks through from the search page to the results page, then captures data.
const PAGE1 = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <h3>Search</h3>
  <input id="q" placeholder="query" />
  <a id="go" href="/results">Go to results</a>
</body></html>`;

const PAGE2 = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <h3>Results</h3>
  <div>Total: <span id="total">1,284</span></div>
  <table id="results" border="1" cellpadding="6" style="border-collapse:collapse;margin-top:12px">
    <thead><tr><th>ID</th><th>Name</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>Alice</td><td>Done</td></tr>
      <tr><td>2</td><td>Bob</td><td>Pending</td></tr>
      <tr><td>3</td><td>Carol</td><td>Done</td></tr>
    </tbody>
  </table>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url.startsWith('/results') ? PAGE2 : PAGE1);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

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
    await testPage.setViewportSize({ width: 760, height: 500 });
    await testPage.goto(`${base}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // ---------- RECORD ----------
    await testPage.bringToFront();
    await popup.click('text=Start');
    await testPage.waitForTimeout(400);

    await testPage.fill('#q', 'widgets');
    await testPage.locator('#q').blur();
    await testPage.waitForTimeout(200);

    await testPage.click('#go');
    await testPage.waitForLoadState('load');
    await testPage.waitForTimeout(600);

    const badge = testPage.locator('#__browser_agent_add_badge__');

    await testPage.hover('#total');
    await testPage.waitForTimeout(300);
    await badge.locator('button', { hasText: 'Text' }).click();
    await testPage.waitForTimeout(300);

    await testPage.hover('td >> text=Alice');
    await testPage.waitForTimeout(300);
    await badge.locator('button', { hasText: 'Table' }).click();
    await testPage.waitForTimeout(300);

    await testPage.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(300);

    const recorded = await popup.locator('.action-type').allTextContents();
    console.log('recorded steps:', recorded);

    // ---------- REPLAY ----------
    await testPage.goto(`${base}/`); // back to the start so the replay must navigate again
    await testPage.bringToFront();

    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    console.log('replay started…');

    await popup.locator('.result-block').first().waitFor({ timeout: 30000 });
    await popup.waitForTimeout(500);

    const errorBanner = await popup.locator('.error-banner').count();
    if (errorBanner) console.log('ERROR:', await popup.locator('.error-banner').textContent());

    const names = await popup.locator('.result-name').allTextContents();
    console.log('captured variables:', names);

    const textValue = await popup.locator('.result-value').first().textContent();
    console.log('text value:', textValue);

    const headers = await popup.locator('.result-table th').allTextContents();
    const rows = await popup.locator('.result-table tbody tr').count();
    console.log('table headers:', headers, '| rows:', rows);

    console.log('final page url after replay:', testPage.url());

    await popup.setViewportSize({ width: 420, height: 620 });
    await popup.screenshot({ path: path.join(__dirname, 'replay-results.png') });
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
