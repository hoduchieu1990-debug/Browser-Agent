const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body><div id="total">1,284</div></body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, value: 42 }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'plugin-ui-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    await tab.goto(base);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(300);

    // ---------- add a mailSend step (CLI-only) ----------
    await popup.locator('.add-step-menu button', { hasText: '+ Add step' }).click();
    await popup.locator('.add-step-item', { hasText: 'Send' }).first().click();
    await popup.waitForTimeout(200);

    let types = await popup.locator('.action-type').allTextContents();
    check('mailSend step was added', types.includes('mailSend'), types.join(', '));
    check(
      'mailSend shows the CLI-only badge',
      (await popup.locator('.action-item', { hasText: 'mailSend' }).locator('.action-optional-badge').textContent()) ===
        'CLI only',
    );

    // its config panel should already be expanded (newest configurable node)
    const mailPanel = popup.locator('.action-item', { hasText: 'mailSend' }).locator('.plugin-action-config');
    await mailPanel.locator('input[type="text"]').first().fill('smtp.example.com');
    await mailPanel.locator('input[type="number"]').fill('587');
    // fields render in schema order: host, port, secure(checkbox), user, password, to, cc, bcc, subject...
    const textInputs = mailPanel.locator('input[type="text"]');
    await textInputs.nth(1).fill('bot@example.com'); // user
    await mailPanel.locator('input[type="password"]').fill('secret');
    await textInputs.nth(2).fill('dest@example.com'); // to
    await textInputs.nth(5).fill('Hello subject'); // to,cc,bcc,subject -> index 2..5
    await mailPanel.locator('textarea').first().fill('Hello body');
    await popup.waitForTimeout(300);

    const state1 = await popup.evaluate(
      () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_STATE' }, (s) => resolve(s.actions))),
    );
    const mailAction = state1.find((a) => a.type === 'mailSend');
    console.log('[mailSend action]', JSON.stringify(mailAction));
    check('mailSend host field saved', mailAction.host === 'smtp.example.com');
    check('mailSend port field saved as a number', mailAction.port === 587);
    check('mailSend subject field saved', mailAction.subject === 'Hello subject');
    check('mailSend body field saved', mailAction.body === 'Hello body');

    // ---------- add a dbQuery step and verify nested connection.* patch ----------
    await popup.locator('.add-step-menu button', { hasText: '+ Add step' }).click();
    await popup.locator('.add-step-item', { hasText: 'Query' }).first().click();
    await popup.waitForTimeout(200);

    const dbPanel = popup.locator('.action-item', { hasText: 'dbQuery' }).locator('.plugin-action-config');
    await dbPanel.locator('input[type="text"]').nth(0).fill('sql.example.com'); // connection.server
    await dbPanel.locator('input[type="text"]').nth(1).fill('MyDb'); // connection.database
    await dbPanel.locator('textarea').first().fill('SELECT * FROM Users WHERE id = @p0');
    await popup.waitForTimeout(300);

    const state2 = await popup.evaluate(
      () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_STATE' }, (s) => resolve(s.actions))),
    );
    const dbAction = state2.find((a) => a.type === 'dbQuery');
    console.log('[dbQuery action]', JSON.stringify(dbAction));
    check(
      'dbQuery nested connection.server saved without clobbering the rest of connection',
      dbAction.connection.server === 'sql.example.com' && dbAction.connection.database === 'MyDb',
    );
    check('dbQuery SQL text saved', dbAction.query === 'SELECT * FROM Users WHERE id = @p0');

    // ---------- add an apiGet step and prove it actually runs in-browser replay ----------
    await popup.locator('.add-step-menu button', { hasText: '+ Add step' }).click();
    await popup.locator('.add-step-item', { hasText: 'GET' }).first().click();
    await popup.waitForTimeout(200);

    const apiPanel = popup.locator('.action-item', { hasText: 'apiGet' }).locator('.plugin-action-config');
    await apiPanel.locator('input[type="text"]').first().fill(`${base}/api`);
    await popup.waitForTimeout(300);

    await tab.bringToFront(); // replay runs against whichever tab the user is looking at
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.step-row').last().waitFor({ timeout: 30000 });
    await popup.waitForTimeout(1000);

    const stepRows = await popup.locator('.step-row').allTextContents();
    console.log('[replay steps]', JSON.stringify(stepRows));

    const dbRowIndex = stepRows.findIndex((s) => s.includes('dbQuery'));
    const apiRowIndex = stepRows.findIndex((s) => s.includes('apiGet'));
    check('dbQuery step is marked skipped during in-browser replay', /skip/i.test(await popup.locator('.step-row').nth(dbRowIndex).getAttribute('class')));
    check('apiGet step is NOT skipped — it actually ran in-browser', !/skip/i.test(await popup.locator('.step-row').nth(apiRowIndex).getAttribute('class')));

    const variables = await popup.evaluate(
      () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_REPLAY_STATE' }, (s) => resolve(s.variables))),
    );
    console.log('[replay variables]', JSON.stringify(variables));
    check('apiGet result variable has the real fetched value', variables.result?.value === 42);
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
