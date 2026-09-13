const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Two real problems found on a live Nexacro app when Ctrl+Right-clicking a
// text field:
//
// 1. Right-clicking it (Ctrl held, unavoidable — that's the gesture) let
//    the page's own mousedown handler also fire and focus the field as a
//    side effect; the OS's own key-repeat for the still-held Ctrl key then
//    got routed into the now-focused field's onkeydown handler on every
//    repeat, which crashed on a bare modifier key — over and over, for as
//    long as the button stayed held. Playwright can't reproduce OS-level
//    key-repeat, so this checks the two things that actually prevent that
//    chain from ever starting: the page's own mousedown handler never sees
//    the click (propagation stopped), and the field never gains focus
//    (default action prevented) — either alone is enough to keep any
//    keydown routed elsewhere.
//
// 2. Nexacro renders its own mouse cursor as a real, pointer-events:auto DOM
//    element that tracks the pointer and happened to sit exactly over the
//    field — the browser's own hit-testing (confirmed with
//    document.elementFromPoint, not just event.target) landed on that
//    instead, so the menu would try to act on "the mouse cursor icon".
const PAGE = `<!doctype html><html><body style="padding:40px">
  <input id="field" style="width:200px" />
  <script>
    window.mousedownReachedPage = false;
    document.addEventListener('mousedown', () => { window.mousedownReachedPage = true; });


    // A fake "virtual mouse cursor" overlay, positioned over the field,
    // exactly like the real one confirmed live: a real DOM element with
    // pointer-events:auto that the browser's own hit-testing lands on.
    const cursor = document.createElement('div');
    cursor.id = 'app.__virtual_mouse_base_div.form.__sta_user_cursor';
    cursor.style.cssText = 'position:fixed;left:40px;top:40px;width:200px;height:40px;pointer-events:auto;background:transparent';
    document.body.appendChild(cursor);
  </script>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'nexacro-textfield-interference-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    const pageErrors = [];
    tab.on('pageerror', (err) => pageErrors.push(err.message));
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(400);

    // ---- 1: Ctrl+Right-click on the cursor-overlaid field must not open
    // the menu for "the cursor icon", and must not let the page's own
    // mousedown handler see the click at all (which is what let the crash
    // loop start in the first place).
    const box = await tab.locator('#field').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await tab.mouse.move(cx, cy);
    await tab.waitForTimeout(100);
    await tab.keyboard.down('Control');
    await tab.mouse.click(cx, cy, { button: 'right' });
    await tab.waitForTimeout(400);
    await tab.keyboard.up('Control');
    await tab.waitForTimeout(200);

    const menuVisible = await tab.evaluate(() => {
      const menu = document.getElementById('__browser_agent_add_badge__');
      return menu?.style.display !== 'none' && !!menu;
    });
    check('the virtual-cursor overlay is excluded — no menu opens for it', !menuVisible);

    const mousedownReachedPage = await tab.evaluate(() => window.mousedownReachedPage);
    check('the page never saw the mousedown at all (propagation stopped)', mousedownReachedPage === false);

    const fieldFocused = await tab.evaluate(() => document.activeElement?.id === 'field');
    check('the field never gained focus (default action prevented)', !fieldFocused);

    check('no uncaught page error occurred', pageErrors.length === 0, JSON.stringify(pageErrors));

    // ---- 2: a normal element elsewhere on the page must still work fine —
    // the exclusion is narrow, not a general breakage of Ctrl+Right-click.
    await tab.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'plain-text';
      p.textContent = 'ordinary paragraph';
      p.style.marginTop = '100px';
      document.body.appendChild(p);
    });
    await tab.hover('#plain-text');
    await tab.click('#plain-text', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(300);
    const normalMenuVisible = await tab.evaluate(() => {
      const menu = document.getElementById('__browser_agent_add_badge__');
      return menu?.style.display !== 'none' && !!menu;
    });
    check('an ordinary element elsewhere still opens the menu normally', normalMenuVisible);
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
