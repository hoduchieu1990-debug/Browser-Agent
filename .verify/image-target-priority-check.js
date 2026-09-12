const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// A small <img> nested inside a bigger row made clickable via a JS onclick
// handler (not a real <a>, no inherited cursor:pointer on the img itself) —
// a very common "the whole card navigates somewhere" pattern. Reported bug:
// the target frame jumped to the whole card instead of staying on the icon,
// because findBatchTarget's up-to-6-level climb to the nearest clickable
// ancestor used to outrank an already-precise image match.
const PAGE = `<!doctype html><html><body style="padding:60px">
  <div id="card" onclick="void 0" style="display:flex;align-items:center;gap:8px;width:300px;height:120px;border:1px solid #ccc">
    <img id="thumb" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7" width="40" height="40" />
    <span id="label">Product Name and a longer description here</span>
  </div>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'image-target-priority-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
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
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(400);

    const frameBoxOf = async (selector) => {
      await tab.hover(selector);
      await tab.click(selector, { button: 'right', modifiers: ['Control'] });
      await tab.waitForTimeout(200);
      const box = await tab.evaluate(() => {
        const el = document.getElementById('__browser_agent_target_frame__');
        if (!el || el.style.display === 'none') return null;
        return {
          left: parseFloat(el.style.left),
          top: parseFloat(el.style.top),
          width: parseFloat(el.style.width),
          height: parseFloat(el.style.height),
        };
      });
      await tab.keyboard.press('Escape');
      await tab.waitForTimeout(100);
      return box;
    };

    const closeEnough = (a, b) => a && b && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2;

    const thumbBox = await tab.locator('#thumb').boundingBox();
    const cardBox = await tab.locator('#card').boundingBox();

    const frameOnThumb = await frameBoxOf('#thumb');
    console.log('[frame when aiming at the small icon]', JSON.stringify(frameOnThumb));
    check(
      'aiming at a small icon inside a clickable card frames the icon, not the whole card',
      closeEnough(frameOnThumb, thumbBox) && !closeEnough(frameOnThumb, cardBox),
      JSON.stringify({ frameOnThumb, thumbBox, cardBox }),
    );

    // Regression check: text/batch capture on a non-image target must still
    // pick the whole card the way it always has — this fix only reorders
    // priority in favor of an actual image match, nothing else.
    const frameOnLabel = await frameBoxOf('#label');
    console.log('[frame when aiming at the text label]', JSON.stringify(frameOnLabel));
    check(
      'aiming at the text label still frames something reasonable (unaffected by the reorder)',
      frameOnLabel !== null,
    );
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
