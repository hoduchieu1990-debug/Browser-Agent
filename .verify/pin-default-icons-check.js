const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

const PAGE = `<!doctype html><html><body>
  <button id="btn1">One</button>
  <input id="text1" />
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  // A brand-new profile — no settings ever saved — is what "freshly opened
  // extension" means for the default-value question. run-all.js reuses the
  // same 'profile' dir across every other check (order-independent by
  // design), so this one needs its own to actually start with nothing saved.
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'profile-fresh'), {
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

    // --- Default is Pin to Side on a fresh profile ---
    await popup.click('text=Settings');
    const pinItem = popup.locator('.setting-item', { hasText: 'Pin to Side' });
    const toggleClass = await pinItem.locator('.toggle').getAttribute('class');
    console.log('[pin toggle class]', toggleClass);
    assert(toggleClass.includes('on'), 'Pin to Side should default to ON on a fresh install');
    console.log('[ok] Pin to Side is the default mode on a fresh profile');

    const behavior = await worker.evaluate(() => chrome.sidePanel.getPanelBehavior());
    console.log('[panel behavior]', JSON.stringify(behavior));
    assert.strictEqual(behavior.openPanelOnActionClick, true, 'clicking the toolbar icon should open the side panel by default');
    console.log('[ok] chrome.sidePanel behavior matches: openPanelOnActionClick=true by default');

    // --- Action-type icons in Record ---
    await popup.click('text=Record');
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(300);
    await tab.click('#btn1');
    await tab.waitForTimeout(150);
    await tab.fill('#text1', 'hello');
    await tab.locator('#text1').dispatchEvent('change');
    await tab.waitForTimeout(200);
    await popup.click('.record-btn.stop');
    await tab.waitForTimeout(300);

    // .action-type must stay pure ("navigate", not "🌐 navigate") — other
    // checks read this text for exact-match assertions; the icon lives in a
    // separate sibling (.action-icon) precisely so it never pollutes that.
    const recordTypes = await popup.locator('.action-type').allTextContents();
    const recordIcons = await popup.locator('.action-icon').allTextContents();
    console.log('[record tab types]', JSON.stringify(recordTypes), '[icons]', JSON.stringify(recordIcons));
    assert(recordTypes.every((t) => !/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(t)), '.action-type text must not contain an icon glyph');
    assert(recordTypes.includes('navigate') && recordIcons.includes('🌐'), `expected a plain "navigate" row with a 🌐 icon, got types=${JSON.stringify(recordTypes)} icons=${JSON.stringify(recordIcons)}`);
    assert(recordTypes.includes('click') && recordIcons.includes('🖱️'), `expected a plain "click" row with a 🖱️ icon, got types=${JSON.stringify(recordTypes)} icons=${JSON.stringify(recordIcons)}`);
    assert(recordTypes.includes('input') && recordIcons.includes('⌨️'), `expected a plain "input" row with a ⌨️ icon, got types=${JSON.stringify(recordTypes)} icons=${JSON.stringify(recordIcons)}`);
    console.log('[ok] Record tab shows a per-type icon on each action, without corrupting the plain type text');

    // --- Action-type icons in Preview, both before AND after replay ---
    await popup.click('text=Preview');
    await popup.waitForTimeout(200);
    const previewBeforeTypes = await popup.locator('.step-type').allTextContents();
    const previewBeforeIcons = await popup.locator('.action-icon').allTextContents();
    console.log('[preview before replay]', JSON.stringify(previewBeforeTypes), JSON.stringify(previewBeforeIcons));
    assert(previewBeforeTypes.includes('click') && previewBeforeIcons.includes('🖱️'), 'pending step list should already show icons before Replay runs, with plain type text');

    await popup.click('.replay-btn');
    await popup.locator('.replay-btn:not([disabled])').waitFor({ timeout: 20000 });
    await popup.waitForTimeout(300);
    const previewAfterTypes = await popup.locator('.step-type').allTextContents();
    const previewAfterIcons = await popup.locator('.action-icon').allTextContents();
    console.log('[preview after replay]', JSON.stringify(previewAfterTypes), JSON.stringify(previewAfterIcons));
    assert(previewAfterTypes.includes('click') && previewAfterIcons.includes('🖱️'), 'replayed step log should show icons too, with plain type text');
    console.log('[ok] Preview tab shows a per-type icon both before and after Replay, without corrupting the plain type text');

    await popup.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: pin-default-icons-check');
})();
