const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:20px;font-family:sans-serif">
  <label>Code <input id="code" type="text" /></label>
  <select id="model"><option value="">--</option><option value="X100">X100</option></select>
  <input id="file" type="file" />
  <button id="go">Go</button>
  <button id="search">Search</button>
  <div id="status" style="width:200px;height:30px;background:#eef">READY</div>
  <table id="t" border="1" cellpadding="6" style="border-collapse:collapse;margin-top:10px">
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

  const dir = path.join(__dirname, 'export-run');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

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
    await tab.setViewportSize({ width: 900, height: 700 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(700);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const addVia = async (selector, menu) => {
      const box = await tab.locator(selector).boundingBox();
      await tab.mouse.move(box.x + Math.min(30, box.width / 2), box.y + box.height / 2);
      await tab.waitForTimeout(400);
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(180);
      await badge.locator('button', { hasText: menu }).click();
      await tab.waitForTimeout(400);
    };

    // ordinary interactions the recorder picks up on its own
    await tab.fill('#code', 'A001');
    await tab.waitForTimeout(300);
    await tab.selectOption('#model', 'X100');
    await tab.waitForTimeout(300);
    await tab.click('#go');
    await tab.waitForTimeout(400);

    // captures added through the badge
    await addVia('#status', 'Text value');
    await addVia('#t', 'Table data');
    await addVia('#status', 'Image of this area');

    // batch nodes
    await addVia('#code', 'Input');
    await addVia('#search', 'Search');
    await addVia('#status', 'Extract');

    await popup.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(500);

    // ---- export ----
    await popup.click('text=Export');
    await popup.fill('.form-input >> nth=0', 'coverage');
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('.export-btn')]);
    const file = path.join(dir, 'coverage.json');
    await download.saveAs(file);

    const wf = JSON.parse(fs.readFileSync(file, 'utf-8'));
    console.log('\n===== exported workflow =====');
    console.log(JSON.stringify(wf, null, 2));
    console.log('=============================\n');

    const byType = (t) => wf.actions.filter((a) => a.type === t);
    const has = (action, ...fields) => fields.every((f) => action?.[f] !== undefined && action[f] !== '');

    check('workflow carries version and name', !!wf.version && !!wf.name, `${wf.version} / ${wf.name}`);
    check('every action has an id and a type', wf.actions.every((a) => a.id && a.type));

    check('navigate keeps its url', has(byType('navigate')[0], 'url'), JSON.stringify(byType('navigate')[0]));
    check('input keeps selector and value', has(byType('input')[0], 'selector', 'value'), JSON.stringify(byType('input')[0]));
    check('select keeps selector and value', has(byType('select')[0], 'selector', 'value'), JSON.stringify(byType('select')[0]));
    check('click keeps its selector', has(byType('click')[0], 'selector'), JSON.stringify(byType('click')[0]));
    check('extractText keeps selector and output', has(byType('extractText')[0], 'selector', 'output'), JSON.stringify(byType('extractText')[0]));

    const table = byType('extractTable')[0];
    check('extractTable keeps selector, output and headers', has(table, 'selector', 'output') && Array.isArray(table?.headers) && table.headers.length > 0, JSON.stringify(table));

    const shot = byType('screenshot')[0];
    check('screenshot keeps selector, output and filename', has(shot, 'selector', 'output', 'filename'), JSON.stringify(shot));

    const bInput = byType('batchInput')[0];
    check('batchInput keeps selector, inputType and column slot', bInput?.selector !== undefined && !!bInput?.inputType && bInput?.column !== undefined, JSON.stringify(bInput));

    const bSearch = byType('batchSearch')[0];
    check('batchSearch keeps its wait condition', !!bSearch?.waitCondition?.type && typeof bSearch?.waitCondition?.timeout === 'number', JSON.stringify(bSearch));

    const bExtract = byType('batchExtract')[0];
    check('batchExtract keeps extractType and output', has(bExtract, 'selector', 'extractType', 'output'), JSON.stringify(bExtract));

    const withFallbacks = wf.actions.filter((a) => Array.isArray(a.selectorFallbacks) && a.selectorFallbacks.length);
    check('backup selectors are carried over', withFallbacks.length > 0, `${withFallbacks.length} of ${wf.actions.length} actions`);

    const outputs = wf.actions.filter((a) => a.output).map((a) => a.output);
    check('every captured value has a distinct name', new Set(outputs).size === outputs.length, outputs.join(', '));

    const ids = wf.actions.map((a) => a.id);
    check('every step id is unique', new Set(ids).size === ids.length, ids.join(', '));

    // ---- does the player accept it? ----
    const { validateWorkflow } = require(path.join(__dirname, '..', 'shared', 'dist', 'index.js'));
    const validation = validateWorkflow(wf);
    check('it validates against the workflow schema', validation.valid, JSON.stringify(validation.errors));
    if (validation.warnings?.length) console.log('warnings:', JSON.stringify(validation.warnings, null, 2));
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
