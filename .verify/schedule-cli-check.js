const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { tick } = require('../cli/dist/schedule/runner.js');

// Wednesday, 2026-08-19 — a fixed date/times so every case is deterministic
// regardless of when this actually runs (matches schedule-due-check.js's convention).
const TEST_DATE = '2026-08-19';
function at(hh, mm) {
  return new Date(2026, 7, 19, hh, mm, 0);
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

function baseConfig(id, workflow, times) {
  return {
    id,
    name: `Test schedule ${id}`,
    workflow,
    recurrence: { type: 'once', date: TEST_DATE, times },
    resultKeys: ['value'],
    email: { host: '127.0.0.1', port: 2525, secure: false, to: 'ops@example.com' },
    state: { timesTriggered: 0 },
  };
}

(async () => {
  const runDir = path.join(__dirname, 'schedule-cli-run');
  fs.mkdirSync(runDir, { recursive: true });

  // --- Fixture 1: two independent times the same day -> two separate emails ---
  let requestCount1 = 0;
  const server1 = http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    requestCount1++;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><body><span id="result">value-${requestCount1}</span></body></html>`);
  });
  await new Promise((r) => server1.listen(0, '127.0.0.1', r));
  const port1 = server1.address().port;

  const fixture1 = path.join(runDir, 'two-times.schedule.json');
  fs.writeFileSync(fixture1, JSON.stringify(baseConfig('sched-two-times', makeWorkflow(port1), ['08:00', '09:00']), null, 2));

  const sent1 = [];
  const mailerFactory1 = () => ({ send: async (msg) => sent1.push(msg) });

  await tick(fixture1, { now: at(8, 30), mailerFactory: mailerFactory1 });
  assert.strictEqual(sent1.length, 1, 'the 08:00 trigger should have sent exactly one email');
  assert(sent1[0].text.includes('value: value-1'), 'first email should contain the first run\'s value');
  console.log('[ok] the first of two daily times fires and emails on its own');

  // Still within the 08:00 slot (09:00 hasn't passed yet) — must not re-fire.
  await tick(fixture1, { now: at(8, 45), mailerFactory: mailerFactory1 });
  assert.strictEqual(sent1.length, 1, 'no second email before the next configured time arrives');

  await tick(fixture1, { now: at(9, 15), mailerFactory: mailerFactory1 });
  assert.strictEqual(sent1.length, 2, 'the 09:00 trigger should send its own, separate email');
  assert(sent1[1].text.includes('value: value-2'), 'second email should contain the second run\'s value, from an independent run');
  console.log('[ok] a later time-of-day the same day fires its own independent run and email');

  const stateAfterBoth = JSON.parse(fs.readFileSync(fixture1, 'utf-8')).state;
  assert.strictEqual(stateAfterBoth.timesTriggered, 2);
  assert.strictEqual(stateAfterBoth.lastStatus, 'success');
  console.log('[ok] schedule state reflects both triggers');

  server1.close();

  // --- Fixture 2: the run itself fails (element never appears) ---
  const server2 = http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body><span id="other">no result here</span></body></html>');
  });
  await new Promise((r) => server2.listen(0, '127.0.0.1', r));
  const port2 = server2.address().port;

  const fixture2 = path.join(runDir, 'failure.schedule.json');
  fs.writeFileSync(fixture2, JSON.stringify(baseConfig('sched-fail', makeWorkflow(port2), ['08:00']), null, 2));

  const sent2 = [];
  await tick(fixture2, { now: at(8, 0), mailerFactory: () => ({ send: async (msg) => sent2.push(msg) }) });

  assert.strictEqual(sent2.length, 1, 'a failing run should still send exactly one email, reporting the failure');
  assert(sent2[0].text.includes('FAILED'), 'email should say the run failed');
  console.log('[ok] a failing run is reported by email instead of silently dropped');

  const stateAfterFail = JSON.parse(fs.readFileSync(fixture2, 'utf-8')).state;
  assert.strictEqual(stateAfterFail.lastStatus, 'failed');
  console.log('[ok] schedule state records lastStatus=failed');

  server2.close();

  // --- Fixture 3: content message + CSV attachment ---
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

  const config3 = baseConfig('sched-content', workflow3, ['08:00']);
  config3.content = 'Hi team, here is today\'s report:';
  config3.attachment = { format: 'csv' };
  const fixture3 = path.join(runDir, 'content-attachment.schedule.json');
  fs.writeFileSync(fixture3, JSON.stringify(config3, null, 2));

  const sent3 = [];
  let attachmentExistedAtSendTime = null;
  await tick(fixture3, {
    now: at(8, 0),
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
