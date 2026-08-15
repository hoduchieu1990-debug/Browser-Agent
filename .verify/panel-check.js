const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <h3>Order lookup</h3>
  <div>Total: <span id="total">1,284</span></div>
  <button id="go">Go</button>
  <table id="results" border="1" cellpadding="6" style="border-collapse:collapse;margin-top:12px">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody>
  </table>
</body></html>`;

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
    viewport: null,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });

    const page = await context.newPage();
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.bringToFront();

    // clicking the toolbar icon is what opens the panel now
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
    });
    await page.waitForTimeout(900);

    const host = page.locator('#__browser_agent_panel__');
    check('panel mounted in the page', (await host.count()) === 1);

    const frame = host.locator('iframe');
    const box = await frame.boundingBox();
    const viewport = page.viewportSize();
    console.log('  panel box:', box, 'viewport:', viewport);
    check('docked to the right edge', box !== null && Math.abs(box.x + box.width - viewport.width) <= 2,
      box ? `right edge at ${Math.round(box.x + box.width)} of ${viewport.width}` : 'no box');
    check('full height', box !== null && Math.abs(box.height - viewport.height) <= 2, box ? `${box.height}` : '');

    // the panel really is the recorder UI
    const panelFrame = page.frameLocator('#__browser_agent_panel__ iframe');
    check('panel shows the recorder UI', (await panelFrame.locator('.popup-header h2').textContent()) === 'Browser Agent');

    // ---- hide / show while working ----
    const handle = host.locator('button');
    check('handle says Hide while open', (await handle.textContent()).includes('Hide'));
    await handle.click();
    await page.waitForTimeout(400);
    check('panel hidden after clicking the handle', !(await frame.isVisible()));
    check('handle still reachable when hidden', await handle.isVisible(), await handle.textContent());

    await handle.click();
    await page.waitForTimeout(400);
    check('panel shown again', await frame.isVisible());

    // ---- recording still works with the panel open ----
    await panelFrame.locator('.record-btn.start').click();
    await page.waitForTimeout(600);

    await page.click('#go');
    await page.waitForTimeout(300);

    const badge = page.locator('#__browser_agent_add_badge__');
    await page.hover('#total');
    await page.waitForTimeout(400);
    await badge.locator('button', { hasText: 'Add' }).click();
    await page.waitForTimeout(200);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await page.waitForTimeout(400);

    // hovering our own panel must not be treated as page content
    await handle.hover();
    await page.waitForTimeout(500);
    const badgeOverPanel = await badge.isVisible().catch(() => false);
    check('Add badge does not appear over the panel', !badgeOverPanel);

    await panelFrame.locator('.record-btn.stop').click();
    await page.waitForTimeout(500);

    const types = await panelFrame.locator('.action-type').allTextContents();
    check('recorded through the panel', JSON.stringify(types) === JSON.stringify(['navigate', 'click', 'extractText']),
      types.join(', '));

    const clickedPanel = types.filter((t) => t === 'click').length;
    check('panel clicks were not recorded as page clicks', clickedPanel === 1, `${clickedPanel} click action(s)`);

    await page.screenshot({ path: path.join(__dirname, 'panel-docked.png') });
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
