const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Two solid-colour blocks: one that fits on screen, one taller than it. Solid
// colour makes a misaligned crop obvious — any drift shows up as white.
const PAGE = `<!doctype html><html><body style="margin:0;background:#ffffff">
  <div style="height:700px"></div>
  <div id="small" style="width:300px;height:150px;background:rgb(0,128,255);margin-left:120px;color:rgb(0,128,255)">small</div>
  <div style="height:300px"></div>
  <div id="tall" style="width:400px;height:1400px;background:rgb(0,200,0);margin-left:120px;color:rgb(0,200,0)">tall</div>
  <div style="height:700px"></div>
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
    const captureImageOf = async (selector) => {
      await tab.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), selector);
      await tab.waitForTimeout(400);
      const box = await tab.locator(selector).boundingBox();
      await tab.mouse.move(box.x + box.width / 2, Math.max(20, box.y + Math.min(60, box.height / 2)));
      await tab.waitForTimeout(450);
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(200);
      await badge.locator('button', { hasText: 'Image of this area' }).click();
      await tab.waitForTimeout(450);
    };

    await captureImageOf('#small');
    await captureImageOf('#tall');

    await popup.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(400);

    // How much of each captured image is the colour it was aimed at? A crop
    // that drifted or ran past the element picks up the white page instead.
    const measure = () =>
      popup.evaluate(async () => {
        const images = [...document.querySelectorAll('.result-image')];
        const out = [];
        for (const img of images) {
          const bitmap = await createImageBitmap(await (await fetch(img.src)).blob());
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap, 0, 0);
          const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

          const tally = { blue: 0, green: 0, other: 0 };
          for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            if (Math.abs(r) < 30 && Math.abs(g - 128) < 30 && Math.abs(b - 255) < 30) tally.blue++;
            else if (Math.abs(r) < 30 && Math.abs(g - 200) < 30 && Math.abs(b) < 30) tally.green++;
            else tally.other++;
          }
          const total = data.length / 4;
          out.push({
            size: `${bitmap.width}x${bitmap.height}`,
            bluePct: Math.round((tally.blue / total) * 100),
            greenPct: Math.round((tally.green / total) * 100),
          });
        }
        return out;
      });

    const run = async (label) => {
      await tab.bringToFront();
      await popup.click('.replay-btn');
      await popup.waitForFunction(() => !document.querySelector('.replay-btn')?.hasAttribute('disabled'), {
        timeout: 60000,
      });
      await popup.waitForTimeout(900);
      const shots = await measure();
      const fitting = shots.find((s) => s.bluePct > s.greenPct);
      const oversized = shots.find((s) => s.greenPct >= s.bluePct);
      check(`${label}: an element that fits is captured cleanly`, (fitting?.bluePct ?? 0) >= 95, JSON.stringify(fitting));
      check(`${label}: one taller than the screen too`, (oversized?.greenPct ?? 0) >= 95, JSON.stringify(oversized));
    };

    await popup.click('text=Preview');
    await run('on screen');

    // the background route renders the page off-screen — same expectations
    await popup.locator('.replay-option input[type="checkbox"]').check();
    await run('in background');
    await popup.locator('.replay-option input[type="checkbox"]').uncheck();

    // browser zoom changes how page coordinates map onto captured pixels
    await worker.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true, windowType: 'normal' });
      await chrome.tabs.setZoom(t.id, 1.5);
    });
    await tab.waitForTimeout(500);
    await run('zoomed to 150%');

    // Zoom is remembered per origin in the profile these checks share, so
    // leaving it set would skew every run that follows.
    await worker.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true, windowType: 'normal' });
      await chrome.tabs.setZoom(t.id, 1);
    });
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
