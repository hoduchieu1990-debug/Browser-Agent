const http = require('http');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const TEST_HTML = `<!doctype html>
<html><body style="padding:40px">
  <div id="price-box"><span class="label">Price:</span> <span id="price">$129.99</span></div>
  <table id="results" class="results">
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>Alice</td></tr>
      <tr><td>2</td><td>Bob</td></tr>
    </tbody>
  </table>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(TEST_HTML);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  // Take the extension's exported workflow and prepend a navigate step so the
  // player has a page to work on, then run it for real through the CLI.
  const exported = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf-8'));
  exported.actions.unshift({ id: 'step-0', type: 'navigate', url: `http://127.0.0.1:${port}/` });
  exported.exportFormats = [
    { type: 'json', output: 'price.json', dataKey: 'text1' },
    { type: 'json', output: 'table.json', dataKey: 'table1' },
  ];

  const runnable = path.join(__dirname, 'runnable.json');
  fs.writeFileSync(runnable, JSON.stringify(exported, null, 2));

  try {
    // must be async — a sync child would block this process's event loop and the
    // local HTTP server would never answer the player's request
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(__dirname, '..', 'cli', 'dist', 'index.js'),
      'run',
      runnable,
      '--output',
      __dirname,
      '--verbose',
    ]);
    console.log(stdout);
    console.log('--- price.json ---');
    console.log(fs.readFileSync(path.join(__dirname, 'price.json'), 'utf-8'));
    console.log('--- table.json ---');
    console.log(fs.readFileSync(path.join(__dirname, 'table.json'), 'utf-8'));
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error('FAILED:', err.stdout || err.message);
  process.exit(1);
});
