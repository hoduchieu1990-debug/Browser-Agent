const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:20px;font-family:sans-serif">
  <div id="a" style="width:220px;height:30px;background:#eef">Alice Johnson</div>
  <table id="t" border="1" cellpadding="6" style="margin-top:12px;border-collapse:collapse">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr></tbody>
  </table>
  <div id="b" style="width:220px;height:30px;background:#efe;margin-top:12px">Bob Smith</div>
</body></html>`;

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
  await tab.waitForTimeout(700);
  const badge = tab.locator('#__browser_agent_add_badge__');
  const add = async (sel, menu) => {
    const box = await tab.locator(sel).boundingBox();
    await tab.mouse.move(box.x + Math.min(30, box.width/2), box.y + box.height/2);
    await tab.waitForTimeout(400);
    await badge.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(180);
    await badge.locator('button', { hasText: menu }).click();
    await tab.waitForTimeout(400);
  };
  await add('#a', 'Text value');       // text1  (recorded 1st)
  await add('#t', 'Table data');       // table1 (2nd)
  await add('#b', 'Text value');       // text2  (3rd)
  await add('#a', 'Image of this area');// image1 (4th)

  await popup.bringToFront();
  await popup.click('.record-btn.stop');
  await popup.waitForTimeout(400);
  const recorded = (await popup.locator('.action-value').allTextContents()).map((t) => t.replace('→ ', '').trim());

  await tab.bringToFront();
  await popup.click('text=Preview');
  await popup.click('.replay-btn');
  await popup.waitForFunction(() => !document.querySelector('.replay-btn')?.hasAttribute('disabled'), { timeout: 60000 });
  await popup.waitForTimeout(900);

  const shown = await popup.locator('.result-name').allTextContents();
  check(
    'results are listed in the order the steps were recorded',
    shown.join() === recorded.join(),
    `recorded ${recorded.join(', ')} — shown ${shown.join(', ')}`,
  );

  const panels = await popup.locator('.panel-title').allTextContents();
  check('the steps and the data each have their own titled panel', panels.length === 2, panels.join(' | '));
  check('the steps panel comes first', panels[0]?.toLowerCase().includes('steps'), panels[0] ?? '');
  check('the data panel is set apart', (await popup.locator('.panel-results').count()) === 1);

  await context.close();
  server.close();

  const failed = results.filter((r) => !r.passed);
  console.log(`
${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
