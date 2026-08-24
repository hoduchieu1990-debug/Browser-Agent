const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Reproduces "I type into a search box but nothing gets recorded": a live
// search box answers Enter with its own JS and never blurs the field, so the
// recorder's `change` listener (which only fires on blur) never fires either
// — the typed value silently never became a step.
const PAGE = `<!doctype html><html><body style="padding:40px">
  <input id="q" type="search" placeholder="Search…" />
  <div id="results"></div>
  <script>
    document.getElementById('q').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault(); // an SPA search box does this and stays focused
      document.getElementById('results').textContent = 'Results for: ' + e.target.value;
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
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'search-enter-profile'), {
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
    await tab.locator('#q').type('laptop deals', { delay: 20 });
    await tab.locator('#q').press('Enter');
    await tab.waitForTimeout(300);

    // still focused, exactly the case that used to record nothing
    const stillFocused = await tab.evaluate(() => document.activeElement?.id === 'q');
    assert(stillFocused, 'test setup: the field should still be focused after Enter (no blur)');

    await tab.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(300);

    const types = await popup.locator('.action-type').allTextContents();
    const selectors = await popup.locator('.action-selector').allTextContents();
    console.log('[recorded types]', types);
    console.log('[recorded selectors]', selectors);

    assert(types.includes('input'), 'expected an "input" step to have been recorded from the Enter-submitted search');
    const inputIndex = types.indexOf('input');
    assert(selectors[inputIndex]?.includes('#q'), 'expected the input step to target the search field');
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: search-enter-record-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
