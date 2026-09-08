const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Reported: "many actions like button clicks stop being recorded after a
// page transition." cross-page-capture-check.js already proves captures
// made through the Add badge survive a real navigation — this checks the
// OTHER, separate recording path: an ordinary click on a plain page button,
// recorded by action-recorder.ts's own document-level click listener, not
// the Add badge at all.
const PAGE = (label) => `<!doctype html><html><body style="padding:24px;font-family:sans-serif">
  <button id="btn">${label} button</button>
  <a id="next" href="/second">go to second</a>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE(req.url.startsWith('/second') ? 'PAGE2' : 'PAGE1'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'plain-click-nav-profile'), {
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
    await tab.setViewportSize({ width: 800, height: 600 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(600);

    await tab.click('#btn');
    await tab.waitForTimeout(300);

    await tab.click('#next');
    await tab.waitForLoadState();
    await tab.waitForTimeout(900);

    await tab.click('#btn');
    await tab.waitForTimeout(300);

    await popup.bringToFront();
    await popup.waitForTimeout(400);

    const actions = await popup.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      return state.actions;
    });
    console.log('[recorded]', JSON.stringify(actions.map((a) => ({ type: a.type, selector: a.selector }))));

    const clickSteps = actions.filter((a) => a.type === 'click' && a.selector === '#btn');
    check('the click before navigation was recorded', clickSteps.length >= 1, `got ${clickSteps.length}`);
    check(
      'the click after navigation was ALSO recorded, not silently dropped',
      clickSteps.length === 2,
      `expected 2 clicks on #btn (before + after navigation), got ${clickSteps.length}`,
    );

    await popup.click('.record-btn.stop').catch(() => {});
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: plain-click-across-navigation-check');
    process.exit(1);
  }
  console.log('PASS: plain-click-across-navigation-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
