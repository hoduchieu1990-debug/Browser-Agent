const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html><html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <p id="price">Price: 129.99</p>
  <table id="results" border="1" cellpadding="8" style="border-collapse:collapse;margin-top:24px">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td id="cell">Alice</td><td>Ops</td></tr></tbody>
  </table>
</body></html>`;

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const sameBox = (a, b, tol = 3) =>
  a && b && Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol &&
  Math.abs(a.width - b.width) < tol && Math.abs(a.height - b.height) < tol;

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
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await page.bringToFront();
    await popup.click('.record-btn.start');
    await page.waitForTimeout(600);

    const badge = page.locator('#__browser_agent_add_badge__');
    const trigger = badge.locator('[data-ba-role="add"]');
    const frame = page.locator('#__browser_agent_target_frame__');

    check('no frame before hovering', !(await frame.isVisible()));

    // ---------- hovering a value frames that value ----------
    const priceBox = await page.locator('#price').boundingBox();
    await page.mouse.move(priceBox.x + 40, priceBox.y + priceBox.height / 2);
    await page.waitForTimeout(350);

    check('frame appears with the badge', await frame.isVisible());
    check('frame outlines the hovered value', sameBox(await frame.boundingBox(), priceBox),
      JSON.stringify(await frame.boundingBox()));
    console.log('  label:', (await frame.locator('span').textContent()).trim());

    check('only one outline on screen',
      !(await page.locator('#__browser_agent_highlight__').isVisible()));

    await page.screenshot({ path: path.join(__dirname, 'frame-text.png') });

    // ---------- the frame stays locked while the menu is open, regardless
    // of which option is hovered ----------
    const cellBox = await page.locator('#cell').boundingBox();
    await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
    await page.waitForTimeout(350);
    await trigger.click();
    await page.waitForTimeout(300);

    const boxAtOpen = await frame.boundingBox();

    await badge.locator('button', { hasText: 'Table data' }).hover();
    await page.waitForTimeout(300);
    check('hovering "Table data" does not move the frame', sameBox(await frame.boundingBox(), boxAtOpen),
      JSON.stringify(await frame.boundingBox()));
    await page.screenshot({ path: path.join(__dirname, 'frame-table.png') });

    await badge.locator('button', { hasText: 'Text value' }).hover();
    await page.waitForTimeout(300);
    check('hovering "Text value" does not move the frame either', sameBox(await frame.boundingBox(), boxAtOpen),
      JSON.stringify(await frame.boundingBox()));

    // ---------- each option still captures its own correct target, even
    // though the frame preview no longer follows it ----------
    await badge.locator('button', { hasText: 'Table data' }).click();
    await page.waitForTimeout(400);
    check('frame clears after capturing', !(await frame.isVisible()));

    await popup.bringToFront();
    await popup.waitForTimeout(300);
    const selectors = await popup.locator('.action-selector').allTextContents();
    check('"Table data" still captured the whole table', selectors.some((s) => s.includes('#results')), selectors.join(' | '));
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
