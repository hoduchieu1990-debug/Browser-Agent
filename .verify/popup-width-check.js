const { chromium } = require('playwright');
const path = require('path');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
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

    const read = (p) =>
      p.evaluate(() => ({
        bodyWidth: Math.round(document.body.getBoundingClientRect().width),
        sidebarDirection: getComputedStyle(document.querySelector('.sidebar')).flexDirection,
      }));

    // Chrome hands a popup a small frame first and grows it to fit its
    // content, so anything the stylesheet sizes off the viewport would pin
    // it to that first tiny frame — which is exactly what used to happen.
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 200, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(400);

    const opened = await read(popup);
    check('popup keeps its full width in a small frame', opened.bodyWidth === 460, `${opened.bodyWidth}px`);
    check('and keeps its side rail', opened.sidebarDirection === 'column', opened.sidebarDirection);

    // the same narrow size, but docked: here it should adapt
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 320, height: 600 });
    await panel.goto(`chrome-extension://${extensionId}/popup.html?side=1`);
    await panel.waitForTimeout(400);

    const docked = await read(panel);
    check('docked panel fills the width it was given', docked.bodyWidth === 320, `${docked.bodyWidth}px`);
    check('and moves its nav to the top', docked.sidebarDirection === 'row', docked.sidebarDirection);

    // dragged wider, the panel goes back to the side rail
    await panel.setViewportSize({ width: 520, height: 600 });
    await panel.waitForTimeout(300);
    const widened = await read(panel);
    check('a widened panel returns to the side rail', widened.sidebarDirection === 'column', widened.sidebarDirection);
  } finally {
    await context.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
