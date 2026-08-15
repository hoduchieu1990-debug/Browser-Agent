const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html><html><body style="padding:40px"><h1>Test page</h1></body></html>`;

// Playwright cannot click the browser toolbar, so verify the pieces the click
// depends on: the service worker booted, the listener is registered, and the
// handler it would call actually mounts the panel.
(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const swErrors = [];
  context.on('weberror', (e) => swErrors.push(String(e.error())));

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    worker.on('console', (msg) => {
      if (msg.type() === 'error') swErrors.push(msg.text());
    });

    const listeners = await worker.evaluate(() => ({
      actionOnClicked: chrome.action.onClicked.hasListeners(),
      commandsOnCommand: chrome.commands.onCommand.hasListeners(),
      runtimeOnMessage: chrome.runtime.onMessage.hasListeners(),
      commandsRegistered: typeof chrome.commands.getAll === 'function',
    }));
    console.log('service worker listeners:', listeners);

    const commands = await worker.evaluate(() => chrome.commands.getAll());
    console.log('registered commands:', commands);

    // ---- normal web page: the click path should mount the panel ----
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.bringToFront();
    await page.waitForTimeout(400);

    const onWebPage = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] });
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
        return 'ok';
      } catch (e) {
        return `ERROR: ${e.message}`;
      }
    });
    await page.waitForTimeout(700);
    console.log('toggle on a web page:', onWebPage, '| panel present:', (await page.locator('#__browser_agent_panel__').count()) === 1);

    // ---- restricted page: what does the user get? ----
    const internal = await context.newPage();
    await internal.goto('chrome://version');
    await internal.bringToFront();
    await internal.waitForTimeout(400);

    // go through the real handler (what the toolbar click runs) by messaging the
    // background from an extension page, with the restricted tab still active
    const extensionId = worker.url().split('/')[2];
    const helper = await context.newPage();
    await helper.goto(`chrome-extension://${extensionId}/popup.html`);
    await internal.bringToFront();
    await internal.waitForTimeout(300);

    await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'TOGGLE_PANEL' }));
    await helper.waitForTimeout(1200);

    console.log('badge after clicking on a restricted page:', await worker.evaluate(() => chrome.action.getBadgeText({})));
    console.log('tooltip:', await worker.evaluate(() => chrome.action.getTitle({})));

    console.log('service worker errors:', swErrors.length ? swErrors : 'none');
  } finally {
    await context.close();
    server.close();
  }
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
