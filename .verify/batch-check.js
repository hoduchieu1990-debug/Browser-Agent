const path = require('path');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// A lookup form with several fields that answers after a delay — the shape the
// user described: fill in, submit, wait for the result, repeat.
const FORM = `<!doctype html>
<html><body style="padding:30px;font-family:Segoe UI,sans-serif">
  <h3>Order lookup</h3>
  <input id="orderId" placeholder="order id" />
  <input id="region" placeholder="region" />
  <select id="kind"><option value="std">Standard</option><option value="exp">Express</option></select>
  <button id="submit">Look up</button>
  <div id="result"></div>
  <script>
    document.getElementById('submit').addEventListener('click', () => {
      const id = document.getElementById('orderId').value;
      const region = document.getElementById('region').value;
      const kind = document.getElementById('kind').value;
      const box = document.getElementById('result');
      box.innerHTML = '';
      // the answer arrives a moment later, like a real backend call
      setTimeout(() => {
        if (id === 'BAD') { box.innerHTML = '<p id="err">not found</p>'; return; }
        box.innerHTML =
          '<div id="status">' + kind.toUpperCase() + '-' + region + '</div>' +
          '<table id="lines"><thead><tr><th>SKU</th><th>Qty</th></tr></thead><tbody>' +
          '<tr><td>' + id + '-1</td><td>2</td></tr>' +
          '<tr><td>' + id + '-2</td><td>5</td></tr>' +
          '</tbody></table>';
      }, 400);
    });
  </script>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(FORM);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const dir = path.join(__dirname, 'batch-run');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const workflow = {
    version: '1.0.0',
    name: 'order-lookup',
    params: [
      { name: 'orderId', type: 'string', required: true },
      { name: 'region', type: 'string', required: true },
      { name: 'kind', type: 'string', required: true },
    ],
    actions: [
      { id: 's1', type: 'navigate', url: `http://127.0.0.1:${port}/` },
      { id: 's2', type: 'input', selector: '#orderId', value: '${orderId}' },
      { id: 's3', type: 'input', selector: '#region', value: '${region}' },
      { id: 's4', type: 'select', selector: '#kind', value: '${kind}' },
      { id: 's5', type: 'click', selector: '#submit' },
      { id: 's6', type: 'waitForSelector', selector: '#status', timeout: 3000 },
      { id: 's7', type: 'extractText', selector: '#status', output: 'status' },
      { id: 's8', type: 'extractTable', selector: '#lines', headers: ['SKU', 'Qty'], output: 'lines' },
    ],
  };
  const workflowPath = path.join(dir, 'lookup.json');
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

  // one row deliberately fails, to prove the batch does not abort on it
  const csv = ['orderId,region,kind', 'A100,north,std', 'BAD,south,exp', 'C300,west,exp', 'D400,east,std'].join('\n');
  const csvPath = path.join(dir, 'inputs.csv');
  fs.writeFileSync(csvPath, csv);

  const cli = path.join(__dirname, '..', 'cli', 'dist', 'index.js');
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cli, 'run', workflowPath, '--data', csvPath, '--output', dir,
    ]);
    console.log(stdout);
  } catch (error) {
    console.log(error.stdout || error.message); // non-zero exit is expected: one row fails
  }

  // ---- the same batch, driven from an Excel file ----
  const ExcelJS = require(path.join(__dirname, '..', 'node_modules', 'exceljs'));
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('inputs');
  sheet.addRow(['orderId', 'region', 'kind']);
  sheet.addRow(['E500', 'north', 'exp']);
  sheet.addRow(['F600', 'south', 'std']);
  const xlsxPath = path.join(dir, 'inputs.xlsx');
  await wb.xlsx.writeFile(xlsxPath);

  const xlsxDir = path.join(dir, 'xlsx-out');
  fs.mkdirSync(xlsxDir, { recursive: true });
  const { stdout: xlsxOut } = await execFileAsync(process.execPath, [
    cli, 'run', workflowPath, '--data', xlsxPath, '--output', xlsxDir,
  ]);
  console.log('--- excel-driven batch ---');
  console.log(xlsxOut);
  console.log('status.csv from xlsx run:');
  console.log(fs.readFileSync(path.join(xlsxDir, 'status.csv'), 'utf-8').trim());

  console.log('--- files produced ---');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && f !== 'inputs.csv')) {
    console.log(`\n== ${file} ==`);
    console.log(fs.readFileSync(path.join(dir, file), 'utf-8').trim());
  }

  server.close();
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
