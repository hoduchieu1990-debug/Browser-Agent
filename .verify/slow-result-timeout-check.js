const path = require('path');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const assert = require('assert');

const execFileAsync = promisify(execFile);

// Reproduces "the program shows FAILED before the search result even
// appears": clicking search here inserts the result element only after a
// deliberate delay — longer than the old 10s default (player) / 12s default
// (extension) resolve() timeout, but well under the new 30s one. Every
// action (click/input/extractText/...) except waitForSelector and the Search
// batch node relied on that unnamed default with no way to override it.
const RESULT_DELAY_MS = 15000;

const PAGE = `<!doctype html><html><body style="padding:40px">
  <button id="search-btn" onclick="run()">Search</button>
  <div id="result-container"></div>
  <script>
    function run() {
      setTimeout(() => {
        const div = document.createElement('div');
        div.id = 'result';
        div.textContent = '42 results found';
        document.getElementById('result-container').appendChild(div);
      }, ${RESULT_DELAY_MS});
    }
  </script>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const workflowPath = path.join(__dirname, 'slow-result-workflow.json');
  const workflow = {
    version: '1.0.0',
    name: 'slow-result-check',
    actions: [
      { id: 'nav', type: 'navigate', url: `http://127.0.0.1:${port}/` },
      { id: 'click', type: 'click', selector: '#search-btn' },
      { id: 'extract', type: 'extractText', selector: '#result', output: 'value' },
    ],
    exportFormats: [{ type: 'json', output: 'value.json', dataKey: 'value' }],
  };
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

  try {
    const start = Date.now();
    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(__dirname, '..', 'cli', 'dist', 'index.js'), 'run', workflowPath, '--output', __dirname, '--verbose'],
      { timeout: 40000 },
    );
    const elapsed = Date.now() - start;
    console.log(stdout);
    console.log(`[ok] workflow succeeded after ${elapsed}ms (result appears at ${RESULT_DELAY_MS}ms, old default timeout was 10s)`);
    assert(stdout.includes('completed successfully'), 'expected the CLI run to report success, not a timeout failure');

    const resultPath = path.join(__dirname, 'value.json');
    const value = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    assert.strictEqual(value, '42 results found', 'expected the actually-delayed text to have been captured');
    fs.unlinkSync(resultPath);
  } finally {
    fs.unlinkSync(workflowPath);
    server.close();
  }

  console.log('PASS: slow-result-timeout-check');
})().catch((err) => {
  console.error('FAILED:', err.stdout || err.message || err);
  process.exit(1);
});
