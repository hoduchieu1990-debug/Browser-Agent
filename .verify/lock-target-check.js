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
  <div id="cellB" style="width:70px;height:32px;background:#efe;margin-top:120px">Bob</div>
  <div id="cellC" style="width:70px;height:32px;background:#fee;margin-top:120px">Carol</div>
  <div id="cellD" style="position:absolute;top:24px;right:24px;width:70px;height:32px;background:#ffe">Dan</div>
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

    const badge = tab.locator('#__browser_agent_add_badge__');

    // Fires the mousemove *from* a given element (so detection resolves it
    // as the target) but with explicit coordinates, decoupling "which
    // element" from "how close to the badge" — real cursor movement can't
    // hit-test through the badge's own overlay reliably enough for that.
    const dispatchMoveFrom = (selector, clientX, clientY) =>
      tab.evaluate(
        ({ sel, x, y }) => {
          const el = document.querySelector(sel);
          el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
        },
        { sel: selector, x: clientX, y: clientY },
      );

    const dispatchMoveOn = async (selector) => {
      const box = await tab.locator(selector).boundingBox();
      await dispatchMoveFrom(selector, box.x + box.width / 2, box.y + box.height / 2);
      return box;
    };

    const startRecording = async () => {
      await tab.bringToFront();
      await popup.click('.record-btn.start');
      await tab.waitForTimeout(400);
    };

    const stopAndReadLastSelector = async () => {
      await tab.bringToFront();
      await popup.click('.record-btn.stop');
      await popup.waitForTimeout(400);
      return popup.locator('.action-selector').last().textContent();
    };

    // ---- fast recognition: hovering a fresh element must not wait out any
    // artificial debounce, unlike the earlier fix that slowed this down ----
    await startRecording();
    await dispatchMoveOn('#cellA');
    await tab.waitForTimeout(60);
    check('badge appears promptly on first hover', await badge.isVisible());

    await dispatchMoveOn('#cellB');
    await tab.waitForTimeout(60); // well under the old 150ms debounce
    const framedAfterFast = await tab.locator('#__browser_agent_target_frame__').boundingBox();
    const cellBBox = await tab.locator('#cellB').boundingBox();
    const sameBox = (a, b, tol = 3) =>
      a && b && Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.width - b.width) < tol;
    check('retargeting to a new element is just as fast, no debounce lag', sameBox(framedAfterFast, cellBBox));

    // ---- locked while the menu is open: a different element nearby must
    // not steal the target ----
    await dispatchMoveOn('#cellA');
    await tab.waitForTimeout(200);
    const triggerBox = await badge.locator('[data-ba-role="add"]').boundingBox();
    await tab.mouse.click(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
    await tab.waitForTimeout(150);

    const rootBox = await badge.boundingBox();
    const nearX = rootBox.x + rootBox.width / 2;
    const nearY = rootBox.y + rootBox.height + 20; // well inside the dismiss distance
    await dispatchMoveFrom('#cellB', nearX, nearY);
    await tab.waitForTimeout(150);
    check('menu stays open when the cursor stays close', await badge.locator('[data-ba-role="menu"]').isVisible());

    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(300);
    const selectorNear = await stopAndReadLastSelector();
    check('a nearby element did not steal the locked target', selectorNear?.includes('cellA') ?? false, selectorNear ?? '');

    // ---- moving well clear of the menu (no click needed) closes it and
    // immediately resumes fast, live targeting ----
    await startRecording();
    await dispatchMoveOn('#cellC');
    await tab.waitForTimeout(200);
    const triggerBox2 = await badge.locator('[data-ba-role="add"]').boundingBox();
    await tab.mouse.click(triggerBox2.x + triggerBox2.width / 2, triggerBox2.y + triggerBox2.height / 2);
    await tab.waitForTimeout(150);

    // cellD's own natural position is comfortably >120px from cellC's badge
    // and stays within the viewport, unlike an arbitrary large offset would.
    await dispatchMoveOn('#cellD');
    await tab.waitForTimeout(150);
    check('menu closes once the cursor clears out', !(await badge.locator('[data-ba-role="menu"]').isVisible()));

    const triggerBox3 = await badge.locator('[data-ba-role="add"]').boundingBox();
    await tab.mouse.click(triggerBox3.x + triggerBox3.width / 2, triggerBox3.y + triggerBox3.height / 2);
    await tab.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(300);
    const selectorFar = await stopAndReadLastSelector();
    check('moving away re-locked onto the new element', selectorFar?.includes('cellD') ?? false, selectorFar ?? '');
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
