const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// A minimal stand-in for a Nexacro-rendered page: real DOM elements (so
// hover/click/change events fire normally), ids matching the dotted
// object-model path real Nexacro N uses (mainframe.form.componentId), wired
// to a fake window.nexacro.getApplication() tree — the API verified against
// a live Nexacro N app (demo.tobesoft.com). onclick is deliberately an
// object, not a function, matching what a real component exposes (calling
// it unconditionally is exactly the bug the corrected bridge avoids).
// Exercises both recording (hover -> component id, not a CSS selector) and
// replay (the extension actually calling set_value/click through the
// bridge, not just poking the DOM).
const USERNAME_ID = 'mainframe.form.edtUsername';
const LOGIN_ID = 'mainframe.form.btnLogin';
const PAGE = `<!doctype html>
<html><body style="padding:20px">
  <div id="${USERNAME_ID}" tabindex="0" style="border:1px solid #999;width:200px;height:24px;display:inline-block"></div>
  <div id="${LOGIN_ID}" style="border:1px solid #999;width:80px;height:24px;display:inline-block;margin-left:8px">Login</div>
  <div id="result"></div>
  <script>
    window._log = [];
    const edtUsername = {
      _type_name: 'TextField',
      value: '',
      set_value(v) { this.value = v; window._log.push(['set_value', 'edtUsername', v]); },
      setFocus() {},
      onchange() { window._log.push(['onchange', 'edtUsername']); },
    };
    const btnLogin = {
      _type_name: 'Button',
      click() {
        window._log.push(['click', 'btnLogin']);
        document.getElementById('result').textContent = 'clicked:' + edtUsername.value;
      },
      onclick: {}, // a real component's onclick is an EventHandler object, not a function
    };
    const app = { mainframe: { form: { edtUsername, btnLogin } } };
    window.nexacro = { getApplication: () => app };
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
    tab.on('console', (msg) => console.log('PAGE>', msg.text()));
    tab.on('pageerror', (err) => console.log('PAGEERROR>', err.message));
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(300);
    console.log('[recording status text]', await popup.locator('.recording-status span').textContent());
    const errBanner = await popup.locator('.error-banner').count();
    if (errBanner) console.log('[error banner]', await popup.locator('.error-banner').textContent());
    // the bridge marks components on a 500ms poll — give it a beat
    await tab.waitForTimeout(900);

    const bridgeState = await tab.evaluate(() => ({
      scriptTagExists: !!document.getElementById('__browser_agent_nexacro_bridge__'),
      hasNexacro: typeof (window).nexacro !== 'undefined',
    }));
    console.log('[bridge state]', JSON.stringify(bridgeState));

    const marked = await tab.evaluate(
      ({ usernameId, loginId }) => ({
        username: document.getElementById(usernameId).getAttribute('data-ba-nexacro-id'),
        login: document.getElementById(loginId).getAttribute('data-ba-nexacro-id'),
      }),
      { usernameId: USERNAME_ID, loginId: LOGIN_ID },
    );
    assert.strictEqual(marked.username, USERNAME_ID, 'bridge should mark the textbox with its component id');
    assert.strictEqual(marked.login, LOGIN_ID, 'bridge should mark the button with its component id');
    console.log('[ok] bridge marks Nexacro components with data-ba-nexacro-id');

    // --- Record: type into the fake TextBox, click the fake Button ---
    // Nexacro's own internal handling (not ours) is what would call
    // set_value() as the user types — dispatching 'change' alone, the way a
    // real DOM input would, never touches the component's own state.
    await tab.evaluate(({ usernameId }) => {
      window.nexacro.getApplication().mainframe.form.edtUsername.set_value('admin');
      document.getElementById(usernameId).dispatchEvent(new Event('change', { bubbles: true }));
    }, { usernameId: USERNAME_ID });
    await tab.waitForTimeout(200); // handleChange's get_value round trip is async
    await tab.click(`[id="${LOGIN_ID}"]`);
    await tab.waitForTimeout(200);

    await popup.click('.record-btn.stop');
    await tab.waitForTimeout(200);

    const recorded = await popup.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      return state.actions;
    });
    const nexacroActions = recorded.filter((a) => typeof a.selector === 'string' && a.selector.startsWith('nexacro:'));
    console.log('[recorded]', JSON.stringify(nexacroActions));

    const inputStep = nexacroActions.find((a) => a.type === 'input' && a.selector === `nexacro:${USERNAME_ID}`);
    const clickStep = nexacroActions.find((a) => a.type === 'click' && a.selector === `nexacro:${LOGIN_ID}`);
    assert(inputStep, `expected an input step recorded with selector nexacro:${USERNAME_ID}`);
    assert.strictEqual(inputStep.value, 'admin', 'recorded value should come from get_value(), not a raw DOM .value');
    assert(clickStep, `expected a click step recorded with selector nexacro:${LOGIN_ID}`);
    console.log('[ok] recording captures nexacro:<componentId> selectors with correct values, not CSS selectors');

    // --- Replay: drive it through the real Preview tab UI, foreground, same
    // as a user clicking Replay — the recorded leading `navigate` step
    // reloads the page fresh, resetting window._log/#result on its own. ---
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.replay-btn:not([disabled])').waitFor({ timeout: 20000 });
    await tab.waitForTimeout(300);

    const log = await tab.evaluate(() => window._log);
    const resultText = await tab.locator('#result').textContent();
    console.log('[replay log]', JSON.stringify(log));
    console.log('[result]', resultText);

    assert(log.some((e) => e[0] === 'set_value' && e[1] === 'edtUsername' && e[2] === 'admin'), 'replay should call comp.set_value("admin") through the bridge');
    assert(log.some((e) => e[0] === 'onchange' && e[1] === 'edtUsername'), 'replay should call comp.onchange() after set_value');
    assert(log.some((e) => e[0] === 'click' && e[1] === 'btnLogin'), 'replay should call comp.click() through the bridge');
    assert.strictEqual(resultText, 'clicked:admin', 'the fake app should observe the real component state, proving the bridge round-trip actually worked');
    console.log('[ok] replay calls comp.set_value/click through the bridge, not DOM events');

    await popup.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: nexacro-check');
})();
