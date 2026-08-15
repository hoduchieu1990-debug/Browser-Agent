const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html><html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <p id="a">Alpha value 111</p>
  <p id="b" style="margin-top:60px">Beta value 222</p>
  <p id="c" style="margin-top:60px">Gamma value 333</p>
</body></html>`;

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

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

    // ---------- follows the cursor ----------
    const a = centre(await page.locator('#a').boundingBox());
    await page.mouse.move(a.x, a.y);
    await page.waitForTimeout(300);
    const near1 = await trigger.boundingBox();
    const dist1 = Math.hypot(near1.x - a.x, near1.y - a.y);
    check('appears right next to the cursor', dist1 < 60, `${Math.round(dist1)}px away`);

    // move far to another element: it should come along
    const c = centre(await page.locator('#c').boundingBox());
    await page.mouse.move(c.x, c.y, { steps: 10 });
    await page.waitForTimeout(300);
    const near2 = await trigger.boundingBox();
    const dist2 = Math.hypot(near2.x - c.x, near2.y - c.y);
    check('follows the cursor to a new element', dist2 < 60, `${Math.round(dist2)}px away`);

    // ---------- holds still while you reach for it ----------
    const before = await trigger.boundingBox();
    const target = centre(before);
    await page.mouse.move(target.x, target.y, { steps: 8 }); // approach it
    await page.waitForTimeout(250);
    const after = await trigger.boundingBox();
    const drift = Math.hypot(after.x - before.x, after.y - before.y);
    check('stays put while the pointer moves onto it', drift < 2, `drifted ${Math.round(drift)}px`);

    // ---------- and can actually be clicked ----------
    await trigger.click();
    await page.waitForTimeout(300);
    check('menu opens from the click', await badge.locator('[data-ba-role="menu"]').isVisible());
    await page.screenshot({ path: path.join(__dirname, 'badge-follow.png') });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // ---------- does not vanish while you think ----------
    const b = centre(await page.locator('#b').boundingBox());
    await page.mouse.move(b.x, b.y);
    await page.waitForTimeout(300);
    check('visible after hovering a value', await badge.isVisible());
    await page.waitForTimeout(2500); // long pause, no mouse movement
    check('still there after a 2.5s pause', await badge.isVisible());

    // ---------- capturing still works ----------
    await trigger.click();
    await page.waitForTimeout(200);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await page.waitForTimeout(400);

    await popup.bringToFront();
    await popup.waitForTimeout(300);
    const types = await popup.locator('.action-type').allTextContents();
    const selectors = await popup.locator('.action-selector').allTextContents();
    check('captured the value under the cursor', types.includes('extractText'), types.join(', '));
    check('captured the right element', selectors.some((s) => s.includes('#b')), selectors.join(' | '));
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
