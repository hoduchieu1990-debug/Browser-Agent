const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// A JS-driven tooltip/popover — the common real-world case (including
// Nexacro's own custom widgets), which the in-browser replay's dispatched
// mouseover/mouseenter events can actually open. No mouseleave-hides-it
// handler on purpose: whether a popover re-closes when the pointer wanders
// off is a separate concern from what's under test here — that the hover
// step itself is recorded and that replaying it reveals the element a later
// step needs.
const PAGE = `<!doctype html><html><body style="padding:60px">
  <button id="trigger">Hover me</button>
  <div id="popover" style="display:none">
    <a id="hidden-link" href="#">Secret Link</a>
  </div>
  <script>
    document.getElementById('trigger').addEventListener('mouseenter', () => {
      document.getElementById('popover').style.display = 'block';
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
  const userDataDir = path.join(__dirname, 'hover-profile');

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

    const badge = tab.locator('#__browser_agent_add_badge__');

    // Hovering to right-click naturally opens the popover first, exactly like
    // a real user would encounter it while recording.
    await tab.hover('#trigger');
    await tab.click('#trigger', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(200);
    check('the menu offers "Hover"', await badge.locator('button', { hasText: 'Hover' }).isVisible());
    await badge.locator('button', { hasText: 'Hover' }).click();
    await tab.waitForTimeout(200);

    await tab.hover('#hidden-link');
    await tab.click('#hidden-link', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(200);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(200);

    await tab.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    const recorded = await popup.evaluate(
      () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_STATE' }, (s) => resolve(s.actions))),
    );
    console.log('[recorded]', JSON.stringify(recorded.map((a) => ({ type: a.type, selector: a.selector }))));
    check('a hover step was recorded before the extractText step', recorded.some((a) => a.type === 'hover'));

    // ---- reload the page so the popover starts closed again, then replay ----
    await tab.reload();
    await tab.waitForTimeout(300);

    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.step-row').last().waitFor({ timeout: 20000 });
    await popup.waitForTimeout(800);

    const stepRows = await popup.locator('.step-row').allTextContents();
    console.log('[replay steps]', JSON.stringify(stepRows));

    const hoverRow = stepRows.find((s) => s.includes('hover'));
    check('the hover step ran without failing', hoverRow && !/✕/.test(hoverRow), hoverRow);

    const extractRow = stepRows.find((s) => s.includes('extractText'));
    check(
      'the extractText step (on the element the hover revealed) also succeeded',
      extractRow && !/✕/.test(extractRow),
      extractRow,
    );

    const variables = await popup.evaluate(
      () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_REPLAY_STATE' }, (s) => resolve(s.variables))),
    );
    check('the captured text is the real hidden-link text', Object.values(variables).includes('Secret Link'), JSON.stringify(variables));
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
