const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', 'cli', 'dist', 'index.js');
const TMP = path.join(__dirname, 'mail-read-plugin-tmp');

// mailRead/mailSearch/mailAttachment need a real IMAP mailbox to verify
// actual message parsing — none is available here, so this only checks the
// wiring: connecting to an address nothing listens on must fail cleanly, not
// hang or crash uncaught, for all three action types.
const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function runCli(name, actions) {
  const workflowPath = path.join(TMP, `${name}.json`);
  fs.writeFileSync(workflowPath, JSON.stringify({ version: '1.0.0', name, actions }, null, 2));
  return execFileAsync(process.execPath, [CLI, 'run', workflowPath, '--output', TMP, '--verbose'], {
    timeout: 20000,
  });
}

const conn = { host: '127.0.0.1', port: 1, user: 'a@b.com', password: 'x' };

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  // mailAttachment no-ops on an empty `source` list without ever touching the
  // network, so seed it with a stub message first (a tiny local API standing
  // in for whatever earlier mailRead/mailSearch step would normally produce)
  // to actually exercise its own IMAP connection attempt.
  const seedServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ uid: 1 }]));
  });
  await new Promise((r) => seedServer.listen(0, '127.0.0.1', r));
  const seedUrl = `http://127.0.0.1:${seedServer.address().port}/`;

  try {
    for (const [type, extra] of [
      ['mailRead', { output: 'msgs' }],
      ['mailSearch', { from: 'x@y.com', output: 'msgs' }],
      ['mailAttachment', { source: 'msgs', saveDir: TMP, output: 'files' }],
    ]) {
      const seedAction = { id: 'seed', type: 'apiGet', url: seedUrl, output: 'msgs' };
      try {
        await runCli(`${type}-unreachable`, [seedAction, { id: 'a1', type, ...conn, ...extra }]);
        check(`${type} against an unreachable server fails the run`, false, 'CLI exited 0 instead of failing');
      } catch (e) {
        const output = (e.stdout || '') + (e.stderr || '');
        check(
          `${type} against an unreachable server fails cleanly`,
          /Workflow failed/.test(output) || /ECONNREFUSED|connect/i.test(output),
          output.slice(0, 300),
        );
      }
    }
  } finally {
    seedServer.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log('[note] full mailRead/mailSearch/mailAttachment behavior needs a real IMAP mailbox to verify manually.');
  if (failed.length) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
