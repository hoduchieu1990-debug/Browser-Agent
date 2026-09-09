const path = require('path');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// Confirms the fix for real multi-screen Nexacro apps (MES/ERP style, as
// opposed to the single-frame demo.tobesoft.com case the original bridge was
// verified against): a screen that lives inside a dynamically-opened "work
// window" gets a frame id with an instance suffix assigned the moment it
// opens (e.g. "winTEST0001_0_777") — reopening the same screen assigns a
// DIFFERENT suffix, even within the same session. A component id resolved
// via the literal recorded path must recover by finding whichever frame is
// currently serving the same stable formId prefix, instead of failing.
//
// Also confirms Nexacro Grid extraction reads the bound dataset (never the
// DOM) and maps header captions via the Format metadata's col/colspan, not
// by matching head/body cells at the same rendered position.
const RECORDED_INSTANCE = 'winTEST0001_0_111'; // stale — as if recorded in an earlier session
const LIVE_INSTANCE = 'winTEST0001_0_777'; // the id actually assigned this run
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
    // body cell index 0 is the grid's own state/checkbox column, excluded —
    // real header mapping starts at index 1.
    const bodyCells = [
      { col: null },
      { col: 0 },
      { col: 1 },
    ];
    const grdItems = {
      _type_name: 'Grid',
      getBindDataset() { return dataset; },
      getCellCount(band) { return band === 'head' ? heads.length : bodyCells.length; },
      getCellProperty(band, i, prop) {
        if (band === 'head') return heads[i][prop];
        return bodyCells[i][prop];
      },
      getCellText(row, cellIndex) {
        const colId = bodyCells[cellIndex].col === 0 ? 'CODE' : 'QTY';
        const raw = dataset.getColumn(row, colId);
        return colId === 'QTY' ? raw + ' EA' : raw;
      },
    };

    const frame = { id: '${LIVE_INSTANCE}', form: { edtCode, btnGo, grdItems } };
    // getActiveFrame is the primary lookup; .all is the fallback a frameset
    // without it (or serving multiple concurrent windows) is searched by.
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const workflowPath = path.join(__dirname, 'nexacro-dynamic-window-workflow.json');
  const workflow = {
    version: '1.0.0',
    name: 'nexacro-dynamic-window-check',
    actions: [
      { id: 'step-1', type: 'navigate', url: `http://127.0.0.1:${port}/` },
      { id: 'step-2', type: 'input', selector: `nexacro:${CODE_ID}`, value: 'admin' },
      { id: 'step-3', type: 'click', selector: `nexacro:${GO_ID}` },
      { id: 'step-4', type: 'extractText', selector: '#result', output: 'resultText' },
      { id: 'step-5', type: 'extractTable', selector: `nexacro:${GRID_ID}`, output: 'gridRows' },
    ],
    exportFormats: [
      { type: 'json', output: 'nexacro-dynamic-window-result.json', dataKey: 'resultText' },
      { type: 'json', output: 'nexacro-dynamic-window-grid.json', dataKey: 'gridRows' },
    ],
  };
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(__dirname, '..', 'cli', 'dist', 'index.js'),
      'run',
      workflowPath,
      '--output',
      __dirname,
      '--verbose',
    ]);
    console.log(stdout);

    const resultPath = path.join(__dirname, 'nexacro-dynamic-window-result.json');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    console.log('[result]', JSON.stringify(result));
    if (result !== 'clicked:admin') {
      throw new Error(
        `expected "clicked:admin" (proving input+click resolved through the stale recorded instance id ${RECORDED_INSTANCE} to the live frame ${LIVE_INSTANCE}), got: ${JSON.stringify(result)}`,
      );
    }
    console.log('[ok] click/input recover a dynamic work-window id whose instance suffix changed since it was recorded');

    const gridPath = path.join(__dirname, 'nexacro-dynamic-window-grid.json');
    const grid = JSON.parse(fs.readFileSync(gridPath, 'utf-8'));
    console.log('[grid]', JSON.stringify(grid));
    const expected = [
      { Code: 'C001', Qty: '10 EA' },
      { Code: 'C002', Qty: '20 EA' },
    ];
    if (JSON.stringify(grid) !== JSON.stringify(expected)) {
      throw new Error(
        `expected grid rows keyed by head caption with getCellText's display value, got: ${JSON.stringify(grid)} (expected ${JSON.stringify(expected)})`,
      );
    }
    console.log('[ok] extractTable on a nexacro: selector reads the bound dataset (never DOM) and maps headers via Format col/colspan');

    fs.unlinkSync(workflowPath);
    fs.unlinkSync(resultPath);
    fs.unlinkSync(gridPath);
  } finally {
    server.close();
  }

  console.log('PASS: nexacro-dynamic-window-check');
})().catch((err) => {
  console.error('FAILED:', err.stdout || err.message || err);
  process.exit(1);
});
