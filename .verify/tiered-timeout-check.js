const path = require('path');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const assert = require('assert');

const execFileAsync = promisify(execFile);

// Confirms the two timeout tiers actually differ: a click on a selector that
// will never exist must fail in roughly INTERACT_TIMEOUT_MS (10s), not sit
// through the full WAIT_TIMEOUT_MS (30s) extractText/Table/etc. get — the
// user specifically did not want every step paying the 30s cost.
const PAGE = `<!doctype html><html><body style="padding:40px">
  <div id="real">hello</div>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const workflowPath = path.join(__dirname, 'tiered-timeout-workflow.json');
  const workflow = {
    version: '1.0.0',
    name: 'tiered-timeout-check',
    actions: [
      { id: 'nav', type: 'navigate', url: `http://127.0.0.1:${port}/` },
      { id: 'click', type: 'click', selector: '#does-not-exist' },
    ],
    exportFormats: [],
  };
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

  try {
    const start = Date.now();
    let failedAsExpected = false;
    try {
      await execFileAsync(
        process.execPath,
        [path.join(__dirname, '..', 'cli', 'dist', 'index.js'), 'run', workflowPath, '--output', __dirname],
        { timeout: 40000 },
      );
    } catch (err) {
      // `run` exits non-zero on a failed workflow — that is the expected path here.
      failedAsExpected = true;
    }
    const elapsed = Date.now() - start;
    console.log(`[timing] click on a missing selector failed after ${elapsed}ms`);

    assert(failedAsExpected, 'expected the click step to fail (the selector never exists)');
    assert(elapsed < 20000, `expected the click to fail near the 10s interact timeout, not wait close to 30s (took ${elapsed}ms)`);
    console.log('[ok] a click/input-type step fails near its own shorter timeout instead of paying the extract-tier 30s');
  } finally {
    fs.unlinkSync(workflowPath);
    server.close();
  }

  console.log('PASS: tiered-timeout-check');
})().catch((err) => {
  console.error('FAILED:', err.stdout || err.message || err);
  process.exit(1);
});
