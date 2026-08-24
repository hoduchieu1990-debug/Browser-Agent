const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Answers the user's question directly: if they type into a field and then
// click a button elsewhere (never pressing Enter), is that still recorded?
// Clicking anything else blurs the field first (native browser focus
// behavior), which fires `change` before the click's own handler runs — so
// this should already work via the existing blur-based recorder, with no
// code change needed. This proves it rather than assuming it.
const PAGE = `<!doctype html><html><body style="padding:40px">
  <input id="q" type="text" placeholder="Search…" />
  <button id="go" onclick="void 0">Search</button>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'input-button-profile'), {
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
    await tab.locator('#q').type('running shoes', { delay: 20 });
    await tab.locator('#go').click(); // no Enter — a plain button click instead

    await tab.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(300);

    const types = await popup.locator('.action-type').allTextContents();
    const selectors = await popup.locator('.action-selector').allTextContents();
    console.log('[recorded types]', types);
    console.log('[recorded selectors]', selectors);

    assert(types.includes('input'), 'expected the typed value to have been recorded even without pressing Enter');
    const inputIndex = types.indexOf('input');
    assert(selectors[inputIndex]?.includes('#q'), 'expected the input step to target the search field');
    const clickAfterInput = types.slice(inputIndex + 1).includes('click');
    assert(clickAfterInput, 'expected the button click to also be recorded, after the input step');
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: input-button-record-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
