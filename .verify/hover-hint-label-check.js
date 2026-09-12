const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:120px;font-family:sans-serif">
  <button id="btn" style="padding:10px 20px">Click me</button>
  <div id="near-top" style="position:fixed;top:2px;left:20px;padding:4px;background:#eee">Near the top edge</div>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'hover-hint-label-profile');

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
    await tab.waitForTimeout(300);

    // ---- label shows the right text, positioned above the hovered element ----
    await tab.hover('#btn');
    await tab.waitForTimeout(200);
    const info = await tab.evaluate(() => {
      const overlay = document.getElementById('__browser_agent_highlight__');
      const label = document.getElementById('__browser_agent_highlight_label__');
      const btnRect = document.getElementById('btn').getBoundingClientRect();
      return {
        labelText: label?.textContent,
        labelVisible: label?.style.display === 'block',
        labelTop: parseFloat(label?.style.top || '0'),
        btnTop: btnRect.top,
        overlayVisible: overlay?.style.display === 'block',
      };
    });
    console.log('[hover on #btn]', JSON.stringify(info));
    check('label reads "Ctrl+Right-click to add data"', info.labelText === 'Ctrl+Right-click to add data');
    check('label is visible alongside the outline', info.labelVisible && info.overlayVisible);
    check('label sits above the hovered element', info.labelTop < info.btnTop);

    // ---- label flips below when too close to the top of the viewport ----
    await tab.hover('#near-top');
    await tab.waitForTimeout(200);
    const infoTop = await tab.evaluate(() => {
      const label = document.getElementById('__browser_agent_highlight_label__');
      const rect = document.getElementById('near-top').getBoundingClientRect();
      return { labelTop: parseFloat(label?.style.top || '0'), elBottom: rect.bottom, elTop: rect.top };
    });
    console.log('[hover near top edge]', JSON.stringify(infoTop));
    check('label flips below the element instead of clipping off-screen', infoTop.labelTop >= infoTop.elTop);

    // ---- label hides while the Ctrl+Right-click menu is open ----
    await tab.hover('#btn');
    await tab.waitForTimeout(150);
    await tab.click('#btn', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(200);
    const infoMenuOpen = await tab.evaluate(() => {
      const label = document.getElementById('__browser_agent_highlight_label__');
      return label?.style.display;
    });
    check('label hides while the capture menu is open (no double outline)', infoMenuOpen === 'none');

    await tab.keyboard.press('Escape');
    await tab.waitForTimeout(150);

    // ---- label disappears entirely when the mouse leaves the page ----
    await tab.mouse.move(5, 5);
    await tab.dispatchEvent('body', 'mouseleave');
    await tab.waitForTimeout(150);
    const infoLeave = await tab.evaluate(() => document.getElementById('__browser_agent_highlight_label__')?.style.display);
    check('label hides on mouseleave, same as the outline', infoLeave === 'none');
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
