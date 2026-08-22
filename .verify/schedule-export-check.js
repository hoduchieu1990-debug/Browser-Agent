const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');

const PAGE = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  // A dedicated profile, not the shared .verify/profile/ used by many other
  // checks — that one accumulates 50+ saved recordings across a full suite
  // run and something about that load made the service worker occasionally
  // drop the GET_EMAIL_SETTINGS response (App.tsx now falls back to
  // DEFAULT_EMAIL_SETTINGS either way, but isolating this test avoids
  // depending on that fallback ever being exercised for real).
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'schedule-export-profile'), {
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

    // Configure the (now global, Settings-tab) SMTP server once, up front.
    await popup.click('text=Settings');
    await popup.waitForTimeout(200);
    await popup.locator('.form-input[placeholder="smtp.samsung.net"]').fill('smtp.samsung.net');
    await popup.waitForTimeout(200); // SET_EMAIL_SETTINGS round trip to the background

    // Record one extractText action so the recording has a real output name.
    await testPage.bringToFront();
    await popup.click('text=Record');
    await popup.click('text=Start');
    await testPage.waitForTimeout(400);
    await testPage.hover('#total');
    await testPage.waitForTimeout(300);
    await badge.locator('button', { hasText: 'Add' }).click();
    await testPage.waitForTimeout(150);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await testPage.waitForTimeout(250);
    await testPage.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(400);

    // Open Saved tab, open the Schedule form for the just-saved recording.
    await popup.click('text=Saved');
    await popup.waitForTimeout(200);
    await popup.locator('.saved-schedule').first().click();
    await popup.waitForTimeout(200);

    const outputName = await popup.locator('.result-key-item').first().textContent();
    console.log('[available result key]', outputName.trim());
    assert(outputName.trim().length > 0, 'expected the recorded extractText output name to be listed');

    // pick a weekday so the weekly recurrence is valid, then add+select a recipient
    await popup.locator('.weekday-chip').first().click();
    await popup.locator('.form-input[placeholder="Add a new recipient…"]').fill('ops@example.com');
    await popup.locator('.recipient-add-row button', { hasText: 'Add' }).click();
    await popup.waitForTimeout(150);

    const [download] = await Promise.all([
      popup.waitForEvent('download'),
      popup.locator('.export-btn', { hasText: 'Create schedule' }).click(),
    ]);
    // Playwright's download capture assigns its own temp filename to
    // extension-initiated downloads regardless of the `filename` option
    // passed to chrome.downloads.download() (confirmed against a bare
    // chrome.downloads.download() call outside this component too) — a real
    // Chrome user gets the requested BrowserAgent-Schedules/<id>.schedule.json
    // path, so this only verifies the downloaded *content*, matching how
    // export-picker-check.js already treats this same download mechanism.
    const out = path.join(__dirname, 'schedule-export.json');
    await download.saveAs(out);

    const config = JSON.parse(fs.readFileSync(out, 'utf-8'));
    console.log('[schedule config]', JSON.stringify({ recurrence: config.recurrence, repeatCount: config.repeatCount, resultKeys: config.resultKeys, actionTypes: config.workflow.actions.map((a) => a.type) }));

    assert.strictEqual(config.recurrence.type, 'weekly', 'expected the default weekly recurrence type');
    assert(Array.isArray(config.recurrence.weekdays) && config.recurrence.weekdays.length === 1, 'expected exactly one weekday selected');
    assert.strictEqual(config.repeatCount, 1);
    assert(config.resultKeys.includes(outputName.trim()), 'expected the recorded output name in resultKeys');
    assert(config.workflow.actions.some((a) => a.type === 'extractText'), 'expected the extractText action in the embedded workflow');
    assert.strictEqual(config.email.host, 'smtp.samsung.net');
    assert.strictEqual(config.email.to, 'ops@example.com');
    console.log('[ok] downloaded .schedule.json has the expected recurrence/repeatCount/resultKeys/workflow/email');

    fs.unlinkSync(out);
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: schedule-export-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
