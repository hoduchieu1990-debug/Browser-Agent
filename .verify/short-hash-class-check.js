const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// A CSS-Modules/Create-React-App style build: short digit-led, mixed-case
// class names (`_1pRnX`) that regenerate on every deploy. Reported bug: a
// real site (violympic.vn) recorded a selector built on exactly this shape,
// which broke the very next time the site redeployed with new hashes.
// No id on purpose — an id would short-circuit the selector builder before
// it ever has to decide whether the class is trustworthy.
const PAGE = `<!doctype html><html><body style="padding:40px">
  <button class="_1pRnX">Vào thi</button>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'short-hash-class-profile');

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

    await tab.click('._1pRnX');
    await tab.waitForTimeout(250);

    await tab.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    const actions = await popup.evaluate(
      () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_STATE' }, (s) => resolve(s.actions))),
    );
    const click = actions.find((a) => a.type === 'click');
    console.log('[recorded click]', JSON.stringify(click));

    check(
      'the primary selector does not rely on the short hashed class',
      !click.selector.includes('_1pRnX'),
      click.selector,
    );
    check(
      'no fallback selector relies on the short hashed class either',
      !(click.selectorFallbacks ?? []).some((s) => s.includes('_1pRnX')),
      JSON.stringify(click.selectorFallbacks),
    );

    // Prove it still replays correctly (e.g. via a positional/id-based path)
    // even without that class in the picture at all.
    const replaySelector = click.selector;
    const stillFindsIt = await tab.evaluate((sel) => {
      try {
        const nth = /^:nth-match\((.+),\s*(\d+)\)$/.exec(sel);
        const el = nth ? document.querySelectorAll(nth[1])[Number(nth[2]) - 1] : document.querySelector(sel);
        return el === document.querySelector('button._1pRnX');
      } catch {
        return false;
      }
    }, replaySelector);
    check('the generated selector still resolves to the right element', stillFindsIt);
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
