const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Same fixture/assertions as nexacro-dynamic-window-check.js (CLI/player
// path), but drives extension/src/nexacro-bridge.ts directly — the bridge's
// own resolveComponent/extractGridData logic is a separate, independently
// duplicated implementation from player/src/utils/nexacro.ts (page.evaluate
// only serializes the function it's given, so the two can't share code),
// and needs its own proof it recovers a stale dynamic work-window instance
// id and reads Grid data off the bound dataset rather than the DOM.
//
// Talks to the bridge's own request/response CustomEvent protocol directly
// (bypassing the recorder/replay UI) so this targets exactly what changed in
// nexacro-bridge.ts, the same way nexacro-check.js proves the marking +
// click/set_value path against the single-frame case.
const RECORDED_INSTANCE = 'winTEST0001_0_111';
const LIVE_INSTANCE = 'winTEST0001_0_777';
const CODE_ID = `mainframe.workFrameSet.${RECORDED_INSTANCE}.form.edtCode`;
const GO_ID = `mainframe.workFrameSet.${RECORDED_INSTANCE}.form.btnGo`;
const GRID_ID = `mainframe.workFrameSet.${RECORDED_INSTANCE}.form.grdItems`;

const PAGE = `<!doctype html>
<html><body>
  <div id="result"></div>
  <script>
    const edtCode = {
      _type_name: 'TextField',
      value: '',
      set_value(v) { this.value = v; },
      setFocus() {},
      onchange() {},
    };
    const btnGo = {
      _type_name: 'Button',
      click() { document.getElementById('result').textContent = 'clicked:' + edtCode.value; },
      onclick: {},
    };

    const dataset = {
      colcount: 2,
      rowcount: 2,
      getColID(i) { return ['CODE', 'QTY'][i]; },
      getColumn(row, colId) {
        const raw = { CODE: ['C001', 'C002'], QTY: [10, 20] };
        return raw[colId][row];
      },
    };
    const heads = [
      { text: 'Code', col: 0, row: 0, colspan: 1 },
      { text: 'Qty', col: 1, row: 0, colspan: 1 },
    ];
    const bodyCells = [{ col: null }, { col: 0 }, { col: 1 }];
    const grdItems = {
      _type_name: 'Grid',
      getBindDataset() { return dataset; },
      getCellCount(band) { return band === 'head' ? heads.length : bodyCells.length; },
      getCellProperty(band, i, prop) { return band === 'head' ? heads[i][prop] : bodyCells[i][prop]; },
      getCellText(row, cellIndex) {
        const colId = bodyCells[cellIndex].col === 0 ? 'CODE' : 'QTY';
        const raw = dataset.getColumn(row, colId);
        return colId === 'QTY' ? raw + ' EA' : raw;
      },
    };

    const frame = { id: '${LIVE_INSTANCE}', form: { edtCode, btnGo, grdItems } };
    const workFrameSet = { all: [frame], getActiveFrame: () => frame };
    const app = { mainframe: { workFrameSet } };
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
  const bridgeScriptPath = path.join(__dirname, '..', 'extension', 'dist', 'nexacro-bridge.js');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.log('PAGEERROR>', err.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ path: bridgeScriptPath });

    const request = async (componentId, action, value) => {
      return page.evaluate(
        ({ componentId, action, value }) =>
          new Promise((resolve) => {
            const requestId = `${Date.now()}-${Math.random()}`;
            const handler = (event) => {
              if (event.detail.requestId !== requestId) return;
              document.removeEventListener('__ba_nexacro_response__', handler);
              resolve(event.detail);
            };
            document.addEventListener('__ba_nexacro_response__', handler);
            document.dispatchEvent(
              new CustomEvent('__ba_nexacro_request__', { detail: { requestId, componentId, action, value } }),
            );
          }),
        { componentId, action, value },
      );
    };

    const setResult = await request(CODE_ID, 'set_value', 'admin');
    assert.strictEqual(setResult.ok, true, `set_value should recover the stale instance id: ${JSON.stringify(setResult)}`);

    const clickResult = await request(GO_ID, 'click');
    assert.strictEqual(clickResult.ok, true, `click should recover the stale instance id: ${JSON.stringify(clickResult)}`);
    const resultText = await page.locator('#result').textContent();
    assert.strictEqual(resultText, 'clicked:admin', 'the fake app should observe the real component state');
    console.log('[ok] bridge click/set_value recover a dynamic work-window id whose instance suffix changed since it was recorded');

    const gridResult = await request(GRID_ID, 'extract_grid');
    assert.strictEqual(gridResult.ok, true, `extract_grid should succeed: ${JSON.stringify(gridResult)}`);
    const expected = [
      { Code: 'C001', Qty: '10 EA' },
      { Code: 'C002', Qty: '20 EA' },
    ];
    assert.deepStrictEqual(gridResult.grid.rows, expected, 'grid rows should be keyed by head caption using getCellText, not raw dataset values');
    console.log('[ok] bridge extract_grid reads the bound dataset (never DOM) and maps headers via Format col/colspan');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('PASS: nexacro-dynamic-window-bridge-check');
})().catch((err) => {
  console.error('FAILED:', err.stack || err.message || err);
  process.exit(1);
});
