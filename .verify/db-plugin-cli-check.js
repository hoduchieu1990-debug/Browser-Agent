const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', 'cli', 'dist', 'index.js');
const TMP = path.join(__dirname, 'db-plugin-tmp');

// DatabasePlugin (dbQuery/dbExecute/dbExport) needs a real SQL Server to
// verify actual query execution — there is none available in this
// environment, so this only checks the wiring: connecting to an address
// nothing listens on must fail cleanly (a normal "workflow failed" line,
// not a hang or an uncaught crash), for all three action types.
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

const connection = { server: '127.0.0.1', port: 1, database: 'test', user: 'sa', password: 'x' };

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  try {
    for (const [type, extra] of [
      ['dbQuery', { query: 'SELECT 1', output: 'rows' }],
      ['dbExecute', { statement: 'DELETE FROM t' }],
      ['dbExport', { query: 'SELECT 1', format: 'json', filePath: path.join(TMP, 'out.json') }],
    ]) {
      try {
        await runCli(`${type}-unreachable`, [{ id: 'a1', type, connection, ...extra }]);
        check(`${type} against an unreachable server fails the run`, false, 'CLI exited 0 instead of failing');
      } catch (e) {
        const output = (e.stdout || '') + (e.stderr || '');
        check(
          `${type} against an unreachable server fails cleanly`,
          /Workflow failed/.test(output) || /ECONNREFUSED|ESOCKET|Failed to connect/i.test(output),
          output.slice(0, 300),
        );
      }
    }
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log('[note] full dbQuery/dbExecute/dbExport behavior needs a real SQL Server to verify manually.');
  if (failed.length) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
