const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Same end-to-end flows as the Chrome checks, but driving the real Edge build.
const PAGE = `<!doctype html>
<html><body style="padding:40px;font-family:Segoe UI,sans-serif">
  <div>Total: <span id="total">1,284</span></div>
  <button id="go">Go</button>
  <table id="results" border="1" cellpadding="6" style="border-collapse:collapse;margin-top:12px">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody>
  </table>
</body></html>`;

const OTHER = `<!doctype html><html><body style="padding:40px"><h1>Unrelated page</h1></body></html>`;

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url.startsWith('/other') ? OTHER : PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'edge-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const browserName = await context.pages()[0]?.evaluate(() => navigator.userAgent).catch(() => '');
    console.log('user agent:', browserName || '(n/a)');
    check('running on Edge', /Edg\//.test(browserName || ''), browserName ? browserName.match(/Edg\/[\d.]+/)?.[0] : '');

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];
    check('extension loaded in Edge', Boolean(extensionId), extensionId);

    const testPage = await context.newPage();
    await testPage.goto(`${base}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    check('popup renders', (await popup.locator('.breadcrumb-parent').textContent()) === 'Browser Agent');

    // ---------- recording ----------
    await testPage.bringToFront();
    await popup.click('text=Start');
    await testPage.waitForTimeout(500);

    await testPage.click('#go');
    await testPage.waitForTimeout(250);

    const badge = testPage.locator('#__browser_agent_add_badge__');
    const trigger = badge.locator('button', { hasText: 'Add' });

    await testPage.hover('#total');
    await testPage.waitForTimeout(350);
    check('Add badge appears on hover', await badge.isVisible());

    await trigger.click();
    await testPage.waitForTimeout(200);
    check('menu hides Table option over plain text', !(await badge.locator('button', { hasText: 'Table data' }).isVisible()));
    await badge.locator('button', { hasText: 'Text value' }).click();
    await testPage.waitForTimeout(300);

    await testPage.hover('td >> text=Alice');
    await testPage.waitForTimeout(350);
    await trigger.click();
    await testPage.waitForTimeout(200);
    check('menu shows Table option over a table', await badge.locator('button', { hasText: 'Table data' }).isVisible());
    await badge.locator('button', { hasText: 'Table data' }).click();
    await testPage.waitForTimeout(300);

    await testPage.hover('td >> text=Bob');
    await testPage.waitForTimeout(350);
    await trigger.click();
    await testPage.waitForTimeout(200);
    await badge.locator('button', { hasText: 'Image' }).click();
    await testPage.waitForTimeout(300);

    await testPage.bringToFront();
    await popup.click('text=Stop');
    await popup.waitForTimeout(400);

    const recordedTypes = await popup.locator('.action-type').allTextContents();
    check(
      'recorded click + text + table + image',
      JSON.stringify(recordedTypes) ===
        JSON.stringify(['navigate', 'click', 'extractText', 'extractTable', 'screenshot']),
      recordedTypes.join(', '),
    );

    // ---------- saved recordings ----------
    await popup.click('text=Saved');
    await popup.waitForTimeout(300);
    check('recording auto-saved on Stop', (await popup.locator('.saved-item').count()) >= 1);

    // ---------- visible replay (with image capture) ----------
    await testPage.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.result-image').waitFor({ timeout: 45000 });
    await popup.waitForTimeout(700);

    const errVisible = await popup.locator('.error-banner').count();
    check('visible replay ran without error', errVisible === 0, errVisible ? await popup.locator('.error-banner').textContent() : '');

    const vars = await popup.locator('.result-name').allTextContents();
    check('captured text + table + image', vars.length === 3, vars.join(', '));
    check('text value correct', (await popup.locator('.result-value').first().textContent())?.trim() === '1,284');
    check('table has 2 rows', (await popup.locator('.result-table tbody tr').count()) === 2);

    const img = await popup.locator('.result-image').evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
    check('element screenshot cropped', img.w > 10 && img.h > 10, `${img.w}x${img.h}`);

    // ---------- background replay ----------
    await testPage.goto(`${base}/other`);
    await testPage.bringToFront();
    const tabsBefore = context.pages().length;

    await popup.check('.replay-option input');
    await popup.click('.replay-btn');
    // the Replay button re-enables only when the run is over; results appear
    // mid-run, so waiting on them checks cleanup too early
    await popup.locator('.replay-btn:not([disabled])').waitFor({ timeout: 60000 });
    await popup.waitForTimeout(700);

    check('user tab untouched by background replay', testPage.url().endsWith('/other'));
    check('hidden tab closed afterwards', context.pages().length === tabsBefore, `${context.pages().length} vs ${tabsBefore}`);

    const bgSteps = await popup.locator('.step-row').allTextContents();
    check('no step failed in background mode', !bgSteps.some((s) => s.includes('✕')), bgSteps.join(' | '));
    check('background replay captured data', (await popup.locator('.result-name').count()) >= 2);

    const bgImage = await popup.locator('.result-image').count();
    check('image captured in background mode', bgImage > 0);
    if (bgImage > 0) {
      const size = await popup.locator('.result-image').evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
      check('background image is a real crop', size.w > 10 && size.h > 10, `${size.w}x${size.h}`);
    }

    // ---------- export ----------
    await popup.click('text=Export');
    await popup.fill('.form-input', 'edge-test');
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('.export-btn')]);
    const wf = path.join(__dirname, 'edge-workflow.json');
    await download.saveAs(wf);
    check('export produced a workflow file', fs.existsSync(wf));

    await popup.setViewportSize({ width: 420, height: 640 });
    await popup.screenshot({ path: path.join(__dirname, 'edge-popup.png') });
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed on Edge`);
  if (failed.length) process.exitCode = 1;
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
