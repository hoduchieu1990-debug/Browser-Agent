const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Two concrete reports of "khung không hiện đầy đủ để bắt được các đối
// tượng" (the frame doesn't fully show up to catch those objects):
//
// 1. A plain <img> with no wrapping link/button has no text and matches
//    none of the batch tags/roles either, so it matched none of the three
//    existing finders and the badge never appeared over it at all.
// 2. The extremely common custom-checkbox/radio pattern hides the real
//    <input> and shows a styled sibling <span> next to it, both inside a
//    <label> — the span is a SIBLING of the input, not a descendant, so
//    climbing parents from the span can never reach the input. This page
//    deliberately sets `cursor: default` on the span (overriding the
//    label's inherited `cursor: pointer`) so the only way detection can
//    still work is by recognizing the <label> ancestor directly, not by
//    happening to inherit a pointer cursor.
const IMG_SRC =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PAGE = `<!doctype html><html><body style="padding:20px;font-family:sans-serif">
  <img id="photo" src="${IMG_SRC}" width="120" height="80" style="display:block;margin-bottom:20px" />
  <label style="display:block;margin-bottom:20px;cursor:pointer">
    <input type="checkbox" id="realbox" style="position:absolute;opacity:0;width:0;height:0" />
    <span id="fakebox" style="cursor:default;display:inline-block;width:18px;height:18px;border:1px solid #333"></span>
    Custom checkbox
  </label>
</body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'image-checkbox-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const results = [];
  const check = (name, passed, detail = '') => {
    results.push({ name, passed });
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const tab = await context.newPage();
    await tab.setViewportSize({ width: 900, height: 900 });
    await tab.goto(`http://127.0.0.1:${port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await tab.bringToFront();
    await popup.click('.record-btn.start');
    await tab.waitForTimeout(700);

    const badge = tab.locator('#__browser_agent_add_badge__');
    const frame = tab.locator('#__browser_agent_target_frame__');

    const hover = async (selector) => {
      await tab.mouse.move(5, 5);
      await tab.waitForTimeout(120);
      const box = await tab.locator(selector).boundingBox();
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.waitForTimeout(300);
    };

    // ---------- 1. plain <img>, no wrapper ----------
    await hover('#photo');
    const frameVisibleForImg = await frame.evaluate((el) => el.style.display !== 'none').catch(() => false);
    check('the target frame appears over a plain <img>', frameVisibleForImg);

    const badgeVisibleForImg = await badge.evaluate((el) => el.style.display !== 'none').catch(() => false);
    check('the Add badge appears over a plain <img>', badgeVisibleForImg);

    if (badgeVisibleForImg) {
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(150);
      await badge.locator('button', { hasText: 'Image of this area' }).click();
      await tab.waitForTimeout(200);
    }

    // ---------- 2. custom checkbox (hidden input + styled sibling span) ----------
    await hover('#fakebox');
    const frameVisibleForCheckbox = await frame.evaluate((el) => el.style.display !== 'none').catch(() => false);
    check('the target frame appears over the styled span of a custom checkbox', frameVisibleForCheckbox);

    const badgeVisibleForCheckbox = await badge.evaluate((el) => el.style.display !== 'none').catch(() => false);
    check('the Add badge appears over the styled span of a custom checkbox', badgeVisibleForCheckbox);

    if (badgeVisibleForCheckbox) {
      await badge.locator('[data-ba-role="add"]').click();
      await tab.waitForTimeout(150);
      const clickOptionVisible = await badge
        .locator('button', { hasText: 'Click' })
        .evaluate((el) => el.style.display !== 'none')
        .catch(() => false);
      check('the custom checkbox offers a batch "Click" option', clickOptionVisible);
      if (clickOptionVisible) {
        await badge.locator('button', { hasText: 'Click' }).click();
        await tab.waitForTimeout(200);
      }
    }

    await tab.bringToFront();
    await popup.click('.record-btn.stop');
    await popup.waitForTimeout(300);

    const actions = await popup.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      return state.actions;
    });
    console.log('[recorded]', JSON.stringify(actions.map((a) => ({ type: a.type, selector: a.selector }))));

    const screenshotStep = actions.find((a) => a.type === 'screenshot');
    check('the image capture recorded a screenshot step', !!screenshotStep, JSON.stringify(screenshotStep));

    const batchClickStep = actions.find((a) => a.type === 'batchClick');
    check('the custom checkbox capture recorded a batchClick step', !!batchClickStep, JSON.stringify(batchClickStep));
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: image-and-custom-checkbox-check');
    process.exit(1);
  }
  console.log('PASS: image-and-custom-checkbox-check');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
