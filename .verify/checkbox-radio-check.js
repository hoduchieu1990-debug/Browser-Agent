const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// A checkbox/radio's own .value is a static attribute ("on", an option id),
// never the checked state — recording it on 'change' produced a bogus extra
// `input` step that replayed as a no-op, alongside the real `click` step
// that already toggles it correctly. Covers the reported dropdown case too
// (a real checkbox inside a custom show/hide panel).
const PAGE = `<!doctype html><html><body style="padding:24px">
  <button id="ddTrigger" type="button">Filter</button>
  <div id="ddPanel" style="display:none">
    <label><input type="checkbox" id="chkA" /> Option A</label>
  </div>
  <label><input type="radio" name="r" id="radB" /> Radio B</label>
  <script>
    document.getElementById('ddTrigger').addEventListener('click', () => {
      const p = document.getElementById('ddPanel');
      p.style.display = p.style.display === 'none' ? 'block' : 'none';
    });
  </script>
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

    await tab.click('#ddTrigger');
    await tab.waitForTimeout(200);
    await tab.click('#chkA');
    await tab.waitForTimeout(300);
    await tab.click('#radB');
    await tab.waitForTimeout(300);

    await popup.click('.record-btn.stop');
    await tab.waitForTimeout(300);

    const actions = await popup.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      return state.actions;
    });
    console.log('[recorded]', JSON.stringify(actions.map((a) => ({ type: a.type, selector: a.selector }))));

    const chkSteps = actions.filter((a) => a.selector === '#chkA');
    const radSteps = actions.filter((a) => a.selector === '#radB');
    assert.strictEqual(chkSteps.length, 1, `expected exactly 1 step for the checkbox, got ${chkSteps.length}`);
    assert.strictEqual(chkSteps[0].type, 'click', `the checkbox's one step should be a click, got ${chkSteps[0].type}`);
    assert.strictEqual(radSteps.length, 1, `expected exactly 1 step for the radio, got ${radSteps.length}`);
    assert.strictEqual(radSteps[0].type, 'click', `the radio's one step should be a click, got ${radSteps[0].type}`);
    console.log('[ok] checkbox and radio each record exactly one click step, no bogus extra input step');

    await popup.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: checkbox-radio-check');
})();
