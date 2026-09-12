const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Reported bug, reproduced exactly: reloading the extension while a tab was
// already recording invalidates that generation's chrome.runtime binding —
// confirmed by directly overwriting it the same way a real reload does —
// but its recorder/highlighter/badge listeners are plain DOM registrations
// that keep firing regardless. Before this fix, the next click or
// Ctrl+Right-click on that tab threw "Cannot read properties of undefined
// (reading 'sendMessage')" from inside the dead generation's own handler,
// with nothing recorded and no visible menu. content-script.ts's capture()
// and the plain-click recording callback now check chrome.runtime.id first
// and self-detach (tear down their own listeners) instead of crashing.
const PAGE = `<!doctype html><html><body style="padding:40px"><button id="go">Go</button></body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'dead-runtime-self-detach-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    const pageErrors = [];
    tab.on('pageerror', (err) => pageErrors.push(err.message));
    await tab.goto(`http://127.0.0.1:${port}/`);
    await tab.waitForTimeout(300);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(500);

    const tabId = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url && t.url.startsWith('http://127.0.0.1'))?.id;
    });

    // The exact real-world condition: chrome.runtime becomes undefined in an
    // already-attached generation, the way a genuine extension reload does.
    await worker.evaluate(async (id) => {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'ISOLATED',
        func: () => {
          // @ts-ignore
          chrome.runtime = undefined;
        },
      });
    }, tabId);

    await tab.click('#go');
    await tab.waitForTimeout(300);
    check('a plain click on a dead-runtime generation throws no uncaught error', pageErrors.length === 0, JSON.stringify(pageErrors));

    await tab.hover('#go');
    await tab.click('#go', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(300);
    check('Ctrl+Right-click on a dead-runtime generation throws no uncaught error either', pageErrors.length === 0, JSON.stringify(pageErrors));

    const stillAttached = await worker.evaluate(async (id) => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'ISOLATED',
        func: () => window.__browserAgentAttached,
      });
      return result;
    }, tabId);
    // Cleared on self-detach specifically so the next fresh injection
    // re-registers unconditionally, not dependent on hasListener() alone —
    // Chrome may still say a dead generation's listener "is registered"
    // even once its own closure can no longer reach chrome.runtime.
    check('the attached flag is cleared so a fresh Start re-registers unconditionally', stillAttached === false);
    // Full recovery via a fresh Start after a genuine reload (a listener
    // Chrome itself now refuses to deliver to, rather than one whose own
    // closure was manually broken the way this test does it) is what
    // extension-reload-recover-check.js already covers end to end.
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
