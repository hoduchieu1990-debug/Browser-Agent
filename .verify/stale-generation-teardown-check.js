const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Reported bug: after reloading the extension while a tab was already
// recording, Ctrl+Right-click silently did nothing on that tab, with the
// console showing "Cannot read properties of undefined (reading
// 'sendMessage')". Root cause: the pre-reload generation's extract-badge/
// highlighter listeners are plain DOM registrations that outlive the dead
// extension connection they were built with — nothing ever calls their own
// detach() — so a fresh re-injection's setRecording(true, ...) used to
// leave them running (its own `recorder` starts null regardless of what an
// earlier generation is still doing).
//
// window.__browserAgent* state lives in the content script's own isolated
// world, invisible to page.evaluate()/addInitScript() (those run in the
// page's main world) — chrome.scripting.executeScript with world:'ISOLATED'
// is what actually reaches it, same technique as
// extension-reload-recover-check.js.
const PAGE = `<!doctype html><html><body style="padding:40px"><button id="go">Go</button></body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'stale-generation-teardown-profile');

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

    // Plant a fake stale-generation teardown directly in the isolated world,
    // the same way a real pre-reload generation would have left one behind.
    await worker.evaluate(async (id) => {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'ISOLATED',
        func: () => {
          window.__oldGenerationCleanedUp = false;
          window.__browserAgentTeardown = () => {
            window.__oldGenerationCleanedUp = true;
          };
        },
      });
    }, tabId);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await popup.waitForTimeout(600);

    const cleanedUp = await worker.evaluate(async (id) => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'ISOLATED',
        func: () => window.__oldGenerationCleanedUp,
      });
      return result;
    }, tabId);
    check('starting a recording tears down whatever a previous generation left behind', cleanedUp === true);

    const hasNewTeardown = await worker.evaluate(async (id) => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'ISOLATED',
        func: () => typeof window.__browserAgentTeardown === 'function',
      });
      return result;
    }, tabId);
    check('a fresh teardown callback is registered for this generation', hasNewTeardown === true);

    // The system still works normally afterward.
    await tab.hover('#go');
    await tab.click('#go', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(300);
    const badge = tab.locator('#__browser_agent_add_badge__');
    const menuVisible = await badge.evaluate((el) => el.style.display !== 'none').catch(() => false);
    check('the menu still opens normally after recovering from a stale generation', menuVisible);
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
