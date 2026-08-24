const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Reproduces the exact real-world case: the search button's mousedown
// handler calls preventDefault() specifically to keep the input focused
// (a common pattern so a suggestions dropdown does not close before the
// click registers) — so unlike search-enter-record-check.js (no Enter
// pressed there either, but a plain focusable button still blurs on click),
// here NEITHER blur/change NOR Enter ever fires. The only signal left is
// that a click landed elsewhere while the field was still focused and dirty.
const PAGE = `<!doctype html><html><body style="padding:40px">
  <input id="q" type="text" placeholder="Search…" />
  <button id="go">Search</button>
  <div id="results"></div>
  <script>
    document.getElementById('go').addEventListener('mousedown', (e) => e.preventDefault());
    document.getElementById('go').addEventListener('click', () => {
      document.getElementById('results').textContent = 'Results for: ' + document.getElementById('q').value;
    });
  </script>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'search-button-no-blur-profile'), {
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

    await tab.locator('#q').click();
    await tab.locator('#q').type('wireless mouse', { delay: 20 });

    const stillFocusedBefore = await tab.evaluate(() => document.activeElement?.id === 'q');
    assert(stillFocusedBefore, 'test setup: the field should be focused right before the click');

    await tab.locator('#go').click();
    await tab.waitForTimeout(300);

    // confirms the page's own preventDefault actually kept focus on #q,
    // proving this test exercises the no-blur case and not an ordinary one
    const stillFocusedAfter = await tab.evaluate(() => document.activeElement?.id === 'q');
    assert(stillFocusedAfter, 'test setup: mousedown preventDefault should have kept #q focused after the click');

    const resultText = await tab.locator('#results').textContent();
    assert.strictEqual(resultText, 'Results for: wireless mouse', 'test setup: the page should have actually run the search');

    await tab.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(300);

    const types = await popup.locator('.action-type').allTextContents();
    const selectors = await popup.locator('.action-selector').allTextContents();
    console.log('[recorded types]', types);
    console.log('[recorded selectors]', selectors);

    assert(types.includes('input'), 'expected the typed value to have been recorded even though the button kept focus on the field');
    const inputIndex = types.indexOf('input');
    assert(selectors[inputIndex]?.includes('#q'), 'expected the input step to target the search field');
    assert(types.slice(inputIndex + 1).includes('click'), 'expected the button click to also be recorded, after the input step');
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: search-button-no-blur-record-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
