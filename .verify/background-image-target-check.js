const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Reported gap, confirmed on a live Nexacro app (demo.tobesoft.com): nearly
// every icon/logo/photo on the page renders as a bare <div> with its
// picture set via CSS background-image, not an <img> tag — findImageTarget
// only ever recognized actual img/picture/canvas/video/audio tags or
// role="img", so "Image of this area" was never offered for any of them.
const PAGE = `<!doctype html><html><body style="padding:40px">
  <div id="logo" style="width:150px;height:36px;background-image:url('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7')"></div>
  <div id="gradient" style="width:150px;height:36px;background-image:linear-gradient(red, blue)"></div>
  <div id="plain" style="width:150px;height:36px;border:1px solid #999"></div>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'background-image-target-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
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
    await tab.waitForTimeout(400);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const offersImage = async (selector) => {
      await tab.hover(selector);
      await tab.click(selector, { button: 'right', modifiers: ['Control'] });
      await tab.waitForTimeout(250);
      const offered = await badge
        .locator('button', { hasText: 'Image of this area' })
        .isVisible()
        .catch(() => false);
      await tab.keyboard.press('Escape');
      await tab.waitForTimeout(150);
      return offered;
    };

    check('a div with a real background-image (url()) offers "Image of this area"', await offersImage('#logo'));
    // A gradient isn't a photo findImageTarget would recognize on its own,
    // but the menu still has to offer *something* here — confirmed live on
    // a real Nexacro app, where a purely decorative panel (no text, no
    // background-image, not interactive) was still a real, visible thing
    // the user wanted to screenshot. "Image of this area" falling back to
    // whatever the hover highlight already outlines (findClickableAncestor,
    // which always returns something for a real element) is what makes
    // "Add works here" match "the hover outline shows here" everywhere,
    // not just for elements findImageTarget happens to recognize.
    check('a div with a gradient background still offers it (a generic screenshot fallback)', await offersImage('#gradient'));
    check('a plain bordered div with nothing else still offers it too', await offersImage('#plain'));
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
