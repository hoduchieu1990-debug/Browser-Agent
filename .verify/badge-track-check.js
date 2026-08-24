const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Reproduces "the frame feels stuck/delayed": APPROACH_MARGIN_PX (34) used to
// exceed the badge's own appearance distance from the cursor (~25px, from its
// 18/18 offset), so the "don't re-aim while reaching for the badge" guard was
// already true the instant the badge appeared and stayed true through small
// moves — the target frame would not follow the cursor onto a nearby,
// different element until it moved far enough to clear that oversized zone.
const PAGE = `<!doctype html><html><body style="padding:60px;font-family:sans-serif">
  <span id="a" style="display:inline-block;padding:6px">Alpha</span>
  <span id="b" style="display:inline-block;padding:6px;margin-left:40px">Beta</span>
  <span id="c" style="display:inline-block;padding:6px;margin-left:40px">Gamma</span>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'badge-track-profile'), {
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
    await tab.setViewportSize({ width: 900, height: 400 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('text=Start');
    await tab.waitForTimeout(400);

    const frame = tab.locator('#__browser_agent_target_frame__');

    const centerOf = async (selector) => {
      const box = await tab.locator(selector).boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
    };

    // Land on "a" first so the badge appears there, at its usual offset.
    const a = await centerOf('#a');
    await tab.mouse.move(a.x, a.y);
    await tab.waitForTimeout(250);
    const frameOverA = await frame.boundingBox();
    check('frame appears over the first hovered element', frameOverA !== null, JSON.stringify(frameOverA));

    // Move directly to "b" — close enough (40px gap) that the old, oversized
    // approach margin swallowed this as "still reaching for the badge" and
    // left the frame parked over "a".
    const b = await centerOf('#b');
    await tab.mouse.move(b.x, b.y);
    await tab.waitForTimeout(250);
    const frameOverB = await frame.boundingBox();
    const bBox = b.box;
    const trackedB = frameOverB && Math.abs(frameOverB.x - bBox.x) < 4 && Math.abs(frameOverB.width - bBox.width) < 4;
    check(
      'frame follows immediately to a nearby different element (b)',
      trackedB,
      `frame=${JSON.stringify(frameOverB)} b=${JSON.stringify(bBox)}`,
    );

    // And again to "c", one more hop, to rule out this only working the first time.
    const c = await centerOf('#c');
    await tab.mouse.move(c.x, c.y);
    await tab.waitForTimeout(250);
    const frameOverC = await frame.boundingBox();
    const cBox = c.box;
    const trackedC = frameOverC && Math.abs(frameOverC.x - cBox.x) < 4 && Math.abs(frameOverC.width - cBox.width) < 4;
    check(
      'frame follows immediately to the next element too (c)',
      trackedC,
      `frame=${JSON.stringify(frameOverC)} c=${JSON.stringify(cBox)}`,
    );

    await popup.click('.record-btn.stop').catch(() => {});
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: badge-track-check');
    process.exit(1);
  }
  console.log('PASS: badge-track-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
