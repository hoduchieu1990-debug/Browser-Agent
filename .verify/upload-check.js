const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const TEST_HTML = `<!doctype html>
<html><body style="padding:40px">
  <input type="file" id="file-input" />
  <input type="file" id="file-input-2" />
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(TEST_HTML);
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
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    const extensionId = worker.url().split('/')[2];

    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await testPage.bringToFront();
    await popup.click('text=Start');

    // click file inputs, dismissing the native OS picker each time so the test doesn't hang
    for (const selector of ['#file-input', '#file-input-2']) {
      const chooserPromise = testPage.waitForEvent('filechooser');
      await testPage.click(selector);
      const chooser = await chooserPromise;
      await chooser.setFiles([]);
    }

    await popup.bringToFront();
    await popup.waitForTimeout(500);

    await popup.click('text=Export');
    await popup.fill('.form-input', 'upload-test');
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('.export-btn')]);
    const savedPath = path.join(__dirname, 'workflow.json');
    await download.saveAs(savedPath);
    const fs = require('fs');
    console.log(fs.readFileSync(savedPath, 'utf-8'));
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
