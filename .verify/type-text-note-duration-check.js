const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:20px;font-family:sans-serif">
  <input id="code" type="text" style="width:200px" />
  <div id="a" style="width:200px;height:30px;background:#eef;margin-top:10px">Alice</div>
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

  try {
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

    // ---- (1) Type text menu item + config panel ----
    const box = await tab.locator('#code').boundingBox();
    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tab.waitForTimeout(400);
    await badge.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(200);
    const typeTextOffered = await badge.locator('button', { hasText: 'Type text' }).isVisible();
    check('"Type text" is offered over an input field', typeTextOffered);

    await badge.locator('button', { hasText: 'Type text' }).click();
    await tab.waitForTimeout(400);

    // and it must not be offered over something that isn't typeable
    const divBox = await tab.locator('#a').boundingBox();
    await tab.mouse.move(divBox.x + divBox.width / 2, divBox.y + divBox.height / 2);
    await tab.waitForTimeout(400);
    await badge.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(200);
    const typeTextOverDiv = await badge.locator('button', { hasText: 'Type text' }).isVisible();
    check('"Type text" is not offered over a plain div', !typeTextOverDiv);
    await tab.keyboard.press('Escape');
    await tab.waitForTimeout(300);

    const steps = await popup.locator('.action-type').allTextContents();
    check('an input step was recorded', steps.includes('input'), steps.join(', '));

    const panelVisible = await popup.locator('.action-batch-config').isVisible();
    check('its config panel auto-opened', panelVisible);

    const valueInput = popup.locator('.action-batch-config input[type="text"]');
    await valueInput.fill('A001');
    await valueInput.blur();
    await popup.waitForTimeout(400);

    // reopen to confirm the value round-tripped through UPDATE_ACTION
    await popup.click('text=Settings');
    await popup.waitForTimeout(150);
    await popup.click('text=Record');
    await popup.waitForTimeout(200);
    const savedValue = await popup.locator('.action-item').filter({ has: popup.locator('.action-type', { hasText: 'input' }) }).locator('.action-value').textContent();
    check('the typed value was saved', (savedValue ?? '').includes('A001'), savedValue ?? '');

    // ---- (2) note field ----
    const firstItem = popup.locator('.action-item').first();
    const note = firstItem.locator('.action-note');
    await note.fill('starting page');
    await note.blur();
    await popup.waitForTimeout(400);

    await popup.click('text=Settings');
    await popup.waitForTimeout(150);
    await popup.click('text=Record');
    await popup.waitForTimeout(200);
    const savedNote = await popup.locator('.action-item').first().locator('.action-note').inputValue();
    check('the note was saved', savedNote === 'starting page', savedNote);

    // ---- (5) durations in Preview ----
    // add one more simple capture so there's something to extract too
    await tab.bringToFront();
    await tab.mouse.move((await tab.locator('#a').boundingBox()).x + 30, (await tab.locator('#a').boundingBox()).y + 15);
    await tab.waitForTimeout(400);
    await badge.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(200);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(400);

    await popup.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    await tab.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.waitForFunction(() => !document.querySelector('.replay-btn')?.hasAttribute('disabled'), { timeout: 60000 });
    await popup.waitForTimeout(700);

    const stepDurations = await popup.locator('.step-duration').allTextContents();
    check('each step shows a duration', stepDurations.length > 0 && stepDurations.every((t) => /\d+(ms|s)/.test(t)), stepDurations.join(', '));

    const totalDuration = await popup.locator('.panel-duration').textContent();
    check('the total run time is shown', /\d+(ms|s)/.test(totalDuration ?? ''), totalDuration ?? '');
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
