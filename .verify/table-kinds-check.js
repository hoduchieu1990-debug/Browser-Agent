const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Three ways real apps draw the same table.
const PAGE = `<!doctype html><html><body style="font-family:Segoe UI,sans-serif;padding:24px">
  <h3>1. Real table</h3>
  <table id="real" border="1" cellpadding="6" style="border-collapse:collapse">
    <thead><tr><th>ID</th><th>Name</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>Alice</td><td>Done</td></tr>
      <tr><td>2</td><td>Bob</td><td>Pending</td></tr>
    </tbody>
  </table>

  <h3 style="margin-top:28px">2. ARIA grid</h3>
  <div id="aria" role="grid" style="display:inline-block;border:1px solid #999">
    <div role="row" style="display:flex">
      <div role="columnheader" style="padding:6px 12px;font-weight:600">SKU</div>
      <div role="columnheader" style="padding:6px 12px;font-weight:600">Qty</div>
    </div>
    <div role="row" style="display:flex">
      <div role="gridcell" style="padding:6px 12px">A-100</div>
      <div role="gridcell" style="padding:6px 12px">5</div>
    </div>
    <div role="row" style="display:flex">
      <div role="gridcell" style="padding:6px 12px">B-200</div>
      <div role="gridcell" style="padding:6px 12px">9</div>
    </div>
  </div>

  <h3 style="margin-top:28px">3. Div grid, no roles</h3>
  <div id="divgrid" style="display:inline-block;border:1px solid #999">
    <div style="display:flex"><span style="padding:6px 12px;font-weight:600">Region</span><span style="padding:6px 12px;font-weight:600">Total</span></div>
    <div style="display:flex"><span style="padding:6px 12px">North</span><span style="padding:6px 12px">120</span></div>
    <div style="display:flex"><span style="padding:6px 12px">South</span><span style="padding:6px 12px">340</span></div>
  </div>
</body></html>`;

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

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    await tab.setViewportSize({ width: 900, height: 900 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(600);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const addTable = async (cellText, label) => {
      const cell = tab.locator(`text=${cellText}`).first();
      const box = await cell.boundingBox();
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.waitForTimeout(400);

      const tableOption = badge.locator('button', { hasText: 'Table data' });
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(250);
      const offered = await tableOption.isVisible();
      check(`${label}: "Table data" offered`, offered);
      if (!offered) {
        await tab.keyboard.press('Escape');
        return;
      }
      await tableOption.click();
      await tab.waitForTimeout(400);
    };

    await addTable('Alice', 'real <table>');
    await addTable('A-100', 'ARIA grid');
    await addTable('North', 'div grid');

    await tab.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(500);

    const types = await popup.locator('.action-type').allTextContents();
    check('three table steps recorded', types.filter((t) => t === 'extractTable').length === 3, types.join(', '));

    // ---------- in-browser replay ----------
    await tab.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.replay-btn:not([disabled])').waitFor({ timeout: 60000 });
    await popup.waitForTimeout(600);

    const errors = await popup.locator('.error-banner').count();
    check('replay ran clean', errors === 0, errors ? (await popup.locator('.error-banner').textContent()).trim() : '');

    const tables = popup.locator('.result-table');
    check('all three tables came back', (await tables.count()) === 3, `${await tables.count()}`);

    for (let i = 0; i < (await tables.count()); i++) {
      const headers = await tables.nth(i).locator('th').allTextContents();
      const rows = await tables.nth(i).locator('tbody tr').count();
      console.log(`  table ${i + 1}: headers=${JSON.stringify(headers)} rows=${rows}`);
    }

    const allHeaders = await popup.locator('.result-table th').allTextContents();
    check('real table headers read', ['ID', 'Name', 'Status'].every((h) => allHeaders.includes(h)), allHeaders.join(','));
    check('ARIA grid headers read', ['SKU', 'Qty'].every((h) => allHeaders.includes(h)), allHeaders.join(','));
    check('div grid headers read', ['Region', 'Total'].every((h) => allHeaders.includes(h)), allHeaders.join(','));

    // ---------- and through the CLI, which runs the same reader ----------
    await popup.click('text=Export');
    await popup.fill('.form-input >> nth=0', 'tables');
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('.export-btn')]);
    const dir = path.join(__dirname, 'tables-run');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const wfPath = path.join(dir, 'wf.json');
    await download.saveAs(wfPath);

    const wf = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
    wf.exportFormats = wf.actions
      .filter((a) => a.type === 'extractTable')
      .map((a) => ({ type: 'csv', output: `${a.output}.csv`, dataKey: a.output }));
    fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));

    const cli = path.join(__dirname, '..', 'cli', 'dist', 'index.js');
    const { stdout } = await execFileAsync(process.execPath, [cli, 'run', wfPath, '--output', dir]);
    check('CLI run succeeded', stdout.includes('completed successfully'), stdout.trim().split('\n').slice(-1)[0]);

    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.csv'))) {
      console.log(`\n== ${file} ==\n${fs.readFileSync(path.join(dir, file), 'utf-8').trim()}`);
    }
    const csvs = fs.readdirSync(dir).filter((f) => f.endsWith('.csv'));
    check('CLI produced a file per table', csvs.length === 3, csvs.join(', '));

    const combined = csvs.map((f) => fs.readFileSync(path.join(dir, f), 'utf-8')).join('\n');
    check('CLI read the ARIA grid', combined.includes('A-100') && combined.includes('SKU'));
    check('CLI read the div grid', combined.includes('North') && combined.includes('Region'));
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e.stdout || e);
  process.exit(1);
});
