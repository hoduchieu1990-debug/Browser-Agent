const path = require('path');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// The recorder can now emit Playwright's :nth-match() syntax. The in-browser
// replay resolves it by hand; this proves the CLI's Playwright engine agrees.
const PAGE = `<!doctype html><html><body>
  <main>
    <pre>first block</pre>
    <pre>second block</pre>
    <pre>third block</pre>
  </main></body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const dir = path.join(__dirname, 'nth-run');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const workflow = {
    version: '1.0.0',
    name: 'nth-match',
    actions: [
      { id: 's1', type: 'navigate', url: `http://127.0.0.1:${port}/` },
      { id: 's2', type: 'extractText', selector: ':nth-match(main pre, 2)', output: 'second' },
      { id: 's3', type: 'extractText', selector: ':nth-match(main pre, 3)', output: 'third' },
    ],
    exportFormats: [
      { type: 'json', output: 'second.json', dataKey: 'second' },
      { type: 'json', output: 'third.json', dataKey: 'third' },
    ],
  };
  const workflowPath = path.join(dir, 'wf.json');
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

  const cli = path.join(__dirname, '..', 'cli', 'dist', 'index.js');

  const { stdout: validated } = await execFileAsync(process.execPath, [cli, 'validate', workflowPath]);
  console.log(validated.trim());

  try {
    const { stdout } = await execFileAsync(process.execPath, [cli, 'run', workflowPath, '--output', dir]);
    console.log(stdout.trim());
  } catch (error) {
    console.log(error.stdout || error.message);
    process.exitCode = 1;
  }

  const second = fs.readFileSync(path.join(dir, 'second.json'), 'utf-8').trim();
  const third = fs.readFileSync(path.join(dir, 'third.json'), 'utf-8').trim();
  console.log('second =', second);
  console.log('third  =', third);

  const ok = second === '"second block"' && third === '"third block"';
  console.log(ok ? '\nPASS  Playwright resolves :nth-match the same way' : '\nFAIL  mismatch');
  if (!ok) process.exitCode = 1;

  server.close();
})().catch((e) => {
  console.error('FAILED:', e.stdout || e);
  process.exit(1);
});
