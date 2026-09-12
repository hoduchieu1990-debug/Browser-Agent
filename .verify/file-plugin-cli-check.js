const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { chromium } = require('playwright');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', 'cli', 'dist', 'index.js');
const TMP = path.join(__dirname, 'file-plugin-tmp');

// A real PDF, printed by headless Chromium rather than hand-built — a
// byte-level hand-rolled xref table is brittle and specific PDF parsers
// disagree on exactly what they'll tolerate.
async function makePdfFixture(filePath) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body style="font-size:24px">Hello PDF</body></html>');
    await page.pdf({ path: filePath });
  } finally {
    await browser.close();
  }
}

const PAGE = `<!doctype html><html><body>
  <table id="t">
    <thead><tr><th>id</th><th>name</th></tr></thead>
    <tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody>
  </table>
</body></html>`;

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function runCli(name, actions, exportFormats) {
  const workflowPath = path.join(TMP, `${name}.json`);
  fs.writeFileSync(workflowPath, JSON.stringify({ version: '1.0.0', name, actions, exportFormats }, null, 2));
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI, 'run', workflowPath, '--output', TMP, '--verbose'],
      { timeout: 30000 },
    );
    return stdout;
  } catch (e) {
    throw new Error(`${name} run failed: ${e.stderr || e.stdout || e.message}`);
  }
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    // ---------- extractTable -> fileWriteExcel -> fileReadExcel round trip ----------
    const rowsPath = path.join(TMP, 'rows.xlsx');
    const stdout1 = await runCli(
      'file-plugin-write-read',
      [
        { id: 'nav', type: 'navigate', url: `http://127.0.0.1:${port}/` },
        { id: 'extract', type: 'extractTable', selector: '#t', output: 'rows' },
        { id: 'write', type: 'fileWriteExcel', filePath: rowsPath, data: 'rows' },
        { id: 'read', type: 'fileReadExcel', filePath: rowsPath, output: 'readBack' },
      ],
      [{ type: 'json', output: 'readBack.json', dataKey: 'readBack' }],
    );
    check('fileWriteExcel + fileReadExcel run completed', /completed successfully/.test(stdout1));

    const readBack = JSON.parse(fs.readFileSync(path.join(TMP, 'readBack.json'), 'utf-8'));
    console.log('[read back]', JSON.stringify(readBack));
    check('round-tripped 2 rows', readBack.length === 2);
    check(
      'round-tripped values match what was extracted from the page',
      readBack[0].name === 'Alice' && readBack[1].name === 'Bob',
    );

    // ---------- fileMove ----------
    const movedPath = path.join(TMP, 'moved', 'rows-moved.xlsx');
    const stdout2 = await runCli('file-plugin-move', [
      { id: 'nav', type: 'navigate', url: `http://127.0.0.1:${port}/` },
      { id: 'move', type: 'fileMove', sourcePath: rowsPath, destPath: movedPath },
    ]);
    check('fileMove run completed', /completed successfully/.test(stdout2));
    check('source file no longer exists after move', !fs.existsSync(rowsPath));
    check('destination file exists after move', fs.existsSync(movedPath));

    // ---------- fileReadPdf ----------
    const pdfPath = path.join(TMP, 'hello.pdf');
    await makePdfFixture(pdfPath);
    const stdout3 = await runCli(
      'file-plugin-read-pdf',
      [
        { id: 'nav', type: 'navigate', url: `http://127.0.0.1:${port}/` },
        { id: 'readPdf', type: 'fileReadPdf', filePath: pdfPath, output: 'text' },
      ],
      [{ type: 'json', output: 'text.json', dataKey: 'text' }],
    );
    check('fileReadPdf run completed', /completed successfully/.test(stdout3));
    const pdfText = JSON.parse(fs.readFileSync(path.join(TMP, 'text.json'), 'utf-8'));
    console.log('[pdf text]', JSON.stringify(pdfText));
    check('extracted text contains the PDF content', pdfText.includes('Hello PDF'));
  } finally {
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
