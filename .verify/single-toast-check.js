const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:20px;font-family:sans-serif">
  <div id="a" style="width:200px;height:30px;background:#eef">Alice</div>
  <div id="b" style="width:200px;height:30px;background:#efe;margin-top:10px">Bob</div>
</body></html>`;

(async () => {
  const server = http.createServer((_r, res) => {
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
    await tab.waitForTimeout(700);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const noticesAfterAdd = async (selector) => {
      const box = await tab.locator(selector).boundingBox();
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.waitForTimeout(400);
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(150);
      await badge.locator('button', { hasText: 'Text value' }).click();
      await tab.waitForTimeout(250); // still well inside the notice's lifetime
      return tab.evaluate(() => {
        const c = document.getElementById('__browser_agent_toast_container__');
        return c ? [...c.children].map((el) => (el.textContent || '').trim()) : [];
      });
    };

    // The first Add also records the starting url, so this is where two
    // notices used to appear for a single press.
    const first = await noticesAfterAdd('#a');
    check('the first Add shows one notice', first.length === 1, JSON.stringify(first));

    // And a second Add, while the previous notice would still be fading.
    const second = await noticesAfterAdd('#b');
    check('a following Add still shows one', second.length === 1, JSON.stringify(second));
    check('and it is the newest one', second[0]?.includes('#b') ?? false, JSON.stringify(second));

    // The steps themselves are unaffected — one capture each, plus the
    // starting url recorded once.
    await popup.bringToFront();
    await popup.waitForTimeout(400);
    const steps = await popup.locator('.action-type').allTextContents();
    check('each Add still records exactly one step', steps.join() === 'navigate,extractText,extractText', steps.join(', '));
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
