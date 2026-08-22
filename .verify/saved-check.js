const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
  <button id="go">Go</button>
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
  context.on('page', (page) => page.on('dialog', (d) => d.accept()));

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    const extensionId = worker.url().split('/')[2];

    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const record = async (label) => {
      await testPage.bringToFront();
      await popup.click('text=Start');
      await testPage.waitForTimeout(400);
      await testPage.click('#go');
      await testPage.waitForTimeout(200);
      if (label === 'second') {
        const badge = testPage.locator('#__browser_agent_add_badge__');
        await testPage.hover('#total');
        await testPage.waitForTimeout(300);
        await badge.locator('button', { hasText: 'Add' }).click(); // open the menu first
        await testPage.waitForTimeout(150);
        await badge.locator('button', { hasText: 'Text value' }).click();
        await testPage.waitForTimeout(200);
      }
      await testPage.bringToFront();
      await popup.click('text=Stop');
      await popup.waitForTimeout(400);
    };

    // ---- session 1 ----
    await record('first');
    // ---- session 2 (starting a new one used to wipe the first) ----
    await record('second');

    await popup.click('text=Saved');
    await popup.waitForTimeout(300);

    const names = await popup.locator('.saved-name').allTextContents();
    const metas = await popup.locator('.saved-meta').allTextContents();
    console.log('saved recordings:', names.length);
    console.log('names:', names);
    console.log('metas:', metas);

    // ---- load the older (second in list) recording back ----
    await popup.locator('.saved-item').nth(1).locator('.saved-load').click();
    await popup.waitForTimeout(400);
    console.log('active tab after load is Preview:', await popup.locator('.sidebar-item.active').textContent());

    await popup.click('text=Record');
    await popup.waitForTimeout(200);
    console.log('loaded action types:', await popup.locator('.action-type').allTextContents());

    // ---- delete one ----
    await popup.click('text=Saved');
    await popup.waitForTimeout(200);
    await popup.locator('.saved-item').first().locator('.action-delete').click();
    await popup.waitForTimeout(400);
    console.log('saved after delete:', await popup.locator('.saved-item').count());

    // ---- survives extension restart? reopen popup ----
    await popup.reload();
    await popup.waitForTimeout(600);
    await popup.click('text=Saved');
    await popup.waitForTimeout(300);
    console.log('saved after popup reopen:', await popup.locator('.saved-item').count());

    await popup.setViewportSize({ width: 420, height: 500 });
    await popup.screenshot({ path: path.join(__dirname, 'saved-tab.png') });
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
