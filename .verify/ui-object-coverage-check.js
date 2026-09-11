const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Gaps found while cross-checking docs/UI Object/BROWSER_AGENT_UI_OBJECT_SPEC.md's
// Layer 1 (DOM) / Layer 2 (ARIA) mappings against what the badge actually
// recognized: <summary> (the expand/collapse trigger for <details>, already
// handled by the general hover highlighter but not by the Add badge itself),
// <audio>, role="img" (for anything that isn't a native media tag but is
// still accessibly marked as an image), and range/color inputs incorrectly
// offering "Type text" when neither supports meaningful typed entry.
//
// <summary> gets a native pointer cursor from the UA stylesheet and is
// natively focusable, and <audio controls> is natively focusable too — both
// would already match through an unrelated existing path (cursor:pointer /
// tabIndex >= 0) regardless of this fix, so tabindex="-1" below removes
// that, and the summary is icon-only (no text) so findTextTarget's fallback
// can't paper over it either — the same way the custom-checkbox test
// defeats cursor inheritance to actually exercise the tag-based check
// instead of an accidental fallback.
const PAGE = `<!doctype html><html><body style="padding:20px;font-family:sans-serif">
  <details style="display:block;margin-bottom:10px">
    <summary id="summary" tabindex="-1"><svg width="16" height="16"><circle cx="8" cy="8" r="6" /></svg></summary>
  </details>
  <audio id="audio" controls tabindex="-1" style="display:block;margin-bottom:10px"></audio>
  <div id="iconimg" role="img" aria-label="Company logo" style="display:inline-block;width:24px;height:24px;background:#ccc;margin-bottom:10px"></div>
  <input id="range" type="range" style="display:block;margin-bottom:10px" />
  <input id="color" type="color" style="display:block;margin-bottom:10px" />
  <input id="date" type="date" style="display:block;margin-bottom:10px" />
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'ui-object-coverage-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const results = [];
  const check = (name, passed, detail = '') => {
    results.push({ name, passed });
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    await tab.setViewportSize({ width: 900, height: 900 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(700);

    const badge = tab.locator('#__browser_agent_add_badge__');

    const optionsFor = async (selector) => {
      await tab.mouse.move(5, 5);
      await tab.waitForTimeout(120);
      await tab.hover(selector);
      await tab.click(selector, { button: 'right', modifiers: ['Control'] });
      await tab.waitForTimeout(300);

      const visible = await badge.evaluate((el) => el.style.display !== 'none').catch(() => false);
      if (!visible) return null;

      const shown = await badge.evaluate((root) => {
        const menu = root.querySelector('[data-ba-role="menu"]');
        if (!menu || menu.style.display === 'none') return [];
        return Array.from(menu.querySelectorAll('button'))
          .filter((b) => b.style.display !== 'none')
          .map((b) => b.textContent.trim());
      });
      await tab.keyboard.press('Escape');
      await tab.waitForTimeout(120);
      return shown;
    };

    const summaryOptions = await optionsFor('#summary');
    check('<summary> shows the Add badge', summaryOptions !== null, summaryOptions?.join(' | '));
    check(
      '<summary> offers batch "Click" (expand/collapse trigger)',
      summaryOptions?.some((o) => o.includes('Click')) ?? false,
      summaryOptions?.join(' | '),
    );

    const audioOptions = await optionsFor('#audio');
    check('<audio> shows the Add badge', audioOptions !== null, audioOptions?.join(' | '));
    check(
      '<audio> offers "Image of this area"',
      audioOptions?.some((o) => o.includes('Image of this area')) ?? false,
      audioOptions?.join(' | '),
    );

    const iconOptions = await optionsFor('#iconimg');
    check('role="img" shows the Add badge', iconOptions !== null, iconOptions?.join(' | '));
    check(
      'role="img" offers "Image of this area"',
      iconOptions?.some((o) => o.includes('Image of this area')) ?? false,
      iconOptions?.join(' | '),
    );

    const rangeOptions = await optionsFor('#range');
    check('range input shows the Add badge', rangeOptions !== null, rangeOptions?.join(' | '));
    check(
      'range input does NOT offer "Type text"',
      !(rangeOptions?.some((o) => o.includes('Type text')) ?? true),
      rangeOptions?.join(' | '),
    );

    const colorOptions = await optionsFor('#color');
    check('color input shows the Add badge', colorOptions !== null, colorOptions?.join(' | '));
    check(
      'color input does NOT offer "Type text"',
      !(colorOptions?.some((o) => o.includes('Type text')) ?? true),
      colorOptions?.join(' | '),
    );

    // control: a date input still offers Type text — this is not a blanket
    // "no native input types get it" regression, only range/color.
    const dateOptions = await optionsFor('#date');
    check(
      'date input still offers "Type text" (not over-excluded)',
      dateOptions?.some((o) => o.includes('Type text')) ?? false,
      dateOptions?.join(' | '),
    );

    await popup.click('.record-btn.stop').catch(() => {});
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: ui-object-coverage-check');
    process.exit(1);
  }
  console.log('PASS: ui-object-coverage-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
