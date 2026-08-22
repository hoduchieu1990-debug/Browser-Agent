const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// CSS.escape only exists in a browser context, not plain Node.
function cssEscapeId(id) {
  return id.replace(/[.:#[\]()>,\s]/g, (c) => '\\' + c);
}

// Real Nexacro N apps id every DOM node with its full dotted component path
// (mainframe.WorkFrame.form...TextField00.box:simpleinput) — routinely
// 100-150+ characters, verified against a live Nexacro app
// (https://demo.tobesoft.com/). isStableId used to cap accepted ids at 40
// chars, which rejected these outright and fell all the way through to a
// fragile positional selector despite a perfectly good, stable id being
// right there. This uses a local page (not the live site — that's an
// external dependency this suite shouldn't take a hard hit on) with a
// same-shape long dotted id to keep the fix covered permanently.
const LONG_ID =
  'mainframe.WorkFrame.form.divWork.form.div_pageBase.form.div_page01.form.DivWrap.form.DivContents.form.Div06.form.TextField00.box:simpleinput';

const PAGE = `<!doctype html><html><body style="padding:24px">
  <input id="${LONG_ID}" class="nexainput" style="width:200px;height:32px" />
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'profile'), {
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

    await tab.locator(`#${cssEscapeId(LONG_ID)}`).fill('hello');
    await tab.locator(`#${cssEscapeId(LONG_ID)}`).dispatchEvent('change');
    await tab.waitForTimeout(300);

    await popup.click('.record-btn.stop').catch(() => {});
    await tab.waitForTimeout(200);

    const actions = await popup.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      return state.actions;
    });
    const step = actions.find((a) => a.type === 'input');
    console.log('[recorded selector]', step?.selector);

    assert(step, 'expected an input step to be recorded');
    assert.strictEqual(step.selector, `#${cssEscapeId(LONG_ID)}`, `expected the long dotted id as a plain #id selector, got ${step.selector}`);
    assert(!step.selector.includes(':nth-'), 'the primary selector must not be positional');
    console.log('[ok] a 140-char Nexacro-style dotted id is recognized as stable, not rejected for length');

    await popup.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: nexacro-long-id-check');
})();
