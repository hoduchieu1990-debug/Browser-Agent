const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// The badge used to recognize only BUTTON/A/INPUT/SELECT/TEXTAREA plus four
// ARIA roles, so most of a modern app's interactive surface — role-based
// components, contenteditable editors, divs wired up with onclick or
// cursor:pointer — offered no Batch/Input options at all. Each element here
// is one of those previously-missed shapes.
const PAGE = `<!doctype html><html><body style="padding:20px;font-family:sans-serif">
  <div id="role-tab" role="tab" style="padding:10px;background:#eee">A role=tab</div>
  <div id="role-textbox" role="textbox" style="padding:10px;background:#dfd">A role=textbox</div>
  <div id="editable" contenteditable="true" style="padding:10px;background:#ffd">Editable text</div>
  <div id="onclick-div" onclick="void 0" style="padding:10px;background:#ddf">Wired with onclick</div>
  <div id="pointer-div" style="padding:10px;background:#fdd;cursor:pointer">Styled cursor:pointer</div>
  <div id="tabindex-div" tabindex="0" style="padding:10px;background:#dff">Focusable via tabindex</div>
  <div id="plain-div" style="padding:10px;background:#f4f4f4">Plain, non-interactive</div>
  <p id="long-text" style="padding:10px">${'word '.repeat(90)}</p>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'badge-coverage-profile'), {
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
    await tab.setViewportSize({ width: 900, height: 800 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(700);

    const badge = tab.locator('#__browser_agent_add_badge__');

    // Opens the Add menu over one element and reports which options it
    // offers. Ctrl+Right-click is the only opener now — it has to go through
    // the selector-based click API, since page.mouse.click() takes no
    // `modifiers` option and the handler checks event.ctrlKey.
    const optionsFor = async (selector) => {
      await tab.mouse.move(5, 5);
      await tab.waitForTimeout(120);
      await tab.hover(selector);
      await tab.click(selector, { button: 'right', modifiers: ['Control'] });
      await tab.waitForTimeout(300);

      const visible = await badge.evaluate((el) => el.style.display !== 'none');
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

    const interactive = [
      ['role=tab', '#role-tab'],
      ['role=textbox', '#role-textbox'],
      ['contenteditable', '#editable'],
      ['onclick div', '#onclick-div'],
      ['cursor:pointer div', '#pointer-div'],
      ['tabindex div', '#tabindex-div'],
    ];

    for (const [label, selector] of interactive) {
      const options = await optionsFor(selector);
      const hasBatch = !!options && options.some((o) => /Click|Input|Search|Extract/.test(o));
      check(`${label} is recognized as an interactive target`, hasBatch, options ? options.join(' | ') : 'badge never appeared');
    }

    // Typing options must follow the same widening — a contenteditable div and
    // a role=textbox take typed text just like a real <input> does.
    for (const [label, selector] of [['contenteditable', '#editable'], ['role=textbox', '#role-textbox']]) {
      const options = await optionsFor(selector);
      const hasType = !!options && options.some((o) => o.includes('Type text'));
      check(`${label} offers "Type text"`, hasType, options ? options.join(' | ') : 'badge never appeared');
    }

    // A long paragraph (over the old 300-char cap) is still a legitimate thing
    // to capture — it used to be silently skipped entirely.
    const longOptions = await optionsFor('#long-text');
    const hasTextValue = !!longOptions && longOptions.some((o) => o.includes('Text value'));
    check('a long paragraph still offers "Text value"', hasTextValue, longOptions ? longOptions.join(' | ') : 'badge never appeared');

    await popup.click('.record-btn.stop').catch(() => {});
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: badge-coverage-check');
    process.exit(1);
  }
  console.log('PASS: badge-coverage-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
