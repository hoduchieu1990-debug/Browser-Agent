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

    // Configure the (now global, Settings-tab) email account once, up front —
    // collapsed behind the "✉️ Email" toggle; host/port/secure are no longer
    // exposed in the UI (they default to the company relay in types.ts).
    await popup.click('text=Settings');
    await popup.waitForTimeout(200);
    await popup.locator('.email-toggle-btn').click();
    await popup.waitForTimeout(150);
    await popup.locator('.form-input[placeholder="you@samsung.com"]').fill('ops@samsung.com');
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

    // Open Saved tab, click "Report" — this opens a genuinely separate
    // Chrome window (background.ts's openReportWindow), not an inline form.
    await popup.click('text=Saved');
    await popup.waitForTimeout(200);
    const [reportPage] = await Promise.all([
      context.waitForEvent('page'),
      popup.locator('.saved-schedule').first().click(),
    ]);
    reportPage.on('console', (msg) => { if (msg.type() === 'error') console.log('REPORTPAGE-CONSOLE-ERR>', msg.text()); });
    reportPage.on('pageerror', (err) => console.log('REPORTPAGE-ERROR>', err.message));
    await reportPage.waitForLoadState();
    await reportPage.waitForTimeout(300);

    // "To" (recipient add) is in the always-visible header.
    await reportPage.locator('.form-input[placeholder="Add a new recipient…"]').fill('ops@example.com');
    await reportPage.locator('.report-header .recipient-add-row button', { hasText: 'Add' }).click();
    await reportPage.waitForTimeout(150);
    await reportPage.locator('.report-header .form-input').last().fill('Daily numbers');

    // Schedule tab is active by default — pick a weekday, and add a SECOND
    // time (a default one already exists) to prove "repeat" now means
    // multiple independent times of day, not a repeat count.
    await reportPage.locator('.weekday-chip').first().click();
    await reportPage.locator('input[type="time"]').fill('17:30');
    await reportPage.locator('button', { hasText: '+ Add time' }).click();
    await reportPage.waitForTimeout(150);

    // Content tab — type a custom intro message.
    await reportPage.locator('.report-tab', { hasText: 'Content' }).click();
    await reportPage.locator('.report-content-textarea').fill('Hi team, here is today\'s report:');

    // Format tab — result keys + attach as CSV. Scoped to .report-tab-body:
    // the header's recipient checkboxes reuse the same .result-key-item
    // class and would otherwise be matched first (DOM order).
    await reportPage.locator('.report-tab', { hasText: 'Format' }).click();
    const outputName = await reportPage.locator('.report-tab-body .result-key-item').first().textContent();
    console.log('[available result key]', outputName.trim());
    assert(outputName.trim().length > 0, 'expected the recorded extractText output name to be listed');
    await reportPage.locator('.report-tab-body .result-key-item', { hasText: 'Attach results as a file' }).click();

    // Review tab — full email info: From/To/Subject headers plus the body preview.
    await reportPage.locator('.report-tab', { hasText: 'Review' }).click();
    const headerText = await reportPage.locator('.report-preview-headers').innerText();
    console.log('[preview headers]', headerText.replace(/\n/g, ' | '));
    assert(headerText.includes('ops@samsung.com'), 'preview headers should show the From account set in Settings');
    assert(headerText.includes('ops@example.com'), 'preview headers should show the selected To recipient');
    assert(headerText.includes('Daily numbers') || headerText.includes('[Browser Agent]'), 'preview headers should show a subject');

    const previewFrame = reportPage.frameLocator('.report-preview-frame');
    const previewText = await previewFrame.locator('body').innerText();
    assert(previewText.includes("Hi team, here is today's report:"), 'preview body should show the typed content message');
    assert(previewText.includes(outputName.trim()), 'preview body should show the selected result key');
    console.log('[ok] Review tab shows full email info (From/To/Subject headers + body) reflecting what was typed');

    const [download] = await Promise.all([
      context.waitForEvent('download'),
      reportPage.locator('.export-btn', { hasText: 'Create report' }).click(),
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
    console.log('[schedule config]', JSON.stringify({ recurrence: config.recurrence, resultKeys: config.resultKeys, content: config.content, attachment: config.attachment, actionTypes: config.workflow.actions.map((a) => a.type) }));

    assert.strictEqual(config.recurrence.type, 'weekly', 'expected the default weekly recurrence type');
    assert(Array.isArray(config.recurrence.weekdays) && config.recurrence.weekdays.length === 1, 'expected exactly one weekday selected');
    assert.deepStrictEqual([...config.recurrence.times].sort(), ['09:00', '17:30'], 'expected both configured times of day — the default plus the one just added');
    assert(config.resultKeys.includes(outputName.trim()), 'expected the recorded output name in resultKeys');
    assert(config.workflow.actions.some((a) => a.type === 'extractText'), 'expected the extractText action in the embedded workflow');
    assert.strictEqual(config.email.host, 'smtp.samsung.net', 'expected the default relay, unset in the UI');
    assert.strictEqual(config.email.user, 'ops@samsung.com', 'expected the account set in Settings > Email');
    assert.strictEqual(config.email.to, 'ops@example.com');
    assert.strictEqual(config.email.subject, 'Daily numbers');
    assert.strictEqual(config.content, "Hi team, here is today's report:");
    assert.deepStrictEqual(config.attachment, { format: 'csv' });
    assert(config.workflow.exportFormats.length === 1 && config.workflow.exportFormats[0].type === 'csv', 'attaching should set the embedded workflow\'s exportFormats');
    console.log('[ok] downloaded .schedule.json has the expected recurrence times/resultKeys/subject/content/attachment/workflow/email');

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
