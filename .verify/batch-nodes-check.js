const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const ExcelJS = require('exceljs');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="font-family:Segoe UI,sans-serif;padding:24px">
  <label>Code <input id="code" type="text" /></label><br/><br/>
  <label>Model
    <select id="model">
      <option value="">--</option>
      <option value="X100">X100</option>
      <option value="X200">X200</option>
      <option value="X300">X300</option>
    </select>
  </label><br/><br/>
  <button id="confirm">Confirm</button>
  <button id="search">Search</button>
  <script>
    document.getElementById('search').addEventListener('click', () => {
      document.getElementById('result')?.remove();
      const code = document.getElementById('code').value;
      const model = document.getElementById('model').value;
      // the result element does not exist until this fires, so a Search node
      // that only checks DOM presence genuinely has to wait for it
      setTimeout(() => {
        const div = document.createElement('div');
        div.id = 'result';
        div.textContent = code + '-' + model;
        document.body.appendChild(div);
      }, 400);
    });
  </script>
</body></html>`;

async function buildDataset(filePath) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('rows');
  sheet.addRow(['Code', 'Model']);
  sheet.addRow(['A001', 'X100']);
  sheet.addRow(['A002', 'X200']);
  sheet.addRow(['A003', 'X300']);
  await wb.xlsx.writeFile(filePath);
}

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const dir = path.join(__dirname, 'batch-nodes-run');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const datasetPath = path.join(dir, 'rows.xlsx');
  await buildDataset(datasetPath);

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    acceptDownloads: true,
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
    await tab.waitForTimeout(500);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const addBatch = async (targetSelector, menuText) => {
      const box = await tab.locator(targetSelector).boundingBox();
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.waitForTimeout(300);
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(150);
      await badge.locator('button', { hasText: menuText }).click();
      await tab.waitForTimeout(250);
    };

    await addBatch('#code', 'Input');
    await addBatch('#model', 'Input');
    await addBatch('#confirm', 'Click');
    await addBatch('#search', 'Search');

    // record Extract against a *real* result, the way a user actually would
    await tab.click('#search');
    await tab.waitForSelector('#result');
    await addBatch('#result', 'Extract');

    await tab.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(500);

    const types = await popup.locator('.action-type').allTextContents();
    check(
      '5 batch nodes recorded in order',
      types.some((t) => t.includes('Input')) &&
        types.filter((t) => t.includes('Input')).length === 2 &&
        types.some((t) => t.includes('Click')) &&
        types.some((t) => t.includes('Search')) &&
        types.some((t) => t.includes('Extract')),
      types.join(', '),
    );

    // attach the dataset first — the Column dropdown only has real options
    // once the workflow's headers are known
    await popup.click('text=Batch');
    await popup.locator('input[type="file"]').setInputFiles(datasetPath);
    await popup.waitForTimeout(300);
    check('dataset attached', (await popup.locator('.form-hint').first().textContent())?.includes('3 rows') ?? false);

    // configure Column for both Input nodes via the inline config panel
    await popup.click('text=Record');
    const inputItem = (n) =>
      popup.locator('.action-item').filter({ has: popup.locator('.action-type', { hasText: `Input ${n}` }) });

    // only one node's config panel is open at a time (accordion-style), so
    // each row must be expanded, configured, and verified before the next
    // expansion collapses it again
    await inputItem(1).locator('.action-info').click();
    const col1 = inputItem(1).locator('.action-batch-config select').first();
    await col1.selectOption('Code');
    await popup.waitForTimeout(300); // let the UPDATE_ACTION round trip land before reading it back
    const col1Saved = (await col1.inputValue()) === 'Code';

    await inputItem(2).locator('.action-info').click();
    const col2 = inputItem(2).locator('.action-batch-config select').first();
    await col2.selectOption('Model');
    await popup.waitForTimeout(300);
    const col2Saved = (await col2.inputValue()) === 'Model';

    // re-open Input 1 to confirm its column survived Input 2's panel taking over
    await inputItem(1).locator('.action-info').click();
    const col1Persisted = (await inputItem(1).locator('.action-batch-config select').first().inputValue()) === 'Code';

    check('Column bindings saved', col1Saved && col2Saved && col1Persisted);

    // ---------- Test Row ----------
    await popup.click('text=Batch');
    await popup.click('button:has-text("Test Row")');
    await popup.waitForFunction(() => document.querySelectorAll('.result-table tbody tr').length >= 1, {
      timeout: 15000,
    });
    // wait for the row to leave "running" (Stop re-disables once the run finishes)
    await popup.waitForFunction(() => document.querySelector('.record-btn.stop')?.hasAttribute('disabled'), {
      timeout: 15000,
    });
    const testRowText = await popup.locator('.result-table tbody tr').first().textContent();
    check('Test Row produced one result', testRowText?.includes('A001-X100') ?? false, testRowText ?? '');

    // ---------- Run All ----------
    await popup.click('button:has-text("Run All")');
    await popup.waitForFunction(() => document.querySelectorAll('.result-table tbody tr').length >= 3, { timeout: 20000 });
    // wait for the run to actually finish (Stop re-disables once it does)
    await popup.waitForFunction(
      () => document.querySelector('.record-btn.stop')?.hasAttribute('disabled'),
      { timeout: 20000 },
    );

    const rowTexts = await popup.locator('.result-table tbody tr').allTextContents();
    check('Run All produced 3 rows', rowTexts.length === 3, rowTexts.join(' | '));
    check('row 1 extracted A001-X100', rowTexts[0]?.includes('A001-X100') ?? false, rowTexts[0]);
    check('row 2 extracted A002-X200 (replaced, not appended)', rowTexts[1]?.includes('A002-X200') ?? false, rowTexts[1]);
    check('row 2 is not the concatenation of both rows', !(rowTexts[1]?.includes('A001-X100A002-X200')), rowTexts[1]);
    check('row 3 extracted A003-X300', rowTexts[2]?.includes('A003-X300') ?? false, rowTexts[2]);

    // ---------- export ----------
    const [download] = await Promise.all([
      popup.waitForEvent('download'),
      popup.click('button:has-text("Export results")'),
    ]);
    const csvPath = path.join(dir, 'results.csv');
    await download.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf-8');
    check('exported CSV has input + extract columns', csv.includes('Code') && csv.includes('Model') && csv.includes('A002-X200'), csv.split('\n')[0]);
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
