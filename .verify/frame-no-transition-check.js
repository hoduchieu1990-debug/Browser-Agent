const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Reproduces the exact user report: the frame's JS position update was
// instant, but neither the badge root nor the target frame had
// transition:none set — a page with its own `* { transition: ... }` rule
// (common in real CSS resets/frameworks) made the box visibly slide to its
// new spot over that duration instead of jumping there, reading as lag no
// matter how fast the underlying event handling ran. A long, obvious 600ms
// transition here makes the bug impossible to miss if it regresses.
const PAGE = `<!doctype html><html><head>
  <style>* { transition: all 0.6s ease; }</style>
</head><body style="padding:60px;font-family:sans-serif">
  <span id="a" style="display:inline-block;padding:6px">Alpha</span>
  <span id="b" style="display:inline-block;padding:6px;margin-left:200px">Beta</span>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'frame-no-transition-profile'), {
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

    const frame = tab.locator('#__browser_agent_target_frame__');

    const centerOf = async (selector) => {
      const box = await tab.locator(selector).boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
    };

    const a = await centerOf('#a');
    await tab.hover('#a');
    await tab.click('#a', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(700); // let any transition settle before the real check

    const b = await centerOf('#b');
    await tab.keyboard.press('Escape');
    await tab.hover('#b');
    await tab.click('#b', { button: 'right', modifiers: ['Control'] });
    // Deliberately short — the page's own transition is 600ms, so if the
    // frame is animating instead of jumping, it will still be far from B's
    // position this soon after it is re-aimed.
    await tab.waitForTimeout(80);

    const frameBox = await frame.boundingBox();
    const withinB = frameBox && Math.abs(frameBox.x - b.box.x) < 6 && Math.abs(frameBox.width - b.box.width) < 6;
    console.log('[frame box 80ms after re-aiming at b]', frameBox);
    console.log('[b box]', b.box);
    assert(
      withinB,
      `expected the frame to already match "b" 80ms after re-aiming (no animation), got ${JSON.stringify(frameBox)} vs ${JSON.stringify(b.box)}`,
    );
    console.log('[ok] the frame jumps to the new position instantly even on a page with its own global transition rule');
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: frame-no-transition-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
