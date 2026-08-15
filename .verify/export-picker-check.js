const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PAGE = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
  <button id="go">Go</button>
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

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const badge = testPage.locator('#__browser_agent_add_badge__');
    const addBtn = badge.locator('button', { hasText: 'Add' });

    // ---- JOB 1: capture only the text value ----
    await testPage.bringToFront();
    await popup.click('text=Record');
    await popup.click('text=Start');
    await testPage.waitForTimeout(400);
    await testPage.hover('#total');
    await testPage.waitForTimeout(300);
    await addBtn.click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await testPage.waitForTimeout(250);
    await testPage.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(400);

    // ---- JOB 2: capture the table (this becomes the "current" session) ----
    await testPage.bringToFront();
    await popup.click('text=Start');
    await testPage.waitForTimeout(400);
    await testPage.hover('td >> text=Alice');
    await testPage.waitForTimeout(300);
    await addBtn.click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Table data' }).click();
    await testPage.waitForTimeout(250);
    await testPage.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(400);

    // ---- Export tab must list both jobs plus the current session ----
    await popup.click('text=Export');
    await popup.waitForTimeout(300);

    const jobNames = await popup.locator('.job-name').allTextContents();
    const jobMetas = await popup.locator('.job-meta').allTextContents();
    console.log('jobs listed:', jobNames.length);
    jobNames.forEach((n, i) => console.log(`  - ${n} | ${jobMetas[i]}`));

    const selectedFirst = await popup.locator('.job-item.selected .job-name').textContent();
    console.log('default selection:', selectedFirst);

    // ---- pick the OLDER job (the text-only one) and export it ----
    const older = popup.locator('.job-item').nth(2); // current, job2, job1
    await older.click();
    await popup.waitForTimeout(200);
    console.log('selected after click:', await popup.locator('.job-item.selected .job-name').textContent());
    console.log('name field auto-filled:', await popup.locator('.form-input').first().inputValue());
    console.log('export button:', (await popup.locator('.export-btn').textContent()).trim());

    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('.export-btn')]);
    const out = path.join(__dirname, 'picked.json');
    await download.saveAs(out);
    const wf = JSON.parse(fs.readFileSync(out, 'utf-8'));
    console.log('exported file name:', download.suggestedFilename());
    console.log('exported action types:', wf.actions.map((a) => a.type).join(', '));

    // ---- switching back to the current session must export the table job ----
    await popup.locator('.job-item').first().click();
    await popup.waitForTimeout(200);
    const [download2] = await Promise.all([popup.waitForEvent('download'), popup.click('.export-btn')]);
    const out2 = path.join(__dirname, 'picked-current.json');
    await download2.saveAs(out2);
    const wf2 = JSON.parse(fs.readFileSync(out2, 'utf-8'));
    console.log('current session action types:', wf2.actions.map((a) => a.type).join(', '));

    await popup.setViewportSize({ width: 420, height: 640 });
    await popup.screenshot({ path: path.join(__dirname, 'export-picker.png') });
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
