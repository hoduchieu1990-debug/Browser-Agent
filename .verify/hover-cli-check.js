const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', 'cli', 'dist', 'index.js');
const TMP = path.join(__dirname, 'hover-cli-tmp');

// A popover driven purely by CSS :hover, no JS at all — the case the
// extension's in-browser replay (hover-check.js) cannot open, because
// setting the :hover pseudo-class is internal browser state no dispatched
// event can reach. Playwright's real hover() moves an actual pointer, so
// player/cli handles this case the extension fundamentally cannot.
const PAGE = `<!doctype html><html><head><style>
  #popover { display: none; padding: 60px; }
  #trigger:hover + #popover { display: block; }
</style></head><body style="padding:60px">
  <button id="trigger">Hover me</button>
  <div id="popover"><a id="hidden-link" href="#">Secret Link</a></div>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  fs.mkdirSync(TMP, { recursive: true });
  const workflowPath = path.join(TMP, 'hover-cli-check.json');
  fs.writeFileSync(
    workflowPath,
    JSON.stringify(
      {
        version: '1.0.0',
        name: 'hover-cli-check',
        actions: [
          { id: 'nav', type: 'navigate', url: `http://127.0.0.1:${port}/` },
          { id: 'hover', type: 'hover', selector: '#trigger' },
          { id: 'extract', type: 'extractText', selector: '#hidden-link', output: 'text' },
        ],
        exportFormats: [{ type: 'json', output: 'text.json', dataKey: 'text' }],
      },
      null,
      2,
    ),
  );

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI, 'run', workflowPath, '--output', TMP, '--verbose'],
      { timeout: 30000 },
    );
    console.log(stdout);

    const passed = /completed successfully/.test(stdout);
    console.log(`${passed ? 'PASS' : 'FAIL'}  hover + extractText run completed`);

    const text = JSON.parse(fs.readFileSync(path.join(TMP, 'text.json'), 'utf-8'));
    console.log('[extracted text]', JSON.stringify(text));
    const textOk = text === 'Secret Link';
    console.log(`${textOk ? 'PASS' : 'FAIL'}  real hover() opened the CSS-only popover and the link text was captured`);

    console.log(`\n${(passed ? 1 : 0) + (textOk ? 1 : 0)}/2 checks passed`);
    if (!passed || !textOk) process.exitCode = 1;
  } catch (e) {
    console.error('FAILED:', e.stdout || e.stderr || e.message);
    process.exitCode = 1;
  } finally {
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})();
