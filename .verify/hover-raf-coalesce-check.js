const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// A real mouse fires far more mousemove events per second than the screen
// repaints. hover-perf-check.js already proves a single hover is fast; this
// proves a FAST CONTINUOUS SWEEP (Playwright's multi-step mouse.move, which
// dispatches dozens of mousemove events in quick succession, closer to how a
// real mouse behaves) stays smooth on a heavy page, and — the part that
// actually matters to the user — that Add still captures the correct,
// most-recently-hovered element after the sweep, not a stale one from
// mid-sweep.
function heavyPage(n) {
  let rows = '';
  for (let i = 0; i < n; i++) {
    rows += `<div class="row card shadow-sm border rounded"><span class="label">Item ${i}</span></div>`;
  }
  return `<!doctype html><html><body style="padding:10px">
    <span id="start">start</span>
    ${rows}
    <span id="finish">finish line</span>
    <div style="height:400px"></div>
  </body></html>`;
}

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(heavyPage(3000));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    await tab.setViewportSize({ width: 900, height: 700 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(700);

    // Scroll to #finish FIRST — measuring #start before this scroll would
    // capture coordinates the scroll immediately invalidates.
    const finishEl = tab.locator('#finish');
    // block:'center' (not scrollIntoViewIfNeeded's default nearest-edge)
    // leaves room below for the Add menu to render on-screen.
    await finishEl.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const finishBox = await finishEl.boundingBox();
    const startBox = await tab.locator('#start').boundingBox();

    await tab.mouse.move(startBox.x, startBox.y);
    await tab.waitForTimeout(50);

    // A real continuous sweep: ~60 mousemove events fired in quick
    // succession as the pointer travels from #start to #finish.
    const t0 = Date.now();
    await tab.mouse.move(finishBox.x + finishBox.width / 2, finishBox.y + finishBox.height / 2, { steps: 60 });
    // The frame can already be visible from mid-sweep (an earlier row) the
    // instant mouse.move() resolves — wait for it to actually SETTLE on the
    // real final target's width, not just for "visible" to flip true once.
    await tab
      .waitForFunction(
        (expectedWidth) => {
          const f = document.getElementById('__browser_agent_target_frame__');
          return f && f.style.display !== 'none' && Math.abs(f.getBoundingClientRect().width - expectedWidth) < 2;
        },
        finishBox.width,
        { timeout: 5000 },
      )
      .catch(() => {});
    const sweepMs = Date.now() - t0;
    console.log(`[perf] 60-step sweep across heavy page settled in ${sweepMs}ms`);

    const frameBox = await tab.evaluate(() => {
      const f = document.getElementById('__browser_agent_target_frame__');
      const r = f.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    assert(
      Math.abs(frameBox.width - finishBox.width) < 2,
      `expected the frame to settle on #finish (width ${finishBox.width}), got width ${frameBox.width}`,
    );
    console.log('[ok] frame settles on the actual final hover target after a fast sweep, not a stale mid-sweep one');

    // The part the user explicitly cares about: Add must still capture
    // whatever the pointer is over right now, unaffected by the coalescing.
    await tab.hover('#finish');
    await tab.waitForTimeout(150);
    await tab.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(150);
    await tab.locator('button', { hasText: 'Text value' }).click({ force: true });
    await tab.waitForTimeout(200);

    const actions = await popup.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      return state.actions;
    });
    const last = actions[actions.length - 1];
    console.log('[recorded]', JSON.stringify(last));
    assert.strictEqual(last?.selector, '#finish', `Add should have captured #finish, got ${last?.selector}`);
    console.log('[ok] Add still captures the correct, most-recently-hovered element after a fast sweep');

    await popup.click('.record-btn.stop').catch(() => {});
    await popup.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: hover-raf-coalesce-check');
})();
