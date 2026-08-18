const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Regression coverage for two things:
//  1. isPositionOnly's short-circuit (hasNonPositionalSelector) must still
//     make the same "capture this element vs its container" decisions as
//     the old full-candidate-list check did.
//  2. Hovering stays responsive even on a pathological page: thousands of
//     elements that all share the same classes, forcing every hover through
//     generateSelectorCandidates' full fallback tail for anything that DOES
//     end up positional. This does not compare against a "before" baseline
//     (none is safe to keep around) — it asserts a generous absolute bound
//     instead, so a future regression that makes this slow again still trips
//     the check.
function heavyPage(n) {
  let rows = '';
  for (let i = 0; i < n; i++) {
    rows += `<div class="row card shadow-sm border rounded"><span class="label">Item ${i}</span></div>`;
  }
  return `<!doctype html><html><body style="padding:10px">
    <span id="price">$42.00</span>
    <div class="unique-wrap"><span>flagged text</span></div>
    ${rows}
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

    const frameVisible = () =>
      tab.evaluate(() => {
        const f = document.getElementById('__browser_agent_target_frame__');
        return f && f.style.display !== 'none' ? f.getBoundingClientRect() : null;
      });

    // --- Correctness: id'd element is captured directly, not its ancestor ---
    await tab.hover('#price');
    await tab.waitForFunction(
      () => {
        const f = document.getElementById('__browser_agent_target_frame__');
        return f && f.style.display !== 'none';
      },
      undefined,
      { timeout: 5000 },
    );
    const priceBox = await tab.locator('#price').boundingBox();
    const priceFrame = await frameVisible();
    assert(priceFrame, 'frame should be visible over #price');
    assert(Math.abs(priceFrame.width - priceBox.width) < 2, `expected frame to hug #price itself, got width ${priceFrame.width} vs ${priceBox.width}`);
    console.log('[ok] id-identifiable element captured directly (no unwanted climb)');

    // --- Correctness: a span whose class AND every ancestor's classes are
    // all rejected as shared (the pathological heavy-page case) has no
    // locatable path of its own, so preferLocatable must still climb to the
    // row div, exactly as it did before the short-circuit. ---
    await tab.mouse.move(5, 5);
    await tab.waitForTimeout(50);
    const rowTarget = tab.locator('.row').nth(500);
    await rowTarget.locator('.label').scrollIntoViewIfNeeded();
    await rowTarget.locator('.label').hover();
    await tab.waitForFunction(
      () => {
        const f = document.getElementById('__browser_agent_target_frame__');
        return f && f.style.display !== 'none';
      },
      undefined,
      { timeout: 5000 },
    );
    const rowBox = await rowTarget.boundingBox();
    const rowFrame = await frameVisible();
    assert(rowFrame, 'frame should be visible over the row');
    assert(Math.abs(rowFrame.width - rowBox.width) < 2, `expected frame to have climbed from the shared-class span to its row div, got width ${rowFrame.width} vs ${rowBox.width}`);
    console.log('[ok] span with no locatable path of its own still climbs to its row container');

    // --- Performance: heavy pathological page stays responsive ---
    await tab.mouse.move(5, 5);
    await tab.waitForTimeout(50);
    const target = tab.locator('.row .label').nth(1500);
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();

    const hops = [];
    for (let i = 0; i < 5; i++) {
      await tab.mouse.move(5, 5);
      await tab.waitForTimeout(30);
      const t0 = Date.now();
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.waitForFunction(
        () => {
          const f = document.getElementById('__browser_agent_target_frame__');
          return f && f.style.display !== 'none';
        },
        undefined,
        { timeout: 5000 },
      );
      hops.push(Date.now() - t0);
    }
    const avg = hops.reduce((a, b) => a + b, 0) / hops.length;
    console.log(`[perf] heavy-page hover latency: ${hops.join(',')}ms avg=${avg.toFixed(1)}ms`);
    assert(Math.max(...hops) < 2000, `hover latency spiked to ${Math.max(...hops)}ms on the heavy shared-class page`);
    console.log('[ok] heavy shared-class page stays responsive (max hop < 2000ms)');

    await popup.click('.record-btn.stop').catch(() => {});
    await popup.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: hover-perf-check');
})();
