const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execFileAsync = promisify(execFile);

const CHECKS = [
  'add-stop-pair-check.js',
  'multi-window-check.js',
  'navigate-fragment-check.js',
  'cross-page-capture-check.js',
  'pin-side-check.js',
  'popup-width-check.js',
  'aim-click-check.js',
  'capture-crop-check.js',
  'image-matches-frame-check.js',
  'single-toast-check.js',
  'result-order-check.js',
  'stop-sync-check.js',
  'type-text-note-duration-check.js',
  'badge-follow-check.js',
  'target-frame-check.js',
  'lock-target-check.js',
  'tailwind-selector-check.js',
  'code-block-check.js',
  'variant-class-check.js',
  'table-kinds-check.js',
  'layout-table-check.js',
  'nth-match-cli-check.js',
  'selector-resilience-check.js',
  'reset-confirm-check.js',
  'player-reuse-check.js',
  'batch-check.js',
  'batch-nodes-check.js',
  'batch-nodes-cli-check.js',
  'export-picker-check.js',
  'export-completeness-check.js',
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
  'hover-perf-check.js',
  'nexacro-check.js',
  'nexacro-cli-check.js',
  'hover-raf-coalesce-check.js',
  'preview-stale-check.js',
  'pin-default-icons-check.js',
  'checkbox-radio-check.js',
  'step-thumbnail-check.js',
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
