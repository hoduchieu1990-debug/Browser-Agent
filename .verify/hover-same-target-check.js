const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// "Khung vẫn giật khi rê chuột" — a real mouse fires many mousemove events
// without ever leaving the element under the pointer (sub-pixel jitter, a
// slow drag). Before this fix, handleMove re-walked three separate ancestor
// chains and re-ran selector-uniqueness checks (querySelectorAll) on EVERY
// one of those events, even when the hovered element hadn't changed at all —
// pure waste that reads as stutter at real event rates even though each
// individual computeTargets call was already cheap in isolation.
//
// This asserts a RATIO rather than an absolute time so it stays valid across
// machines: repeatedly hitting the SAME element must cost much less per
// event than hitting a DIFFERENT element every time, since only the latter
// has anything new for computeTargets to find. Without the fix, every event
// pays the same cost regardless, so the ratio sits near 1.0.

const ROWS = 30;
const rowsHtml = Array.from(
  { length: ROWS },
  (_, i) => `<div class="row"><span class="label">Label ${i}</span><span class="value">Value-${i}</span></div>`,
).join('\n');
const PAGE = `<!doctype html><html><body style="font-family:sans-serif;padding:20px">
  <div id="list">${rowsHtml}</div>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'hover-same-target-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('text=Start');
    await tab.waitForTimeout(400);

    const { changingMs, steadyMs, iterations } = await tab.evaluate(() => {
      const values = Array.from(document.querySelectorAll('.value'));
      const rects = values.map((el) => {
        const r = el.getBoundingClientRect();
        return { el, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });

      const fire = (el, x, y) => {
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      };

      // Warm up BOTH access patterns before timing either one, and measure
      // steady-target first: if JIT warmup or engine-level caching from one
      // phase happened to make the other phase look artificially cheap, this
      // ordering makes it bias AGAINST the fix (the changing-target phase
      // would benefit from being measured second), not for it.
      for (let i = 0; i < rects.length; i++) fire(rects[i].el, rects[i].x, rects[i].y);
      fire(rects[0].el, rects[0].x, rects[0].y);
      fire(rects[0].el, rects[0].x, rects[0].y);

      const iterations = 300;

      const still = rects[0];
      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        fire(still.el, still.x, still.y);
      }
      const steadyMs = performance.now() - t0;

      const t1 = performance.now();
      for (let i = 0; i < iterations; i++) {
        const r = rects[i % rects.length];
        fire(r.el, r.x, r.y);
      }
      const changingMs = performance.now() - t1;

      return { changingMs, steadyMs, iterations };
    });

    const ratio = steadyMs / changingMs;
    console.log(`[changing-target] ${iterations} events, always a different element: ${changingMs.toFixed(2)}ms`);
    console.log(`[steady-target] ${iterations} events, the same element every time: ${steadyMs.toFixed(2)}ms`);
    console.log(`[ratio steady/changing] ${ratio.toFixed(3)}`);

    assert(
      ratio < 0.34,
      `expected repeatedly hovering the SAME element to cost well under hovering a DIFFERENT element every time (ratio < 0.34), got ${ratio.toFixed(3)} (changing=${changingMs.toFixed(2)}ms, steady=${steadyMs.toFixed(2)}ms)`,
    );
    console.log('[ok] steady-hover mousemove events skip the redundant ancestor walks');
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: hover-same-target-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
