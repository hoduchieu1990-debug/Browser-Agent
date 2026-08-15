const path = require('path');
const http = require('http');
const { WorkflowPlayer } = require(path.join(__dirname, '..', 'player', 'dist', 'index.js'));

const PAGE = `<!doctype html><html><body>
  <div id="out">value-<span id="q"></span></div>
  <script>
    const p = new URLSearchParams(location.search);
    document.getElementById('q').textContent = p.get('id') || '?';
  </script>
</body></html>`;

// The API docs advertise reusing one player for several runs. Does it actually
// reuse the browser, or does each run leak a new one?
(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const workflow = (id) => ({
    version: '1.0.0',
    name: 'lookup',
    actions: [
      { id: 'nav', type: 'navigate', url: `http://127.0.0.1:${port}/?id=${id}` },
      { id: 'read', type: 'extractText', selector: '#out', output: 'value' },
    ],
  });

  const player = new WorkflowPlayer({ headless: true });

  const browsers = new Set();
  const track = () => {
    // reach into the player to see which browser instance each run used
    const ctx = player.pageContext;
    if (ctx?.browser) browsers.add(ctx.browser);
    return ctx?.browser;
  };

  const r1 = await player.run(workflow('A'), {}, { outputDir: __dirname });
  const b1 = track();
  const r2 = await player.run(workflow('B'), {}, { outputDir: __dirname });
  const b2 = track();
  const r3 = await player.run(workflow('C'), {}, { outputDir: __dirname });
  track();

  console.log('run results:', r1.data.value, r2.data.value, r3.data.value);
  console.log('distinct browser instances used for 3 runs:', browsers.size);
  console.log('browser reused between run 1 and 2:', b1 === b2);

  let orphanConnected = 0;
  for (const b of browsers) if (b.isConnected()) orphanConnected++;
  console.log('browsers still connected before close():', orphanConnected);

  await player.close();

  let stillConnected = 0;
  for (const b of browsers) if (b.isConnected()) stillConnected++;
  console.log('browsers still connected AFTER close():', stillConnected, '(leaked)');

  server.close();
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
