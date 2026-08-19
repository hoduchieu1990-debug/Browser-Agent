const path = require('path');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// Confirms the OTHER replay path — CLI/player, driven straight through
// Playwright with no extension involved — resolves nexacro:<id> selectors
// too. Unlike the extension, Playwright's page.evaluate() runs in the page's
// real JS world already, so no bridge script is needed here; player/src/
// utils/nexacro.ts talks to window.nexacro directly.
const PAGE = `<!doctype html>
<html><body>
  <div id="edtUsername"></div>
  <div id="btnLogin">Login</div>
  <div id="result"></div>
  <script>
    const components = {
      edtUsername: {
        _type: 'Edit',
        value: '',
        set_value(v) { this.value = v; },
        get_value() { return this.value; },
        setFocus() {},
        onchange() {},
        getDOMElement() { return document.getElementById('edtUsername'); },
      },
      btnLogin: {
        _type: 'Button',
        click() { document.getElementById('result').textContent = 'clicked:' + components.edtUsername.value; },
        onclick() {},
        getDOMElement() { return document.getElementById('btnLogin'); },
      },
    };
    window.nexacro = { getActiveFrame: () => ({ components, lookup: (id) => components[id] || null }) };
  </script>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const workflowPath = path.join(__dirname, 'nexacro-workflow.json');
  const workflow = {
    version: '1.0.0',
    name: 'nexacro-cli-check',
    actions: [
      { id: 'step-1', type: 'navigate', url: `http://127.0.0.1:${port}/` },
      { id: 'step-2', type: 'input', selector: 'nexacro:edtUsername', value: 'admin' },
      { id: 'step-3', type: 'click', selector: 'nexacro:btnLogin' },
      { id: 'step-4', type: 'extractText', selector: '#result', output: 'resultText' },
    ],
    exportFormats: [{ type: 'json', output: 'nexacro-result.json', dataKey: 'resultText' }],
  };
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(__dirname, '..', 'cli', 'dist', 'index.js'),
      'run',
      workflowPath,
      '--output',
      __dirname,
      '--verbose',
    ]);
    console.log(stdout);

    const resultPath = path.join(__dirname, 'nexacro-result.json');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    console.log('[result]', JSON.stringify(result));

    if (result !== 'clicked:admin') {
      throw new Error(`expected extracted #result text to be "clicked:admin" (proving player set_value+click ran through window.nexacro directly), got: ${JSON.stringify(result)}`);
    }
    console.log('[ok] CLI/player resolves nexacro: selectors via page.evaluate, no extension involved');

    fs.unlinkSync(workflowPath);
    fs.unlinkSync(resultPath);
  } finally {
    server.close();
  }

  console.log('PASS: nexacro-cli-check');
})().catch((err) => {
  console.error('FAILED:', err.stdout || err.message || err);
  process.exit(1);
});
