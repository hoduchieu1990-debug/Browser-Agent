const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

// Mirrors the reported failure on a Tailwind docs site: a <pre> code block with
// no identifying attributes, reachable only through utility-class wrappers.
const page = (extraSection) => `<!doctype html>
<html><body class="antialiased text-slate-800">
  <header class="border-b p-4"><span class="font-semibold">Docs</span></header>
  <main class="mx-auto max-w-3xl p-6">
    <div class="flex flex-col [&>*+*]:mt-5">
      <div class="prose"><h1 class="text-2xl font-bold">Getting started</h1></div>
      ${extraSection ? '<div class="rounded border p-4"><p>New callout block</p></div>' : ''}
      <div class="grid gap-2">
        <p class="text-sm">Install the package:</p>
        <div class="rounded bg-slate-900 p-3">
          <pre class="overflow-x-auto text-xs">npm install browser-agent</pre>
        </div>
      </div>
    </div>
  </main>
</body></html>`;

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

let shifted = false;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page(shifted));
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
    await tab.setViewportSize({ width: 1000, height: 700 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(600);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const preBox = await tab.locator('pre').boundingBox();
    await tab.mouse.move(preBox.x + 60, preBox.y + preBox.height / 2);
    await tab.waitForTimeout(400);
    await badge.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(250);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(400);

    await tab.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    const recorded = await popup.evaluate(
      () =>
        new Promise((r) =>
          chrome.runtime.sendMessage({ type: 'GET_STATE' }, (s) =>
            r(s.actions.map((a) => ({ type: a.type, selector: a.selector, fallbacks: a.selectorFallbacks ?? [] }))),
          ),
        ),
    );
    const step = recorded.find((a) => a.type === 'extractText');
    console.log('  selector :', step.selector);
    console.log('  fallbacks:', step.fallbacks);

    check('no Tailwind utility classes in the selector',
      !/\.(flex|flex-col|grid|prose|rounded|overflow-x-auto|text-xs|p-\d|gap-\d)/.test(step.selector),
      step.selector);
    check('no arbitrary-variant class in the selector', !/\[|\\/.test(step.selector), step.selector);
    check('anchored on a landmark, not loose divs', step.selector.startsWith('main'), step.selector);
    check('a fallback selector exists', step.fallbacks.length > 0, `${step.fallbacks.length}`);

    // ---------- the page gains a section, shifting nth-of-type indexes ----------
    shifted = true;
    await tab.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    // wait for the run to actually finish rather than a fixed guess
    await popup
      .locator('.result-block, .error-banner')
      .first()
      .waitFor({ timeout: 40000 });
    await popup.waitForTimeout(800);

    const errors = await popup.locator('.error-banner').count();
    const steps = await popup.locator('.step-row').allTextContents();
    check('replay still finds the code block', errors === 0,
      errors ? (await popup.locator('.error-banner').textContent()).trim() : steps.join(' | '));
    check('captured the code text',
      ((await popup.locator('.result-value').first().textContent()) ?? '').includes('npm install browser-agent'));
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
