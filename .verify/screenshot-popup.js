const { chromium } = require('playwright');
const path = require('path');

(async () => {
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

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 420, height: 560 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(300);
    await popup.screenshot({ path: path.join(__dirname, 'popup-record.png') });

    await popup.click('text=Start');
    await popup.waitForTimeout(300);
    await popup.screenshot({ path: path.join(__dirname, 'popup-recording.png') });

    await popup.click('text=Export');
    await popup.screenshot({ path: path.join(__dirname, 'popup-export.png') });

    console.log('Screenshots saved.');
  } finally {
    await context.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
