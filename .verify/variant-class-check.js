const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// The reported page: <main> carries Tailwind container-query and page-variant
// classes. `hasToc` flips between visits, exactly as a docs site does.
const codeBlock = (text) =>
  `<div class="rounded bg-slate-900 p-3"><pre class="text-xs"><code><span class="tok"><span>${text}</span></span></code></pre></div>`;

const page = ({ hasToc }) => `<!doctype html>
<html><body class="antialiased">
  <div class="fixed top-0"><nav class="flex">nav</nav></div>
  <main class="@container ${hasToc ? 'page-has-toc' : 'page-no-toc'} layout-default mx-auto">
    <div class="flex flex-col [&>*+*]:mt-5">
      <h1 class="text-2xl">Reference</h1>
      ${codeBlock('one')}
      ${codeBlock('two')}
      ${codeBlock('three')}
      ${codeBlock('four')}
      ${codeBlock('npx browser-agent run workflow.json')}
    </div>
  </main>
</body></html>`;

let hasToc = true;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page({ hasToc }));
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
    await tab.setViewportSize({ width: 1000, height: 900 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(600);

    // aim at a highlighted token inside the FIFTH code block
    const token = tab.locator('pre').nth(4).locator('span span').first();
    const box = await token.boundingBox();
    await tab.mouse.move(box.x + 4, box.y + box.height / 2);
    await tab.waitForTimeout(450);

    const badge = tab.locator('#__browser_agent_add_badge__');
    await badge.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(250);
    await badge.locator('button', { hasText: 'Text value' }).click();
    await tab.waitForTimeout(500);

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

    check('no escaped framework class', !step.selector.includes('\\'), step.selector);
    check('no page-variant class', !/page-has-toc|page-no-toc|layout-default/.test(step.selector), step.selector);
    check('anchors on the bare landmark', step.selector.includes('main pre'), step.selector);

    // ---------- the page variant flips, as it does between docs pages ----------
    hasToc = false;
    await tab.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.result-block, .error-banner').first().waitFor({ timeout: 40000 });
    await popup.waitForTimeout(800);

    const errors = await popup.locator('.error-banner').count();
    check('replay survives the variant change', errors === 0,
      errors ? (await popup.locator('.error-banner').textContent()).trim() : '');

    const value = ((await popup.locator('.result-value').first().textContent()) ?? '').trim();
    console.log('  captured :', JSON.stringify(value));
    check('captured the fifth block', value.includes('npx browser-agent run'), value);
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
