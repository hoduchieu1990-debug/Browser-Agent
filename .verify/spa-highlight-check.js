const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

// Simulates a React-style app that stomps any inline style on the button
// every 50ms (mimicking aggressive DOM reconciliation), plus puts the button
// inside an iframe (common in real corporate apps).
const IFRAME_HTML = `<!doctype html>
<html><body style="padding:60px">
  <button id="save-btn" style="padding:10px 20px;">Save</button>
  <script>
    setInterval(() => {
      const btn = document.getElementById('save-btn');
      btn.setAttribute('style', 'padding:10px 20px;'); // wipes any externally-added inline style
    }, 50);
  </script>
</body></html>`;

const HOST_HTML = `<!doctype html>
<html><body>
  <iframe id="frame" src="/frame" style="width:600px;height:400px;border:1px solid #ccc"></iframe>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url === '/frame' ? IFRAME_HTML : HOST_HTML);
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

    const frame = testPage.frameLocator('#frame');
    await frame.locator('#save-btn').hover();
    await testPage.waitForTimeout(400); // let the 50ms stomp loop run several times

    const overlay = testPage.locator('#__browser_agent_highlight__');
    const overlayCountInFrame = await frame.locator('#__browser_agent_highlight__').count();
    console.log('overlay present in iframe document:', overlayCountInFrame > 0);
    if (overlayCountInFrame > 0) {
      const box = await frame.locator('#__browser_agent_highlight__').boundingBox();
      console.log('overlay visible box:', box);
      const display = await frame.locator('#__browser_agent_highlight__').evaluate((el) => el.style.display);
      console.log('overlay display style:', display);
    }

    // also confirm click recording works inside the iframe
    await frame.locator('#save-btn').click();
    await popup.bringToFront();
    await popup.waitForTimeout(400);
    const recorded = await popup.locator('.action-selector').first().textContent();
    console.log('recorded selector for click inside iframe:', recorded);
  } finally {
    await context.close();
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
