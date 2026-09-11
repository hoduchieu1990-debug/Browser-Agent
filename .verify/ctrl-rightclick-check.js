const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Ctrl+Right-click should open the Add menu directly at the pointer without
// needing to travel to the floating badge button first, and the target
// frame's label should teach the shortcut.
const PAGE = `<!doctype html><html><body style="padding:60px;font-family:sans-serif">
  <span id="price">$42.00</span>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'ctrl-rightclick-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const results = [];
  const check = (name, passed, detail = '') => {
    results.push({ name, passed });
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('text=Record');
    await popup.click('text=Start');
    await tab.waitForTimeout(400);

    // Plain hovering costs the page nothing now: no target frame, no menu,
    // no ancestor walks — just the cheap outline highlighter.ts draws.
    const targetFrame = tab.locator('#__browser_agent_target_frame__');
    await tab.hover('#price');
    await tab.waitForTimeout(300);
    check('hovering alone draws no target frame', !(await targetFrame.isVisible()));

    const menu = tab.locator('#__browser_agent_add_badge__ [data-ba-role="menu"]');
    const menuVisibleBefore = await menu.evaluate((el) => el.style.display !== 'none').catch(() => false);
    check('the menu is not open yet', !menuVisibleBefore);

    await tab.click('#price', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(300);

    const menuVisibleAfter = await menu.evaluate((el) => el.style.display !== 'none').catch(() => false);
    check('Ctrl+Right-click opens the Add menu directly', menuVisibleAfter);

    const textItemVisible = await tab
      .locator('#__browser_agent_add_badge__ [data-ba-role="menu"] button', { hasText: 'Text value' })
      .evaluate((el) => el.style.display !== 'none')
      .catch(() => false);
    check('the menu offers "Text value" for the right-clicked element', textItemVisible);

    // Confirm a click through this menu actually records, same as the normal path.
    await tab.locator('#__browser_agent_add_badge__ button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(200);
    await tab.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(300);

    const types = await popup.locator('.action-type').allTextContents();
    console.log('[recorded types]', types);
    check('the choice made through the shortcut menu was recorded', types.includes('extractText'));
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: ctrl-rightclick-check');
    process.exit(1);
  }
  console.log('PASS: ctrl-rightclick-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
