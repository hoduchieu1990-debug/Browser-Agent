const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// A small cell inside a much larger table: if the capture takes the table
// instead of the outlined cell, the size gives it away immediately.
const PAGE = `<!doctype html><html><body style="margin:0;padding:20px;background:#fff;font-family:sans-serif">
  <table id="t" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    <thead><tr><th style="width:200px;height:60px;background:#ddd">ID</th><th style="width:200px;height:60px;background:#ddd">Name</th></tr></thead>
    <tbody>
      <tr>
        <td id="cell" style="width:200px;height:60px;background:rgb(0,128,255);color:rgb(0,128,255)">one</td>
        <td style="width:200px;height:60px;background:#eee">Alice</td>
      </tr>
      <tr>
        <td style="width:200px;height:60px;background:#eee">two</td>
        <td style="width:200px;height:60px;background:#eee">Bob</td>
      </tr>
    </tbody>
  </table>
</body></html>`;

(async () => {
  const server = http.createServer((_r, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const userDataDir = path.join(__dirname, 'profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    await tab.setViewportSize({ width: 900, height: 600 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(700);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const frame = tab.locator('#__browser_agent_target_frame__');

    // aim at one cell
    const cellBox = await tab.locator('#cell').boundingBox();
    await tab.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
    await tab.waitForTimeout(450);

    const framed = await frame.boundingBox();
    const near = (a, b) => Math.abs(a - b) < 4;
    check(
      'the outline is around the cell, not the table',
      framed !== null && near(framed.width, cellBox.width) && near(framed.height, cellBox.height),
      `outline ${JSON.stringify(framed)} vs cell ${JSON.stringify(cellBox)}`,
    );

    await badge.locator('[data-ba-role="add"]').click();
    await tab.waitForTimeout(200);
    await badge.locator('button', { hasText: 'Image of this area' }).click();
    await tab.waitForTimeout(500);

    await popup.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    await tab.bringToFront();
    await popup.click('text=Preview');
    await popup.click('.replay-btn');
    await popup.waitForFunction(() => !document.querySelector('.replay-btn')?.hasAttribute('disabled'), {
      timeout: 60000,
    });
    await popup.waitForTimeout(900);

    const shot = await popup.evaluate(async () => {
      const img = document.querySelector('.result-image');
      if (!img) return null;
      const bitmap = await createImageBitmap(await (await fetch(img.src)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let onTarget = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i]) < 30 && Math.abs(data[i + 1] - 128) < 30 && Math.abs(data[i + 2] - 255) < 30) onTarget++;
      }
      return { width: bitmap.width, height: bitmap.height, onTargetPct: Math.round((onTarget / (data.length / 4)) * 100) };
    });

    check(
      'the image is the size of the outlined cell',
      shot !== null && near(shot.width, cellBox.width) && near(shot.height, cellBox.height),
      `${JSON.stringify(shot)} vs cell ${cellBox.width}x${cellBox.height}`,
    );
    check('and holds only what the outline covered', (shot?.onTargetPct ?? 0) >= 95, JSON.stringify(shot));
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
