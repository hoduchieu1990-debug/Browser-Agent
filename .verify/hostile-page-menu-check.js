const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Three real interference patterns found on a live Nexacro app
// (https://demo.tobesoft.com/?menu_id=home) that each independently broke
// Ctrl+Right-click, plus a Nexacro grid shape that defeats the generic
// "table-like" DOM heuristic (unlike nexacro-grid-target-check.js's fixture,
// whose uniform-sibling-rows shape happens to already satisfy it).
const PAGE = `<!doctype html><html><body style="padding:40px;margin:0">
  <div style="height:2000px"></div>
  <div id="blocked-by-window" style="width:150px;height:40px;border:1px solid #999">Blocked at window</div>
  <div id="blocked-by-mousedown" style="width:150px;height:40px;border:1px solid #999;margin-top:10px">Blocked at mousedown</div>
  <div id="scroll-noise-target" style="width:150px;height:40px;border:1px solid #999;margin-top:10px">Scroll noise</div>

  <div id="mainframe.grid" style="margin-top:10px">
    <div id="mainframe.grid.body">
      <div id="mainframe.grid.body.gridrow_0" style="display:flex">
        <div id="mainframe.grid.body.gridrow_0.cell_0_0" style="border:1px solid #bbb;width:200px">only one cell in this row</div>
      </div>
    </div>
  </div>

  <script>
    // A minimal but real component tree — the bridge resolves each dotted
    // DOM id by walking this object path by path (mainframe -> grid), so it
    // needs an actual _type_name of 'Grid' to mark anything at all.
    window.nexacro = { getApplication: () => ({ mainframe: { grid: { _type_name: 'Grid' } } }) };

    // Pattern 1: stops the contextmenu event from ever reaching document,
    // exactly like the real site's own capture-phase window listener.
    document.getElementById('blocked-by-window').addEventListener('mouseenter', () => {
      window.addEventListener('contextmenu', (e) => e.stopPropagation(), true);
    }, { once: true });

    // Pattern 2: suppresses the contextmenu event outright by calling
    // preventDefault() on the right button's mousedown — confirmed on real
    // Nexacro grid cells, where no contextmenu event fires at all afterward.
    document.getElementById('blocked-by-mousedown').addEventListener('mousedown', (e) => {
      if (e.button === 2) e.preventDefault();
    });

    // Pattern 3: fires window 'scroll' events continuously with the real
    // scroll position never actually changing — confirmed on the real site,
    // apparently part of its own virtual-scroll machinery.
    setInterval(() => window.dispatchEvent(new Event('scroll')), 20);
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
  const userDataDir = path.join(__dirname, 'hostile-page-menu-profile');

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
    const menuOpen = async () => (await badge.evaluate((el) => el.style.display)) !== 'none';

    // ---- pattern 1: contextmenu stopped between window and document ----
    await tab.hover('#blocked-by-window'); // arms the trap via mouseenter
    await tab.waitForTimeout(100);
    await tab.click('#blocked-by-window', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(250);
    check('menu opens even when contextmenu is stopped before reaching document', await menuOpen());
    await tab.keyboard.press('Escape');
    await tab.waitForTimeout(150);

    // ---- pattern 2: contextmenu suppressed entirely via mousedown ----
    await tab.click('#blocked-by-mousedown', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(250);
    check('menu opens via the mousedown fallback when contextmenu never fires at all', await menuOpen());
    await tab.keyboard.press('Escape');
    await tab.waitForTimeout(150);

    // ---- pattern 3: continuous no-op scroll events must not close the menu ----
    await tab.click('#scroll-noise-target', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(500); // several fake scroll events fire in this window
    check('menu survives spurious scroll events with no real position change', await menuOpen());
    await tab.keyboard.press('Escape');
    await tab.waitForTimeout(150);

    // A genuine scroll (real position change) must still close it.
    await tab.click('#scroll-noise-target', { button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(200);
    const beforeScroll = await tab.evaluate(() => window.scrollY);
    // Jump to the opposite end of the page — guaranteed to differ from
    // wherever we ended up, unlike scrolling further in the same direction
    // (which can be a no-op once already at the scrollable max).
    await tab.evaluate((y) => window.scrollTo(0, y > 100 ? 0 : 1000), beforeScroll);
    await tab.waitForTimeout(200);
    check('a real scroll (actual position change) still closes the menu', !(await menuOpen()));

    // ---- Nexacro grid cell that defeats the generic table-like heuristic ----
    const cell = tab.locator('[id="mainframe.grid.body.gridrow_0.cell_0_0"]');
    await cell.hover();
    await tab.waitForTimeout(1200); // the bridge marks nexacro elements on a poll
    await cell.click({ button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(300);
    const tableOffered = await badge.locator('button', { hasText: 'Table data' }).isVisible().catch(() => false);
    check(
      '"Table data" is offered for a Nexacro grid cell even when the generic heuristic would miss it (single-cell row)',
      tableOffered,
    );
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
