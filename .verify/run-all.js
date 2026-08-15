const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execFileAsync = promisify(execFile);

const CHECKS = [
  'panel-check.js',
  'player-reuse-check.js',
  'batch-check.js',
  'export-picker-check.js',
  'menu-check.js',
  'badge-reach-check.js',
  'stop-cleanup-check.js',
  'reset-check.js',
  'saved-check.js',
  'replay-log-check.js',
  'background-replay-check.js',
  'headless-check.js',
  'upload-check.js',
  'spa-highlight-check.js',
  'stale-page-check.js',
];

(async () => {
  const failures = [];

  for (const check of CHECKS) {
    process.stdout.write(`\n===== ${check} =====\n`);
    try {
      const { stdout } = await execFileAsync(process.execPath, [path.join(__dirname, check)], {
        maxBuffer: 10 * 1024 * 1024,
      });
      console.log(stdout.trim().split('\n').slice(-6).join('\n'));
      console.log(`-> OK`);
    } catch (error) {
      failures.push(check);
      console.log((error.stdout || '').trim().split('\n').slice(-8).join('\n'));
      console.log(`-> FAILED: ${(error.stderr || error.message).split('\n')[0]}`);
    }
  }

  console.log(`\n${CHECKS.length - failures.length}/${CHECKS.length} suites passed`);
  if (failures.length) {
    console.log('failed:', failures.join(', '));
    process.exitCode = 1;
  }
})();
