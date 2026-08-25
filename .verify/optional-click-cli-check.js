const path = require('path');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const assert = require('assert');

const execFileAsync = promisify(execFile);

// CLI/player parity for the same optional-click feature verified against the
// extension in optional-click-popup-check.js: a click step marked
// onError:'skip' for an element that isn't on this page must not fail the
// run, must give up quickly (not the normal 10s interact timeout), and must
// not let its own selectorFallbacks latch onto some unrelated element
// (#next is the only <button> here, so a positional fallback like
// ":nth-match(button, 1)" would wrongly match it) — #next's own click
// handler bumps a counter, so a wrongly-doubled click is directly visible in
// the captured output.
const PAGE = `<!doctype html><html><body style="padding:40px">
  <button id="next" onclick="document.getElementById('done').textContent = String(Number(document.getElementById('done').textContent) + 1)">Continue</button>
  <span id="done">0</span>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const workflowPath = path.join(__dirname, 'optional-click-workflow.json');
  const workflow = {
    version: '1.0.0',
    name: 'optional-click-cli-check',
    actions: [
      { id: 'nav', type: 'navigate', url: `http://127.0.0.1:${port}/` },
      {
        id: 'maybe-popup',
        type: 'click',
        selector: '#close-popup',
        selectorFallbacks: [':nth-match(button, 1)', 'body > button'],
        onError: 'skip',
      },
      { id: 'next', type: 'click', selector: '#next' },
      { id: 'extract', type: 'extractText', selector: '#done', output: 'value' },
    ],
    exportFormats: [{ type: 'json', output: 'value.json', dataKey: 'value' }],
  };
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

  try {
    const start = Date.now();
    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(__dirname, '..', 'cli', 'dist', 'index.js'), 'run', workflowPath, '--output', __dirname, '--verbose'],
      { timeout: 30000 },
    );
    const elapsed = Date.now() - start;
    console.log(stdout);
    console.log(`[timing] run with a missing optional click completed in ${elapsed}ms`);

    assert(stdout.includes('completed successfully'), 'expected the CLI run to succeed despite the missing optional element');
    assert(elapsed < 8000, `expected the missing optional click to give up quickly (~2s), not the normal 10s interact timeout (took ${elapsed}ms)`);

    const resultPath = path.join(__dirname, 'value.json');
    const value = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    assert.strictEqual(
      value,
      '1',
      `expected #next to have been clicked exactly once (not doubled by a wrongly-matched fallback), got "${value}"`,
    );
    fs.unlinkSync(resultPath);
    console.log('[ok] the missing optional step was skipped without aborting the run or misfiring on a fallback selector');
  } finally {
    fs.unlinkSync(workflowPath);
    server.close();
  }

  console.log('PASS: optional-click-cli-check');
})().catch((err) => {
  console.error('FAILED:', err.stdout || err.message || err);
  process.exit(1);
});
