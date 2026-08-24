const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// The user asked, explicitly: textbox, button, checkbox, radio button,
// table, dropdown, listbox — every one of these must show the Add badge
// with sensible options when hovered.
const PAGE = `<!doctype html><html><body style="padding:20px;font-family:sans-serif">
  <input id="textbox" type="text" value="hello" style="display:block;margin-bottom:10px" />
  <button id="button" style="display:block;margin-bottom:10px">Click me</button>
  <label style="display:block;margin-bottom:10px"><input id="checkbox" type="checkbox" /> a checkbox</label>
  <label style="display:block;margin-bottom:10px"><input id="radio" type="radio" name="r" /> a radio</label>
  <table id="table" border="1" style="margin-bottom:10px">
    <tr><th>Name</th><th>Age</th></tr>
    <tr><td>Alice</td><td>30</td></tr>
  </table>
  <select id="dropdown" style="display:block;margin-bottom:10px">
    <option>One</option>
    <option>Two</option>
  </select>
  <ul id="listbox" role="listbox" style="display:block;margin-bottom:10px">
    <li role="option" id="listbox-item">Option A</li>
  </ul>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'control-types-profile'), {
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
      const box = await tab.locator(selector).boundingBox();
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.waitForTimeout(300);

      const visible = await badge.evaluate((el) => el.style.display !== 'none').catch(() => false);
      if (!visible) return null;

      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(200);
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

    const controls = [
      ['textbox', '#textbox'],
      ['button', '#button'],
      ['checkbox', '#checkbox'],
      ['radio button', '#radio'],
      ['table', '#table'],
      ['dropdown (select)', '#dropdown'],
      ['listbox item (role=option)', '#listbox-item'],
    ];

    for (const [label, selector] of controls) {
      const options = await optionsFor(selector);
      check(`${label} shows the Add badge`, options !== null, options ? options.join(' | ') : 'badge never appeared');
      if (options) check(`${label} offers at least one capture option`, options.length > 0, options.join(' | '));
    }

    // The table specifically should offer "Table data", the button/checkbox/
    // radio/dropdown should offer batch Input/Click, not just plain text.
    const tableOptions = await optionsFor('#table');
    check('table offers "Table data"', tableOptions?.some((o) => o.includes('Table data')) ?? false, tableOptions?.join(' | '));

    const buttonOptions = await optionsFor('#button');
    check('button offers "Click"', buttonOptions?.some((o) => o.includes('Click')) ?? false, buttonOptions?.join(' | '));

    const checkboxOptions = await optionsFor('#checkbox');
    check('checkbox offers "Click"', checkboxOptions?.some((o) => o.includes('Click')) ?? false, checkboxOptions?.join(' | '));

    const dropdownOptions = await optionsFor('#dropdown');
    check(
      'dropdown offers "Input" (for selecting an option)',
      dropdownOptions?.some((o) => o.includes('Input')) ?? false,
      dropdownOptions?.join(' | '),
    );

    await popup.click('.record-btn.stop').catch(() => {});
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: control-types-check');
    process.exit(1);
  }
  console.log('PASS: control-types-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
