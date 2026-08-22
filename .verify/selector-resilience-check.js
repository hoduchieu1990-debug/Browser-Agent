const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// The reported failure: an element with no id, reached through a positional
// path like "div > div > div:nth-of-type(2) > div:nth-of-type(1) > pre".
// `extraWrapper` shifts the structure the way a real page would between visits.
const page = (extraWrapper, renameClasses) => `<!doctype html>
<html><body style="font-family:Segoe UI,sans-serif">
  <div id="app">
    <div class="toolbar"><button class="btn primary" aria-label="Run query">Run</button></div>
    ${extraWrapper ? '<div class="ad-banner">sponsored</div>' : ''}
    <div class="panel">
      <div class="output">
        <pre class="${renameClasses ? 'result-body-v2' : 'result-body'}">exit code 0</pre>
      </div>
    </div>
  </div>
</body></html>`;

let shifted = false;
let renamed = false;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page(shifted, renamed));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'profile');

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

    // ---------- record: click a button, capture the <pre> ----------
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(500);

    await tab.click('.btn.primary');
    await tab.waitForTimeout(250);

    const badge = tab.locator('#__browser_agent_add_badge__');
    await tab.hover('pre.result-body');
    await tab.waitForTimeout(400);
    await badge.locator('button', { hasText: 'Add' }).click();
    await tab.waitForTimeout(200);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(400);

    await tab.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    const selectors = await popup.locator('.action-selector').allTextContents();
    console.log('recorded selectors:', selectors);
    check(
      'no fragile positional path recorded',
      !selectors.some((s) => s.includes('nth-of-type') || /^div > div/.test(s)),
      selectors.join(' | '),
    );

    // ---------- the page shifts, then replay ----------
    shifted = true;
    await tab.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.result-block').first().waitFor({ timeout: 40000 });
    await popup.waitForTimeout(600);

    const errors = await popup.locator('.error-banner').count();
    check('replay survived the layout change', errors === 0, errors ? await popup.locator('.error-banner').textContent() : '');

    const steps = await popup.locator('.step-row').allTextContents();
    check('no step failed', !steps.some((s) => s.includes('✕')), steps.join(' | '));
    check('captured the value', (await popup.locator('.result-value').first().textContent())?.trim() === 'exit code 0');

    // ---------- force the primary selector to break outright ----------
    const fallbacks = await popup.evaluate(
      () =>
        new Promise((r) =>
          chrome.runtime.sendMessage({ type: 'GET_STATE' }, (s) =>
            r(s.actions.map((a) => ({ type: a.type, selector: a.selector, fallbacks: a.selectorFallbacks }))),
          ),
        ),
    );
    console.log('recorded with fallbacks:', JSON.stringify(fallbacks, null, 1));
    check(
      'fallback selectors were stored',
      fallbacks.some((a) => Array.isArray(a.fallbacks) && a.fallbacks.length > 0),
    );

    renamed = true; // the class the primary selector relies on is gone
    shifted = false;
    await tab.bringToFront();
    await popup.click('.replay-btn');
    await popup.locator('.result-block').first().waitFor({ timeout: 40000 });
    await popup.waitForTimeout(600);

    const errors2 = await popup.locator('.error-banner').count();
    const steps2 = await popup.locator('.step-row').allTextContents();
    check('replay recovered via a fallback selector', errors2 === 0, steps2.join(' | '));
    check(
      'value still captured after the class was renamed',
      (await popup.locator('.result-value').first().textContent())?.trim() === 'exit code 0',
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
