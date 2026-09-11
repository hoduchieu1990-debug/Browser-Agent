const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');

// A Nexacro Grid has to be targeted two different ways depending on what the
// user is doing, and getting this wrong is silent:
//
//   - clicking a row/cell/tree item: the target is that exact node. Resolving
//     it up to the owning Grid (which is what `closest('[data-ba-nexacro-id]')`
//     does on its own, since the interior nodes aren't marked) records "click
//     the whole grid" for what the user did to one row, and replay then calls
//     grid.click(), which does nothing useful. Confirmed against two real MES
//     recordings: roughly half their steps are TreeItemIconControl /
//     CheckBoxControl / GridBandControl nodes inside a grid, and the reference
//     tool targets each node itself and drives it by DOM click.
//
//   - extracting the table: the target is the Grid component, whose bound
//     dataset holds every row regardless of what's scrolled into view.
//
// The page below mirrors that real structure: a Grid whose interior nodes
// carry ids of the form "<grid>.body.gridrow_N.cell_N_M.celltreeitem.<part>".
const BTN_ID = 'mainframe.form.btnGo';
const EDIT_ID = 'mainframe.form.edtName';
const GRID_ID = 'mainframe.form.grdData';
const TREE_ITEM_ID = `${GRID_ID}.body.gridrow_0.cell_0_0.celltreeitem.treeitembutton`;

const row = (n, first) => `
    <div id="${GRID_ID}.body.gridrow_${n}" style="display:flex">
      ${first}
      <div id="${GRID_ID}.body.gridrow_${n}.cell_${n}_1" style="border:1px solid #bbb;width:120px;height:24px">name${n}</div>
    </div>`;

const PAGE = `<!doctype html>
<html><body style="padding:20px">
  <div id="${BTN_ID}" style="border:1px solid #999;width:80px;height:24px">Go</div>
  <div id="${EDIT_ID}" style="border:1px solid #999;width:200px;height:24px"></div>
  <div id="${GRID_ID}" style="border:1px solid #333;width:400px;margin-top:8px">
    <div id="${GRID_ID}.body">
      ${row(0, `<div id="${TREE_ITEM_ID}" class="TreeItemIconControl" style="border:1px solid #bbb;width:120px;height:24px">tree item</div>`)}
      ${row(1, `<div id="${GRID_ID}.body.gridrow_1.cell_1_0" style="border:1px solid #bbb;width:120px;height:24px">second</div>`)}
      ${row(2, `<div id="${GRID_ID}.body.gridrow_2.cell_2_0" style="border:1px solid #bbb;width:120px;height:24px">third</div>`)}
    </div>
  </div>
  <script>
    const mk = (t) => ({ _type_name: t, click() { window._clicked = t; }, onclick: {} });
    const treeitembutton = mk('TreeItemIconControl');
    const grdData = mk('Grid');
    grdData.body = { gridrow_0: { cell_0_0: { celltreeitem: { treeitembutton } } } };
    const edtName = { _type_name: 'Edit', value: '', set_value(v) { this.value = v; }, setFocus() {}, onchange() {} };
    const app = { mainframe: { form: { btnGo: mk('Button'), edtName, grdData } } };
    window.nexacro = { getApplication: () => app };
  </script>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const profileDir = path.join(__dirname, 'profile-nexacro-grid-target');
  fs.rmSync(profileDir, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profileDir, {
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
    await tab.waitForTimeout(1200); // the bridge marks on a 500ms poll

    // Table extraction goes first: "click to aim, then Add" deliberately
    // folds a click into the capture that follows it when the captured
    // element contains it (see content-script.ts's takeSupersededClick), and
    // every click here lands inside the grid being captured.
    //
    // Extracting from a cell must still name the Grid component, whose bound
    // dataset is where the rows come from.
    const cell = tab.locator(`[id="${GRID_ID}.body.gridrow_1.cell_1_0"]`);
    const box = await cell.boundingBox();
    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tab.waitForTimeout(200);
    const badge = tab.locator('#__browser_agent_add_badge__');
    await cell.click({ button: 'right', modifiers: ['Control'] });
    await tab.waitForTimeout(300);
    const tableOption = badge.locator('button', { hasText: 'Table data' });
    const offered = await tableOption.isVisible();
    assert(offered, 'expected "Table data" to be offered when hovering a Nexacro grid cell');
    await tableOption.click();
    await tab.waitForTimeout(400);

    // The top-level components are still recognised as components.
    await tab.click(`[id="${BTN_ID}"]`);
    await tab.waitForTimeout(200);
    // The tree item inside the grid is not — it must be targeted by itself.
    await tab.click(`[id="${TREE_ITEM_ID}"]`);
    await tab.waitForTimeout(200);

    await popup.click('.record-btn.stop');
    await tab.waitForTimeout(200);

    const actions = await popup.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      return state.actions;
    });
    const clicks = actions.filter((a) => a.type === 'click');
    console.log('[recorded clicks]', JSON.stringify(clicks));

    const button = clicks.find((a) => a.selector === `nexacro:${BTN_ID}`);
    assert(button, `expected the Button to still record as nexacro:${BTN_ID}, got: ${JSON.stringify(clicks)}`);
    console.log('[ok] a top-level component still records as a nexacro: selector');

    const treeClick = clicks.find((a) => a.selector !== `nexacro:${BTN_ID}`);
    assert(treeClick, 'expected a second click step for the tree item');
    assert.notStrictEqual(
      treeClick.selector,
      `nexacro:${GRID_ID}`,
      'the tree item was swallowed by its grid — replay would click the whole grid instead of the row',
    );
    assert(
      treeClick.selector.includes('treeitembutton'),
      `expected the tree item's own node to be targeted, got: ${treeClick.selector}`,
    );
    console.log(`[ok] a node inside a grid targets itself, not the grid — ${treeClick.selector}`);

    const table = actions.find((a) => a.type === 'extractTable');
    assert(table, `expected an extractTable step, got: ${JSON.stringify(actions.map((a) => a.type))}`);
    assert.strictEqual(
      table.selector,
      `nexacro:${GRID_ID}`,
      `a table step must name the Grid component so extraction reads its dataset, got: ${table.selector}`,
    );
    console.log('[ok] extracting from a cell still targets the Grid component itself');

    await popup.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: nexacro-grid-target-check');
})().catch((err) => {
  console.error('FAILED:', err.stack || err.message || err);
  process.exit(1);
});
