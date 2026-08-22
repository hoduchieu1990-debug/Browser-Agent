const path = require('path');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ExcelJS = require('exceljs');

const execFileAsync = promisify(execFile);

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PAGE = `<!doctype html><html><body style="padding:24px">
  <input id="code" type="text" />
  <select id="model">
    <option value="">--</option>
    <option value="X100">X100</option>
    <option value="X200">X200</option>
  </select>
  <button id="search">Search</button>
  <script>
    document.getElementById('search').addEventListener('click', () => {
      document.getElementById('result')?.remove();
      const code = document.getElementById('code').value;
      const model = document.getElementById('model').value;
      setTimeout(() => {
        const div = document.createElement('div');
        div.id = 'result';
        div.textContent = code + '-' + model;
        document.body.appendChild(div);
      }, 300);
    });
  </script>
</body></html>`;

async function buildDataset(filePath) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('rows');
  sheet.addRow(['Code', 'Model']);
  sheet.addRow(['A001', 'X100']);
  sheet.addRow(['A002', 'X200']);
  await wb.xlsx.writeFile(filePath);
}

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const dir = path.join(__dirname, 'batch-nodes-cli-run');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const datasetPath = path.join(dir, 'rows.xlsx');
  await buildDataset(datasetPath);

  const workflow = {
    version: '1.0',
    name: 'batch-nodes-cli-check',
    actions: [
      { id: 'nav', type: 'navigate', url: `http://127.0.0.1:${port}/` },
      { id: 'in1', type: 'batchInput', selector: '#code', inputType: 'text', column: 'Code' },
      { id: 'in2', type: 'batchInput', selector: '#model', inputType: 'select', column: 'Model' },
      { id: 'search', type: 'batchSearch', selector: '#search', waitCondition: { type: 'elementAppears', timeout: 5000 } },
      { id: 'ext', type: 'batchExtract', selector: '#result', extractType: 'text', output: 'result' },
    ],
    exportFormats: [{ type: 'csv', output: 'results.csv', dataKey: 'result' }],
  };
  const wfPath = path.join(dir, 'wf.json');
  fs.writeFileSync(wfPath, JSON.stringify(workflow, null, 2));

  const cli = path.join(__dirname, '..', 'cli', 'dist', 'index.js');
  try {
    const { stdout } = await execFileAsync(process.execPath, [cli, 'run', wfPath, '--data', datasetPath, '--output', dir]);
    check('CLI batch run completed', stdout.includes('2 succeeded, 0 failed'), stdout.trim().split('\n').slice(-4).join(' | '));

    const csvPath = path.join(dir, 'results.csv');
    const csv = fs.readFileSync(csvPath, 'utf-8');
    console.log(csv);
    check('CLI produced both rows', csv.includes('A001-X100') && csv.includes('A002-X200'), csv.trim());
    check('CLI replaced value between rows (no concatenation)', !csv.includes('A001-X100A002-X200'));
  } catch (error) {
    check('CLI batch run completed', false, (error.stdout || error.message || '').split('\n').slice(-5).join(' | '));
  } finally {
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})();
