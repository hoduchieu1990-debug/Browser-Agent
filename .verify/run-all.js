const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execFileAsync = promisify(execFile);

const CHECKS = [
  'multi-window-check.js',
  'cross-tab-leak-check.js',
  'navigate-fragment-check.js',
  'cross-page-capture-check.js',
  'pin-side-check.js',
  'popup-width-check.js',
  'aim-click-check.js',
  'capture-crop-check.js',
  'image-matches-frame-check.js',
  'single-toast-check.js',
  'result-order-check.js',
  'type-text-note-duration-check.js',
  'target-frame-check.js',
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
  'stop-cleanup-check.js',
  'reset-check.js',
  'saved-check.js',
  'replay-log-check.js',
  'background-replay-check.js',
  'headless-check.js',
  'file-plugin-cli-check.js',
  'api-plugin-cli-check.js',
  'mail-send-cli-check.js',
  'db-plugin-cli-check.js',
  'mail-read-plugin-cli-check.js',
  'plugin-ui-check.js',
  'upload-check.js',
  'spa-highlight-check.js',
  'stale-page-check.js',
  'hover-perf-check.js',
  'nexacro-check.js',
  'nexacro-cli-check.js',
  'nexacro-dynamic-window-check.js',
  'nexacro-dynamic-window-bridge-check.js',
  'nexacro-grid-target-check.js',
  'report-canvas-check.js',
  'cdp-click-check.js',
  'framework-tag-check.js',
  'preview-stale-check.js',
  'pin-default-icons-check.js',
  'checkbox-radio-check.js',
  'step-thumbnail-check.js',
  'nexacro-long-id-check.js',
  'schedule-due-check.js',
  'schedule-cli-check.js',
  'schedule-list-check.js',
  'schedule-export-check.js',
  'report-real-preview-check.js',
  'badge-coverage-check.js',
  'search-enter-record-check.js',
  'slow-result-timeout-check.js',
  'tiered-timeout-check.js',
  'input-button-record-check.js',
  'search-button-no-blur-record-check.js',
  'stale-value-refresh-check.js',
  'control-types-check.js',
  'ctrl-rightclick-check.js',
  'frame-no-transition-check.js',
  'image-and-custom-checkbox-check.js',
  'shadow-dom-target-check.js',
  'optional-click-popup-check.js',
  'optional-click-cli-check.js',
  'ui-object-coverage-check.js',
  'plain-click-across-navigation-check.js',
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
