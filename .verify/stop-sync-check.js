const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:20px"><div id="a" style="width:200px;height:30px;background:#eef">Alice</div></body></html>`;

(async () => {
  const server = http.createServer((_r, res) => { res.writeHead(200, {'Content-Type':'text/html'}); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = worker.url().split('/')[2];

  const tab = await context.newPage();
  await tab.goto(`http://127.0.0.1:${port}/`);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await tab.bringToFront();
  await popup.click('.record-btn.start');
  await tab.waitForTimeout(800);

  const readUi = async () => ({
    status: (await popup.locator('.recording-status span').textContent()) ?? '',
    startDisabled: await popup.locator('.record-btn.start').isDisabled(),
    stopDisabled: await popup.locator('.record-btn.stop').isDisabled(),
  });

  const during = await readUi();
  check(
    'the extension shows a recording in progress',
    during.status.includes('Recording') && during.startDisabled && !during.stopDisabled,
    JSON.stringify(during),
  );

  // stop from the on-page badge, exactly as the user does
  const badge = tab.locator('#__browser_agent_add_badge__');
  const box = await tab.locator('#a').boundingBox();
  await tab.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await tab.waitForTimeout(400);
  await badge.locator('[data-ba-role="stop"]').click();
  await tab.waitForTimeout(1500);

  // Stopping from the page must reach the extension's own window, which
  // stays open beside it when pinned.
  const after = await readUi();
  check(
    'stopping from the page turns the extension back to idle',
    after.status.includes('Ready') && !after.startDisabled && after.stopDisabled,
    JSON.stringify(after),
  );

  await context.close();
  server.close();

  const failed = results.filter((r) => !r.passed);
  console.log(`
${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
