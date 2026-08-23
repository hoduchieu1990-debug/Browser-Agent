const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function fixtureConfig(id, name, lastStatus) {
  return {
    id,
    name,
    workflow: { version: '1.0.0', name, actions: [], exportFormats: [] },
    recurrence: { type: 'weekly', weekdays: [1, 3], times: ['09:00'] },
    resultKeys: ['total'],
    email: { host: '127.0.0.1', port: 2525, secure: false, to: 'ops@example.com' },
    state: { timesTriggered: 3, lastRunAt: '2026-08-17T09:00:00.000Z', lastStatus },
  };
}

(async () => {
  const dir = path.join(__dirname, 'schedule-list-run');
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'a.schedule.json'),
    JSON.stringify(fixtureConfig('sched-a', 'Weekly report A', 'success'), null, 2),
  );
  fs.writeFileSync(
    path.join(dir, 'b.schedule.json'),
    JSON.stringify(fixtureConfig('sched-b', 'Weekly report B', 'failed'), null, 2),
  );

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(__dirname, '..', 'cli', 'dist', 'index.js'),
      'schedule',
      'list',
      '--dir',
      dir,
    ]);
    console.log(stdout);

    assert(stdout.includes('Weekly report A'), 'expected schedule A name in output');
    assert(stdout.includes('Weekly report B'), 'expected schedule B name in output');
    assert(stdout.includes('Mon,Wed'), 'expected the weekly recurrence to be described with weekday names');
    assert(stdout.includes('success'), 'expected schedule A\'s lastStatus in output');
    assert(stdout.includes('failed'), 'expected schedule B\'s lastStatus in output');
    console.log('[ok] schedule list prints name, recurrence, and last-run status for every schedule file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('PASS: schedule-list-check');
})().catch((err) => {
  console.error('FAILED:', err.stdout || err.message || err);
  process.exit(1);
});
