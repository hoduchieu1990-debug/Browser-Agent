const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// A page in the shape of a tutorial site: the whole layout sits in a <table>,
// with a <style> block mid-content, and a genuine data table further down.
const PAGE = `<!doctype html><html><body style="margin:0;font-family:sans-serif">
  <table id="layout" style="width:100%">
    <tr>
      <td style="width:50%;vertical-align:top">
        <style>
          .pelle-btn { width:180px; border-radius:5px; }
          .pelle-divider { width:50%; border-right:2px solid #D9EEE1; font-size:10px; }
        </style>
        <h2 id="title">NumPy Tutorial</h2>
        <p>NumPy is a Python library. NumPy is used for working with arrays.
        NumPy is short for "Numerical Python". Learning by Reading: we have created
        43 tutorial pages for you to learn more about NumPy, starting with a basic
        introduction and ending with creating and plotting random data sets.</p>
      </td>
      <td style="vertical-align:top">
        <p>Learning by Examples. In our "Try it Yourself" editor you can use the
        NumPy module and modify the code to see the result. Many chapters end with
        an exercise where you can check your level of knowledge before moving on.</p>
      </td>
    </tr>
  </table>

  <table id="real" border="1" cellpadding="6" style="margin:20px;border-collapse:collapse">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody>
  </table>

  <!-- a data table that carries a stylesheet inside a cell -->
  <table id="styled" border="1" cellpadding="6" style="margin:20px;border-collapse:collapse">
    <thead><tr><th>Code</th><th>Label</th></tr></thead>
    <tbody><tr><td>A1<style>.x{color:red}</style></td><td>Widget</td></tr></tbody>
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
    await tab.setViewportSize({ width: 900, height: 700 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(700);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const openMenuOver = async (selector) => {
      const box = await tab.locator(selector).first().boundingBox();
      await tab.mouse.move(box.x + Math.min(30, box.width / 2), box.y + box.height / 2);
      await tab.waitForTimeout(450);
      if (!(await badge.isVisible())) return false;
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(200);
      return true;
    };

    // ---- over the layout table, "Table data" must not be on offer ----
    const opened = await openMenuOver('#title');
    check('the badge still works over layout content', opened);
    if (opened) {
      const offered = await badge.locator('button', { hasText: 'Table data' }).isVisible();
      check('layout table is not offered as table data', !offered);
      await tab.keyboard.press('Escape');
      await tab.waitForTimeout(300);
    }

    // ---- the genuine table still is ----
    const openedReal = await openMenuOver('#real td');
    check('menu opens over a real table', openedReal);
    if (openedReal) {
      const offered = await badge.locator('button', { hasText: 'Table data' }).isVisible();
      check('a real table is still offered', offered);
      if (offered) {
        await badge.locator('button', { hasText: 'Table data' }).click();
        await tab.waitForTimeout(400);
      }
    }

    // ---- a data table holding a <style> must not leak the css ----
    const openedStyled = await openMenuOver('#styled td');
    if (openedStyled && (await badge.locator('button', { hasText: 'Table data' }).isVisible())) {
      await badge.locator('button', { hasText: 'Table data' }).click();
      await tab.waitForTimeout(400);
    }

    await popup.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    const selectors = await popup.locator('.action-selector').allTextContents();
    check('nothing captured the layout table', !selectors.some((s) => s.includes('#layout')), selectors.join(' | '));

    await tab.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.waitForFunction(() => !document.querySelector('.replay-btn')?.hasAttribute('disabled'), {
      timeout: 60000,
    });
    await popup.waitForTimeout(700);

    const body = (await popup.locator('.result-block').allTextContents()).join(' | ');
    check('results carry the real rows', body.includes('Alice') && body.includes('Bob'), body.slice(0, 120));
    check('and no stylesheet text', !body.includes('.pelle-btn') && !body.includes('color:red'), body.slice(0, 200));
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
