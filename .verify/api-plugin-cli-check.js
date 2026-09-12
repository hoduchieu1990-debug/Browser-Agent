const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', 'cli', 'dist', 'index.js');
const TMP = path.join(__dirname, 'api-plugin-tmp');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function runCli(name, actions, exportFormats) {
  const workflowPath = path.join(TMP, `${name}.json`);
  fs.writeFileSync(workflowPath, JSON.stringify({ version: '1.0.0', name, actions, exportFormats }, null, 2));
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

  let lastRequest = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      lastRequest = { method: req.method, url: req.url, headers: req.headers, body };
      if (req.method === 'GET' && req.url.startsWith('/echo')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: req.url, query: Object.fromEntries(new URL(req.url, 'http://x').searchParams) }));
      } else if (req.method === 'POST') {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: JSON.parse(body || '{}'), nested: { items: [{ id: 1 }, { id: 2 }] } }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // ---------- apiGet with queryParams + httpHeaders ----------
    const stdout1 = await runCli(
      'api-get-check',
      [
        { id: 'nav', type: 'navigate', url: base },
        {
          id: 'get',
          type: 'apiGet',
          url: `${base}/echo`,
          queryParams: { name: 'alice', role: 'admin' },
          httpHeaders: { 'X-Test': 'yes' },
          output: 'result',
        },
      ],
      [{ type: 'json', output: 'result.json', dataKey: 'result' }],
    );
    check('apiGet run completed', /completed successfully/.test(stdout1));
    check('server received the X-Test header', lastRequest?.headers['x-test'] === 'yes');
    check(
      'server received the query params',
      lastRequest?.url.includes('name=alice') && lastRequest?.url.includes('role=admin'),
    );
    const getResult = JSON.parse(fs.readFileSync(path.join(TMP, 'result.json'), 'utf-8'));
    check(
      'apiGet output has the parsed JSON response',
      getResult.query.name === 'alice' && getResult.query.role === 'admin',
    );

    // ---------- apiPost (json body) -> apiJsonParse (dotted path) ----------
    const stdout2 = await runCli(
      'api-post-parse-check',
      [
        { id: 'nav', type: 'navigate', url: base },
        {
          id: 'post',
          type: 'apiPost',
          url: `${base}/submit`,
          body: JSON.stringify({ hello: 'world' }),
          output: 'postResultObj',
        },
        // apiPost already parses JSON into an object — apiJsonParse must
        // accept that directly (not just a raw string) and drill into it.
        { id: 'stringify', type: 'apiJsonParse', input: 'postResultObj', output: 'wholeThing' },
        { id: 'drill', type: 'apiJsonParse', input: 'postResultObj', path: 'nested.items', output: 'items' },
      ],
      [
        { type: 'json', output: 'items.json', dataKey: 'items' },
        { type: 'json', output: 'whole.json', dataKey: 'wholeThing' },
      ],
    );
    check('apiPost + apiJsonParse run completed', /completed successfully/.test(stdout2));
    check('server received a JSON POST body', lastRequest?.method === 'POST' && JSON.parse(lastRequest.body).hello === 'world');

    const items = JSON.parse(fs.readFileSync(path.join(TMP, 'items.json'), 'utf-8'));
    check('apiJsonParse drilled into the dotted path', Array.isArray(items) && items.length === 2 && items[0].id === 1);

    const whole = JSON.parse(fs.readFileSync(path.join(TMP, 'whole.json'), 'utf-8'));
    check('apiJsonParse with no path returns the whole object', whole.received.hello === 'world');
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
