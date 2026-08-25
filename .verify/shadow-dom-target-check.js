const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Reported on a real Nexacro page: the Add badge and its menu simply never
// appeared. Composed events (mousemove, contextmenu, click) are RETARGETED
// for any listener sitting outside a shadow tree the real hit element lives
// inside — event.target collapses to that tree's host. A shadow host's own
// .textContent does not include its shadow-rendered content either (it's a
// separate tree, not part of childNodes), so with raw event.target, hovering
// a value that lives inside an open shadow root resolved to an empty-text,
// non-interactive host: none of findTableAncestor/findTextTarget/
// findBatchTarget/findImageTarget matched anything, and the badge never
// showed up at all — exactly the reported symptom, and not specific to
// Nexacro's own markup, just to anything that puts a shadow boundary between
// the document and the value the user wants to capture.
const PAGE = `<!doctype html><html><body style="padding:40px;font-family:sans-serif">
  <div id="host" style="display:inline-block;border:1px solid #ccc"></div>
  <script>
    const host = document.getElementById('host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div style="padding:24px"><span id="price">$59.99</span></div>';
  </script>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'shadow-dom-profile'), {
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
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(500);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const frame = tab.locator('#__browser_agent_target_frame__');

    // Playwright's own locators pierce open shadow roots, so this finds the
    // real shadow-internal span the same way a user's eyes would.
    const priceBox = await tab.locator('#price').boundingBox();
    const hostBox = await tab.locator('#host').boundingBox();
    await tab.mouse.move(priceBox.x + priceBox.width / 2, priceBox.y + priceBox.height / 2);
    await tab.waitForTimeout(350);

    const badgeVisible = await badge.evaluate((el) => el.style.display !== 'none').catch(() => false);
    check('the Add badge appears when hovering a value inside an open shadow root', badgeVisible);

    const frameBox = await frame.boundingBox().catch(() => null);
    check('the target frame appears at all', !!frameBox, JSON.stringify(frameBox));
    if (frameBox) {
      const matchesPrice = Math.abs(frameBox.x - priceBox.x) < 4 && Math.abs(frameBox.width - priceBox.width) < 4;
      const matchesHostInstead = Math.abs(frameBox.width - hostBox.width) < 4;
      check(
        'the frame outlines the actual shadow-internal element, not the host',
        matchesPrice && !matchesHostInstead,
        `frame=${JSON.stringify(frameBox)} price=${JSON.stringify(priceBox)} host=${JSON.stringify(hostBox)}`,
      );
    }

    if (badgeVisible) {
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(150);
      const textOptionVisible = await badge
        .locator('button', { hasText: 'Text value' })
        .evaluate((el) => el.style.display !== 'none')
        .catch(() => false);
      check('"Text value" is offered for the shadow-internal element', textOptionVisible);
    }
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: shadow-dom-target-check');
    process.exit(1);
  }
  console.log('PASS: shadow-dom-target-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
