const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:20px;font-family:sans-serif">
  <div id="a" style="width:200px;height:30px;background:#eef">Alice Johnson</div>
  <button id="go" style="margin-top:12px">Go</button>
  <table id="t" border="1" cellpadding="6" style="margin-top:12px;border-collapse:collapse">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr></tbody>
  </table>
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
    const steps = () => popup.locator('.action-type').allTextContents();

    const addVia = async (selector, menu, { clickFirst } = {}) => {
      const box = await tab.locator(selector).boundingBox();
      const x = box.x + Math.min(40, box.width / 2);
      const y = box.y + Math.min(20, box.height / 2);
      if (clickFirst) {
        await tab.mouse.click(x, y);
        await tab.waitForTimeout(400);
      }
      await tab.mouse.move(x, y);
      await tab.waitForTimeout(400);
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(150);
      await badge.locator('button', { hasText: menu }).click();
      await tab.waitForTimeout(450);
    };

    // aiming by hovering only — one step, as always
    await addVia('#a', 'Text value');
    check('hover then Add records one step', (await steps()).join() === 'navigate,extractText', (await steps()).join(', '));

    // aiming by clicking first — the click is part of the same intention
    await addVia('#t', 'Table data', { clickFirst: true });
    check(
      'click then Add still records one step',
      (await steps()).join() === 'navigate,extractText,extractTable',
      (await steps()).join(', '),
    );

    // a click that is a real interaction, with no Add after it, must survive
    const goBox = await tab.locator('#go').boundingBox();
    await tab.mouse.click(goBox.x + goBox.width / 2, goBox.y + goBox.height / 2);
    await tab.waitForTimeout(500);
    check(
      'an ordinary click is still recorded',
      (await steps()).join() === 'navigate,extractText,extractTable,click',
      (await steps()).join(', '),
    );

    // and a click elsewhere is not swallowed by a later Add on something else
    await addVia('#a', 'Text value');
    check(
      'Add does not eat an unrelated earlier click',
      (await steps()).join() === 'navigate,extractText,extractTable,click,extractText',
      (await steps()).join(', '),
    );
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
