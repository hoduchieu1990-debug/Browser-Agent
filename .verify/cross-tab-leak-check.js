const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE_A = `<!doctype html><html><body style="font-family:sans-serif">
  <div>Site A</div><button id="a-btn">A button</button>
</body></html>`;
const PAGE_B = `<!doctype html><html><body style="font-family:sans-serif">
  <div>Site B</div><button id="b-btn">B button</button>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url.startsWith('/b') ? PAGE_B : PAGE_A);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'cross-tab-leak-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    // A pre-existing, already-loaded second tab — set up BEFORE recording starts,
    // exactly like the user's real scenario (24h.com.vn already open in another tab).
    const tabB = await context.newPage();
    await tabB.goto(`http://127.0.0.1:${port}/b`);

    const tabA = await context.newPage();
    await tabA.goto(`http://127.0.0.1:${port}/a`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await tabA.bringToFront();
    await popup.click('.record-btn.start');
    await tabA.waitForTimeout(400);

    await tabA.click('#a-btn');
    await tabA.waitForTimeout(250);

    // Switch to the pre-existing tab B (no navigation event fires) and click there.
    await tabB.bringToFront();
    await tabB.waitForTimeout(300);
    await tabB.click('#b-btn');
    await tabB.waitForTimeout(300);

    // Back to tab A, one more click, then stop.
    await tabA.bringToFront();
    await tabA.click('#a-btn');
    await tabA.waitForTimeout(250);

    await popup.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    const recorded = await popup.evaluate(
      () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_STATE' }, (s) => resolve(s.actions))),
    );
    console.log('recorded:', JSON.stringify(recorded.map((a) => ({ type: a.type, selector: a.selector, url: a.url }))));

    check(
      'no navigate step to site B was recorded',
      !recorded.some((a) => a.type === 'navigate' && a.url && a.url.includes('/b')),
    );
    check(
      'no click from the unrelated tab B leaked into the recording',
      !recorded.some((a) => a.selector === '#b-btn'),
    );
    check(
      'both clicks from the actual recording tab (A) were captured',
      recorded.filter((a) => a.selector === '#a-btn').length === 2,
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
