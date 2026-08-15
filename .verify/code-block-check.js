const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

// The reported page: a docs site where every code block is syntax-highlighted
// into anonymous spans, and several blocks look identical to a selector.
const block = (text) => `
      <div class="rounded bg-slate-900 p-3">
        <pre class="overflow-x-auto text-xs"><code><span class="tok"><span>${text.split(' ')[0]}</span></span> <span class="tok"><span>${text
          .split(' ')
          .slice(1)
          .join(' ')}</span></span></code></pre>
      </div>`;

const page = (extraSection) => `<!doctype html>
<html><body class="antialiased">
  <header class="border-b p-4">Docs</header>
  <main class="mx-auto max-w-3xl p-6">
    <div class="flex flex-col [&>*+*]:mt-5">
      <div class="prose"><h1 class="text-2xl">Getting started</h1></div>
      ${extraSection ? '<div class="rounded border p-4"><p>New callout</p></div>' : ''}
      ${block('npm install browser-agent')}
      ${block('npx browser-agent run workflow.json')}
      ${block('npx browser-agent validate workflow.json')}
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
    await tab.setViewportSize({ width: 1000, height: 800 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(600);

    // aim at a highlighted token inside the SECOND code block
    const token = tab.locator('pre').nth(1).locator('span span').first();
    const tokenBox = await token.boundingBox();
    await tab.mouse.move(tokenBox.x + 4, tokenBox.y + tokenBox.height / 2);
    await tab.waitForTimeout(450);

    const frameLabel = await tab.locator('#__browser_agent_target_frame__').boundingBox();
    const preBox = await tab.locator('pre').nth(1).boundingBox();
    check('frames the code block, not the token', Math.abs(frameLabel.width - preBox.width) < 6,
      `frame ${Math.round(frameLabel.width)} vs pre ${Math.round(preBox.width)}`);

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

    check('no deep positional path', !step.selector.startsWith('body >'), step.selector);
    check('addresses the right block by index', step.selector.includes('nth-match'), step.selector);

    // ---------- the page gains a section above the blocks ----------
    shifted = true;
    await tab.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.locator('.result-block, .error-banner').first().waitFor({ timeout: 40000 });
    await popup.waitForTimeout(800);

    const errors = await popup.locator('.error-banner').count();
    check('replay survives the layout change', errors === 0,
      errors ? (await popup.locator('.error-banner').textContent()).trim() : '');

    const value = ((await popup.locator('.result-value').first().textContent()) ?? '').trim();
    console.log('  captured :', JSON.stringify(value));
    check('captured the second block, not the first', value.includes('run workflow.json'), value);
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
