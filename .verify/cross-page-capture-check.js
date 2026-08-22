const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = (label) => `<!doctype html><html><body style="padding:24px;font-family:sans-serif">
  <div id="v1" style="width:220px;height:30px;background:#eef">${label}-ONE</div>
  <div id="v2" style="width:220px;height:30px;background:#efe;margin-top:10px">${label}-TWO</div>
  <a id="next" href="/second" style="display:block;margin-top:20px">go to second</a>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE(req.url.startsWith('/second') ? 'PAGE2' : 'PAGE1'));
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
    await tab.setViewportSize({ width: 800, height: 600 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(600);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const addText = async (selector) => {
      const box = await tab.locator(selector).boundingBox();
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.waitForTimeout(350);
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(150);
      await badge.locator('button', { hasText: 'Text value' }).click();
      await tab.waitForTimeout(350);
    };

    await addText('#v1');
    await addText('#v2');

    // navigating reloads the content script, which is what used to restart
    // the capture numbering and overwrite everything from the first page
    await tab.click('#next');
    await tab.waitForLoadState();
    await tab.waitForTimeout(900);

    await addText('#v1');
    await addText('#v2');

    await popup.bringToFront();
    await popup.waitForTimeout(500);
    const outputs = (await popup.locator('.action-value').allTextContents()).map((v) => v.replace('→ ', '').trim());
    const unique = new Set(outputs);
    check('all four captures got distinct names', outputs.length === 4 && unique.size === 4, outputs.join(', '));

    // ---- replay: every capture must survive into the results ----
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    // the recorder must replay into the site's tab, not the popup's own
    await tab.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.result-block').first().waitFor({ timeout: 60000 });
    // the run is still going at that point — wait for it to actually finish,
    // or the last page's captures have not landed yet
    await popup.waitForFunction(() => !document.querySelector('.replay-btn')?.hasAttribute('disabled'), {
      timeout: 60000,
    });
    await popup.waitForTimeout(600);

    const errors = await popup.locator('.error-banner').count();
    check('replay ran clean', errors === 0, errors ? (await popup.locator('.error-banner').textContent())?.trim() : '');

    const body = (await popup.locator('.result-block').allTextContents()).join(' | ');
    check('page 1 values are still there', body.includes('PAGE1-ONE') && body.includes('PAGE1-TWO'), body);
    check('page 2 values are there too', body.includes('PAGE2-ONE') && body.includes('PAGE2-TWO'), body);
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
