const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');

// Recorded steps carry which framework drew the element (extension/src/utils/
// framework.ts) so a workflow read back later isn't just a list of anonymous
// <div> selectors. Metadata only — nothing in replay reads it — so the two
// things worth proving are that it lands on framework markup and that it
// stays OFF an ordinary page, where tagging every step would be noise.
const WEBSQUARE_PAGE = `<!doctype html>
<html><body>
  <div class="w2group">
    <input id="w2input_name" class="w2textbox" />
    <button id="w2btn">Search</button>
  </div>
</body></html>`;

const PLAIN_PAGE = `<!doctype html>
<html><body>
  <input id="name" />
  <button id="go">Search</button>
</body></html>`;

// Markup only, no runtime: the bridge's own data-ba-nexacro-id path is
// covered by nexacro-check.js, this pins the markup fallback beside it.
const NEXACRO_PAGE = `<!doctype html>
<html><body>
  <div class="nexacontainer">
    <div id="mainframe.form.edtName"></div>
    <button id="mainframe.form.btnGo">Search</button>
  </div>
</body></html>`;

async function record(context, extensionId, url) {
  const tab = await context.newPage();
  await tab.goto(url);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await tab.bringToFront();
  await popup.click('.record-btn.start');
  await tab.waitForTimeout(300);
  await tab.click('button');
  await tab.waitForTimeout(200);
  await popup.click('.record-btn.stop');
  await tab.waitForTimeout(200);

  const actions = await popup.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    return state.actions;
  });
  await popup.evaluate(async () => chrome.runtime.sendMessage({ type: 'RESET' }));
  await popup.close();
  await tab.close();
  return actions;
}

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const page = req.url.startsWith('/plain')
      ? PLAIN_PAGE
      : req.url.startsWith('/nexacro')
        ? NEXACRO_PAGE
        : WEBSQUARE_PAGE;
    res.end(page);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const profileDir = path.join(__dirname, 'profile-framework-tag');
  fs.rmSync(profileDir, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const w2Actions = await record(context, extensionId, `http://127.0.0.1:${port}/websquare`);
    console.log('[websquare page]', JSON.stringify(w2Actions));
    const w2Click = w2Actions.find((a) => a.type === 'click');
    assert(w2Click, 'expected a click step recorded on the WebSquare-style page');
    assert.strictEqual(w2Click.framework, 'websquare', `expected framework:'websquare', got: ${JSON.stringify(w2Click.framework)}`);
    console.log('[ok] a step recorded on WebSquare markup carries framework:"websquare"');

    const nexActions = await record(context, extensionId, `http://127.0.0.1:${port}/nexacro`);
    console.log('[nexacro page]', JSON.stringify(nexActions));
    const nexClick = nexActions.find((a) => a.type === 'click');
    assert(nexClick, 'expected a click step recorded on the Nexacro-style page');
    assert.strictEqual(nexClick.framework, 'nexacro', `expected framework:'nexacro', got: ${JSON.stringify(nexClick.framework)}`);
    console.log('[ok] a step recorded on Nexacro markup carries framework:"nexacro"');

    const plainActions = await record(context, extensionId, `http://127.0.0.1:${port}/plain`);
    console.log('[plain page]', JSON.stringify(plainActions));
    const plainClick = plainActions.find((a) => a.type === 'click');
    assert(plainClick, 'expected a click step recorded on the plain page');
    assert.strictEqual(plainClick.framework, undefined, `expected no framework tag on plain HTML, got: ${JSON.stringify(plainClick.framework)}`);
    console.log('[ok] an ordinary HTML step carries no framework tag');
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: framework-tag-check');
})().catch((err) => {
  console.error('FAILED:', err.stack || err.message || err);
  process.exit(1);
});
