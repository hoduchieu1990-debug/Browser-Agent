const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html><html><body style="padding:40px">
  <div>Total: <span id="total">1,284</span></div><button id="go">Go</button></body></html>`;

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

  // a native confirm() would show up here; nothing should
  let nativeDialog = null;
  context.on('page', (p) => p.on('dialog', (d) => { nativeDialog = d.message(); d.dismiss(); }));

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 420, height: 620 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // record a few actions so Reset has something to clear
    await page.bringToFront();
    await popup.click('.record-btn.start');
    await page.waitForTimeout(400);
    await page.click('#go');
    await page.waitForTimeout(200);
    await page.click('#go');
    await page.waitForTimeout(300);
    await page.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    const before = await popup.locator('.action-item').count();
    check('actions recorded', before >= 2, `${before}`);

    // ---- arm reset: inline confirm, no browser dialog ----
    await popup.click('.reset-btn');
    await popup.waitForTimeout(300);
    check('no native dialog appeared', nativeDialog === null, nativeDialog ?? '');
    check('inline confirm shown', await popup.locator('.reset-confirm').isVisible());
    console.log('  confirm text:', (await popup.locator('.reset-confirm').textContent()).trim());

    const confirmBox = await popup.locator('.reset-confirm').boundingBox();
    console.log('  confirm size:', confirmBox && `${Math.round(confirmBox.width)}x${Math.round(confirmBox.height)}`);
    check('confirm stays inside the popup row', confirmBox !== null && confirmBox.width < 220 && confirmBox.height < 30);

    await popup.screenshot({ path: path.join(__dirname, 'reset-confirm.png') });

    // ---- No keeps the actions ----
    await popup.locator('.reset-btn', { hasText: 'No' }).click();
    await popup.waitForTimeout(300);
    check('cancelling keeps the actions', (await popup.locator('.action-item').count()) === before);
    check('confirm dismissed', (await popup.locator('.reset-confirm').count()) === 0);

    // ---- Yes clears them ----
    await popup.click('.reset-btn');
    await popup.waitForTimeout(200);
    await popup.locator('.reset-btn', { hasText: 'Yes' }).click();
    await popup.waitForTimeout(400);
    check('confirming clears the actions', (await popup.locator('.action-item').count()) === 0);

    // ---- auto-disarm ----
    await popup.click('.record-btn.start');
    await page.bringToFront();
    await page.click('#go');
    await page.waitForTimeout(300);
    await page.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(300);
    await popup.click('.reset-btn');
    check('armed again', await popup.locator('.reset-confirm').isVisible());
    await popup.waitForTimeout(4600);
    check('auto-disarms after a few seconds', (await popup.locator('.reset-confirm').count()) === 0);
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
