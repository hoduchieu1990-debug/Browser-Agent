const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:24px;font-family:sans-serif">
  <div id="cellA" style="width:70px;height:32px;background:#eef">Alice</div>
  <div id="cellB" style="width:70px;height:32px;background:#efe;margin-top:200px">Bob</div>
</body></html>`;

async function run() {
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

    const tab = await context.newPage();
    await tab.setViewportSize({ width: 700, height: 700 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // Bypasses real cursor hit-testing (the badge itself can sit on top of
    // nearby elements) by firing the mousemove with its target set directly —
    // the same event shape handleMove reacts to either way.
    const dispatchMoveOn = (selector) =>
      tab.evaluate((sel) => {
        const el = document.querySelector(sel);
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(
          new MouseEvent('mousemove', { bubbles: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }),
        );
      }, selector);

    const captureViaAdd = async (label) => {
      const badge = tab.locator('#__browser_agent_add_badge__');
      const box = await badge.locator('[data-ba-role="add"]').boundingBox();
      await tab.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await tab.waitForTimeout(150);
      await badge.locator('button', { hasText: 'Text value' }).click();
      await tab.waitForTimeout(300);
      await tab.bringToFront();
      await popup.click('.record-btn.stop');
      await popup.waitForTimeout(400);
      const selector = await popup.locator('.action-selector').last().textContent();
      check(label, selector != null, selector ?? '(none)');
      return selector;
    };

    // ---- scenario 1: a quick pass over B, immediately followed by moving
    // back off it, must not leave B as the locked target ----
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(400);

    await dispatchMoveOn('#cellA');
    await tab.waitForTimeout(250); // let the badge lock onto A (first appearance is instant)
    await dispatchMoveOn('#cellB'); // schedules a retarget to B after RETARGET_DEBOUNCE_MS
    await dispatchMoveOn('#cellA'); // back on A well within the debounce window — cancels it
    await tab.waitForTimeout(300); // long enough that a non-cancelled timer would have fired

    const selector1 = await captureViaAdd('scenario 1 capture recorded');
    check('pass-through over B did not steal the target', selector1?.includes('cellA') ?? false, selector1 ?? '');

    // ---- scenario 2: genuinely settling on B (past the debounce, no move
    // back to A) must retarget to it ----
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(400);

    await dispatchMoveOn('#cellA');
    await tab.waitForTimeout(250);
    await dispatchMoveOn('#cellB');
    await tab.waitForTimeout(300); // past the debounce, nothing cancels it this time

    const selector2 = await captureViaAdd('scenario 2 capture recorded');
    check('settling on B genuinely retargets it', selector2?.includes('cellB') ?? false, selector2 ?? '');
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

run().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
