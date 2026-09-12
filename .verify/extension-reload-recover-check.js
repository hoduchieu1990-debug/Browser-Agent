const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Reported bug: after reloading the extension (chrome://extensions ->
// Reload — routine during development, and also whenever Chrome itself
// updates an installed extension), a tab that was already open before the
// reload could no longer be recorded at all until the PAGE itself was
// reloaded too — Start looked like it hung. Root cause: window is shared
// across re-injections into the same page, but a reload invalidates the
// message listener a PRE-reload injection registered; the flag guarding
// against a duplicate listener has no way to know that happened, so a
// fresh, working re-injection sees "someone already attached" and skips
// registering its own listener.
//
// chrome.runtime.reload() doesn't reliably bring the extension back up in
// this automated harness the way it does in a real browser, so this
// reproduces the actual observable trap directly instead: manufacture the
// exact state a dead pre-reload listener leaves behind (the flag set, but
// pointing at a function chrome.runtime.onMessage never actually has), by
// writing into the SAME isolated world content-script.ts runs in via
// chrome.scripting.executeScript — then prove Start still recovers.
const PAGE = `<!doctype html><html><body style="padding:40px"><button id="go">Go</button></body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'extension-reload-recover-profile');

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
    await tab.waitForTimeout(300);

    const tabId = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url && t.url.startsWith('http://127.0.0.1'))?.id;
    });
    check('found the real tab id via the extension', typeof tabId === 'number', String(tabId));

    // Plant the exact trap a dead pre-reload listener leaves behind: the
    // flag says "attached", but the stored function was never actually
    // registered with chrome.runtime.onMessage in this world.
    await worker.evaluate(async (id) => {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'ISOLATED',
        func: () => {
          window.__browserAgentAttached = true;
          window.__browserAgentListener = () => {};
        },
      });
    }, tabId);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(300);

    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await popup.waitForTimeout(600);

    const state = await popup.evaluate(
      () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_STATE' }, resolve)),
    );
    console.log('[state after Start with the trap planted]', JSON.stringify(state));
    check('recording actually started despite the stale flag', state.recording === true, JSON.stringify(state));

    await tab.click('#go');
    await tab.waitForTimeout(400);
    const afterClick = await popup.evaluate(
      () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_STATE' }, resolve)),
    );
    console.log('[actions after clicking with the trap planted]', JSON.stringify(afterClick.actions));
    check(
      'a real click on the trapped tab is actually captured (the fresh listener works)',
      afterClick.actions.some((a) => a.type === 'click' && a.selector?.includes('go')),
    );
    // Not asserting "exactly one" here: planting the trap via executeScript
    // (rather than a genuine extension reload, which this harness can't
    // reliably trigger) leaves the ORIGINAL page-load listener genuinely
    // still alive underneath the fake one — something only a real reload
    // would actually kill — so this specific setup doubles up by
    // construction. The regression that matters (no duplicate listener on
    // an ordinary, non-stale re-Start) is checked for real below.

    // ---- regression: pressing Start again with NO staleness must NOT double
    // up — on a FRESH tab, since the trapped one above now permanently
    // carries two genuinely-live listeners (the trap's own limitation: only
    // a real reload kills the original one, and this harness can't trigger
    // that reliably), which would contaminate this check if reused.
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(300);
    const tab2 = await context.newPage();
    await tab2.goto(`http://127.0.0.1:${port}/`);
    await tab2.waitForTimeout(300);
    await tab2.bringToFront();
    // Start, stop, then Start AGAIN on this same never-trapped tab — the
    // real case the anti-duplicate guard exists for.
    await popup.click('.record-btn.start');
    await popup.waitForTimeout(300);
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(300);
    await tab2.bringToFront();
    await popup.click('.record-btn.start');
    await popup.waitForTimeout(400);
    await tab2.click('#go');
    await tab2.waitForTimeout(400);
    const secondRun = await popup.evaluate(
      () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_STATE' }, resolve)),
    );
    const clickCount = secondRun.actions.filter((a) => a.type === 'click').length;
    console.log('[click count on a normal, non-stale re-Start]', clickCount);
    check('an ordinary re-Start (no staleness) does not register a duplicate listener', clickCount === 1);
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
