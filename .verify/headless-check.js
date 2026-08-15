const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PAGE = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
  <table id="results" border="1" cellpadding="6" style="border-collapse:collapse;margin-top:12px">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody>
  </table>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'profile');
  const workflowPath = path.join(__dirname, 'workflow.json');

  // ---------- phase 1: record in a real browser ----------
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    const extensionId = worker.url().split('/')[2];

    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${port}/`); // page opened BEFORE recording starts

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await testPage.bringToFront();
    await popup.click('text=Start');
    await testPage.waitForTimeout(400);

    const badge = testPage.locator('#__browser_agent_add_badge__');
    await testPage.hover('#total');
    await testPage.waitForTimeout(300);
    await badge.locator('button', { hasText: 'Add' }).click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await testPage.waitForTimeout(300);

    await testPage.hover('td >> text=Alice');
    await testPage.waitForTimeout(300);
    await badge.locator('button', { hasText: 'Add' }).click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Table data' }).click();
    await testPage.waitForTimeout(300);

    await testPage.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(300);

    await popup.click('text=Export');
    await popup.fill('.form-input', 'headless-test');
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('.export-btn')]);
    await download.saveAs(workflowPath);
  } finally {
    await context.close(); // browser fully closed — nothing left open
  }

  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
  console.log('--- exported workflow ---');
  console.log(JSON.stringify(workflow.actions, null, 2));

  workflow.exportFormats = [
    { type: 'json', output: 'total.json', dataKey: 'text1' },
    { type: 'csv', output: 'rows.csv', dataKey: 'table1' },
  ];
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

  // ---------- phase 2: run headless, with no browser window open at all ----------
  console.log('\n--- headless CLI run (no browser window) ---');
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(__dirname, '..', 'cli', 'dist', 'index.js'),
    'run',
    workflowPath,
    '--output',
    __dirname,
    '--verbose',
  ]);
  console.log(stdout);
  console.log('total.json:', fs.readFileSync(path.join(__dirname, 'total.json'), 'utf-8'));
  console.log('rows.csv:\n' + fs.readFileSync(path.join(__dirname, 'rows.csv'), 'utf-8'));

  server.close();
})().catch((err) => {
  console.error('FAILED:', err.stdout || err);
  process.exit(1);
});
