const path = require('path');
const fs = require('fs');
const net = require('net');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', 'cli', 'dist', 'index.js');
const TMP = path.join(__dirname, 'mail-send-tmp');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// A hand-rolled SMTP server speaking just enough of the protocol (EHLO,
// MAIL FROM, RCPT TO, DATA, QUIT) for nodemailer's plaintext client to
// complete a send — avoids pulling in a fake-SMTP test dependency just to
// verify mailSend talks real SMTP wire protocol correctly.
function createFakeSmtpServer() {
  const received = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let dataLines = [];
    let from = null;
    let to = [];

    socket.write('220 localhost ESMTP\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);

        if (inData) {
          if (line === '.') {
            inData = false;
            received.push({ from, to, data: dataLines.join('\n') });
            dataLines = [];
            socket.write('250 OK: queued\r\n');
          } else {
            dataLines.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }

        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250 localhost\r\n');
        } else if (upper.startsWith('MAIL FROM')) {
          from = line;
          socket.write('250 OK\r\n');
        } else if (upper.startsWith('RCPT TO')) {
          to.push(line);
          socket.write('250 OK\r\n');
        } else if (upper === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper.startsWith('QUIT')) {
          socket.write('221 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });

  return { server, received };
}

async function runCli(name, actions) {
  const workflowPath = path.join(TMP, `${name}.json`);
  fs.writeFileSync(workflowPath, JSON.stringify({ version: '1.0.0', name, actions }, null, 2));
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI, 'run', workflowPath, '--output', TMP, '--verbose'],
      { timeout: 30000 },
    );
    return stdout;
  } catch (e) {
    throw new Error(`${name} run failed: ${e.stderr || e.stdout || e.message}`);
  }
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  const { server, received } = createFakeSmtpServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const attachmentPath = path.join(TMP, 'note.txt');
  fs.writeFileSync(attachmentPath, 'hello attachment');

  try {
    const stdout = await runCli('mail-send-check', [
      {
        id: 'send',
        type: 'mailSend',
        host: '127.0.0.1',
        port,
        secure: false,
        user: 'sender@example.com',
        password: 'unused',
        to: 'dest@example.com',
        cc: 'watcher@example.com',
        subject: 'Test subject',
        body: 'Hello from mailSend',
        attachments: [{ filePath: attachmentPath, filename: 'note.txt' }],
      },
    ]);
    check('mailSend run completed', /completed successfully/.test(stdout));
    check('exactly one message was delivered', received.length === 1);

    const msg = received[0];
    console.log('[received envelope]', JSON.stringify({ from: msg.from, to: msg.to }));
    check('envelope From matches the account user', /sender@example\.com/.test(msg.from ?? ''));
    check('envelope To includes the recipient', msg.to.some((t) => /dest@example\.com/.test(t)));
    check('envelope To includes the cc recipient', msg.to.some((t) => /watcher@example\.com/.test(t)));
    check('message data contains the subject', msg.data.includes('Test subject'));
    check('message data contains the body text', msg.data.includes('Hello from mailSend'));
    check('message data contains the attachment filename', msg.data.includes('note.txt'));
    check('message data contains the attachment content (base64)', msg.data.includes(Buffer.from('hello attachment').toString('base64')));
  } finally {
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
