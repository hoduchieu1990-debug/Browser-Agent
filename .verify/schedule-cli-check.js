const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { tick } = require('../cli/dist/schedule/runner.js');

function pad(n) {
  return String(n).padStart(2, '0');
}

// "A minute ago" in local time, formatted the way ScheduleRecurrence expects
// (YYYY-MM-DD / HH:mm) — makes the schedule already due the instant it's read.
function aMinuteAgo() {
  const d = new Date(Date.now() - 60_000);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function makeWorkflow(port) {
  return {
    version: '1.0.0',
    name: 'schedule-check',
    actions: [
      { id: 'nav', type: 'navigate', url: `http://127.0.0.1:${port}/` },
      { id: 'extract', type: 'extractText', selector: '#result', output: 'value' },
    ],
    exportFormats: [],
  };
}

function baseConfig(id, workflow, repeatCount) {
  const { date, time } = aMinuteAgo();
  return {
    id,
    name: `Test schedule ${id}`,
    workflow,
    recurrence: { type: 'once', date, time },
    repeatCount,
    resultKeys: ['value'],
    stopOnError: true,
    email: { host: '127.0.0.1', port: 2525, secure: false, to: 'ops@example.com' },
    state: { timesTriggered: 0 },
  };
}

(async () => {
  const runDir = path.join(__dirname, 'schedule-cli-run');
  fs.mkdirSync(runDir, { recursive: true });

  // --- Fixture 1: every request succeeds, repeatCount = 2 ---
  let requestCount1 = 0;
  const server1 = http.createServer((req, res) => {
    requestCount1++;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><body><span id="result">value-${requestCount1}</span></body></html>`);
  });
  await new Promise((r) => server1.listen(0, '127.0.0.1', r));
  const port1 = server1.address().port;

  const fixture1 = path.join(runDir, 'success.schedule.json');
  fs.writeFileSync(fixture1, JSON.stringify(baseConfig('sched-success', makeWorkflow(port1), 2), null, 2));

  const sent1 = [];
  await tick(fixture1, { mailerFactory: () => ({ send: async (msg) => sent1.push(msg) }) });

  assert.strictEqual(sent1.length, 1, 'expected exactly one email to be sent');
  assert(sent1[0].text.includes('value-1') && sent1[0].text.includes('value-2'), 'email should contain both repeat runs\' values');
  console.log('[ok] one email sent, containing both repeat runs\' extracted values');

  const stateAfterFirst = JSON.parse(fs.readFileSync(fixture1, 'utf-8')).state;
  assert.strictEqual(stateAfterFirst.timesTriggered, 1);
  assert.strictEqual(stateAfterFirst.lastStatus, 'success');
  console.log('[ok] schedule state persisted: timesTriggered=1, lastStatus=success');

  // Firing again immediately must NOT send a second email for the same slot.
  await tick(fixture1, { mailerFactory: () => ({ send: async (msg) => sent1.push(msg) }) });
  assert.strictEqual(sent1.length, 1, 'ticking again for the same slot must not send a second email');
  console.log('[ok] re-ticking the same due slot does not double-fire');

  server1.close();

  // --- Fixture 2: second run fails (element missing on 2nd request), repeatCount = 3 ---
  let requestCount2 = 0;
  const server2 = http.createServer((req, res) => {
    // A real navigation can trigger extra requests (favicon.ico, etc.) — only
    // the document request itself should advance the "which run is this" counter.
    if (req.url !== '/') {
      res.writeHead(404);
      res.end();
      return;
    }
    requestCount2++;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (requestCount2 === 2) {
      res.end('<!doctype html><html><body><span id="other">no result here</span></body></html>');
    } else {
      res.end(`<!doctype html><html><body><span id="result">value-${requestCount2}</span></body></html>`);
    }
  });
  await new Promise((r) => server2.listen(0, '127.0.0.1', r));
  const port2 = server2.address().port;

  const fixture2 = path.join(runDir, 'partial-fail.schedule.json');
  fs.writeFileSync(fixture2, JSON.stringify(baseConfig('sched-partial', makeWorkflow(port2), 3), null, 2));

  const sent2 = [];
  await tick(fixture2, { mailerFactory: () => ({ send: async (msg) => sent2.push(msg) }) });

  assert.strictEqual(sent2.length, 1, 'expected exactly one email even when a repeat run fails');
  assert(sent2[0].text.includes('value-1'), 'email should include the first (successful) run');
  assert(sent2[0].text.includes('Stopped early'), 'email should note the run stopped early after a failure');
  assert(!sent2[0].text.includes('value-3'), 'the 3rd repeat must never have run (stopOnError=true stops immediately)');
  console.log('[ok] a failing repeat run stops the remaining repeats and is reflected in the email');

  const stateAfterPartial = JSON.parse(fs.readFileSync(fixture2, 'utf-8')).state;
  assert.strictEqual(stateAfterPartial.lastStatus, 'partial');
  console.log('[ok] schedule state records lastStatus=partial');

  server2.close();

  // --- Fixture 3: content message + CSV attachment, repeatCount = 1 ---
  const server3 = http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body><span id="result">42</span></body></html>');
  });
  await new Promise((r) => server3.listen(0, '127.0.0.1', r));
  const port3 = server3.address().port;

  const workflow3 = makeWorkflow(port3);
  // What the extension does at creation time when "attach results file" is
  // checked (ReportComposer.tsx) — set here directly since this test drives
  // the CLI daemon, not the UI.
  workflow3.exportFormats = [{ type: 'csv', output: 'value.csv', dataKey: 'value' }];

  const config3 = baseConfig('sched-content', workflow3, 1);
  config3.content = 'Hi team, here is today\'s report:';
  config3.attachment = { format: 'csv' };
  const fixture3 = path.join(runDir, 'content-attachment.schedule.json');
  fs.writeFileSync(fixture3, JSON.stringify(config3, null, 2));

  const sent3 = [];
  let attachmentExistedAtSendTime = null;
  await tick(fixture3, {
    mailerFactory: () => ({
      send: async (msg) => {
        // Real nodemailer reads attachment files during this same call —
        // checking existence here (before tick()'s own cleanup runs in its
        // finally block, right after this resolves) is what actually mirrors
        // that, not checking after tick() has fully returned.
        attachmentExistedAtSendTime = msg.attachments?.[0]?.path ? fs.existsSync(msg.attachments[0].path) : false;
        sent3.push(msg);
      },
    }),
  });

  assert.strictEqual(sent3.length, 1, 'expected exactly one email');
  assert(sent3[0].text.startsWith("Hi team, here is today's report:"), 'email text should lead with the custom content message');
  assert(Array.isArray(sent3[0].attachments) && sent3[0].attachments.length === 1, 'expected one attachment');
  assert.strictEqual(sent3[0].attachments[0].filename, 'value.csv');
  assert.strictEqual(attachmentExistedAtSendTime, true, 'the attached file should exist on disk at send time (before cleanup)');
  console.log('[ok] custom content message leads the email, and the CSV attachment is real and present at send time');

  server3.close();
  fs.rmSync(runDir, { recursive: true, force: true });

  console.log('PASS: schedule-cli-check');
})().catch((err) => {
  console.error('FAILED:', err.stdout || err.message || err);
  process.exit(1);
});
