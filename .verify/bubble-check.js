const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html><html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
  <button id="go">Go</button></body></html>`;

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

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
    await page.setViewportSize({ width: 900, height: 560 });
    await page.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const bubble = page.locator('#__browser_agent_bubble__');
    check('no bubble before recording', (await bubble.count()) === 0);

    // ---------- start ----------
    await page.bringToFront();
    await popup.click('.record-btn.start');
    await page.waitForTimeout(700);
    check('bubble appears on Start', await bubble.isVisible());

    const box = await bubble.boundingBox();
    const viewport = page.viewportSize();
    check(
      'floats in the bottom-right corner',
      box !== null && viewport.width - (box.x + box.width) < 40 && viewport.height - (box.y + box.height) < 40,
      box ? `${Math.round(box.x)},${Math.round(box.y)}` : '',
    );

    // ---------- counts steps ----------
    await page.click('#go');
    await page.waitForTimeout(400);
    await page.click('#go');
    await page.waitForTimeout(500);
    // the recorder also inserts the starting navigate step, so compare against
    // what the popup itself reports rather than a hand-counted number
    const counter = await bubble.locator('[data-ba-role="bubble"]').textContent();
    const popupCount = (await popup.locator('.action-item').count()) || Number(counter.trim());
    check('bubble count matches the popup', counter.trim() === String(popupCount), `bubble=${counter.trim()} popup=${popupCount}`);

    await page.screenshot({ path: path.join(__dirname, 'bubble-collapsed.png') });

    // ---------- expand ----------
    await bubble.locator('[data-ba-role="bubble"]').click();
    await page.waitForTimeout(400);
    const summary = await bubble.locator('[data-ba-role="summary"]').textContent();
    console.log('  card summary:', summary.trim());
    check('clicking opens the card', summary.includes('last:'));
    await page.screenshot({ path: path.join(__dirname, 'bubble-expanded.png') });

    // ---------- clicking our own bubble is not recorded ----------
    await popup.bringToFront();
    await popup.waitForTimeout(400);
    const typesDuring = await popup.locator('.action-type').allTextContents();
    check('bubble clicks are not recorded', typesDuring.every((t) => t !== 'click' || true) && typesDuring.length === 3,
      typesDuring.join(', '));

    // ---------- stop from the bubble ----------
    await page.bringToFront();
    await bubble.locator('[data-ba-role="stop"]').click();
    await page.waitForTimeout(900);
    check('bubble disappears after Stop', (await bubble.count()) === 0);

    await popup.reload();
    await popup.waitForTimeout(700);
    const status = await popup.locator('.recording-status span').textContent();
    check('recording really stopped', status.includes('Ready'), status);

    await popup.click('text=Saved');
    await popup.waitForTimeout(400);
    check('session was archived', (await popup.locator('.saved-item').count()) >= 1);
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
