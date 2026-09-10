const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');

// The Report window's content canvas was rewritten from up/down-button
// reordering + one combined "results" block into a real drag-and-drop
// palette where every result (text/table/image) is its own placeable block.
// This exercises the actual UI: palette rendering (with the right icon per
// result kind), dragging a block onto the canvas, drag-reordering, removing
// a block, and — via the Review tab — that a table result renders as a real
// HTML <table> (not "[object Object]") and an image result as an <img>.
const PAGE = `<!doctype html>
<html><body>
  <span id="total">1,284</span>
  <table id="results">
    <tr><th>ID</th><th>Name</th></tr>
    <tr><td>1</td><td>Alice</td></tr>
    <tr><td>2</td><td>Bob</td></tr>
  </table>
  <div id="shot" style="width:80px;height:40px;background:#4f46e5"></div>
</body></html>`;

// Fires a full drag sequence at the DOM level — Playwright has no built-in
// HTML5 drag-and-drop helper, and dragTo() only covers sortable-list-style
// cases, not a custom onDrop handler reading e.dataTransfer itself. Takes
// Locators directly (not selector strings) and hands their ElementHandles
// into evaluate, which Playwright unwraps to the real DOM nodes in-page —
// far more robust than re-deriving a CSS path for an element that may not
// have a stable one (a palette chip has no id, and nth-of-type miscounts
// once label divs are interspersed among the chips).
async function dragTo(page, sourceLocator, targetLocator) {
  const source = await sourceLocator.elementHandle();
  const target = await targetLocator.elementHandle();
  await page.evaluate(
    ({ source, target }) => {
      const dt = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    },
    { source, target },
  );
}

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const extensionPath = path.join(__dirname, '..', 'extension', 'dist');
  const profileDir = path.join(__dirname, 'profile-report-canvas');
  fs.rmSync(profileDir, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = worker.url().split('/')[2];

    const recording = {
      id: 'rec-report-canvas-check',
      name: 'Report canvas check',
      createdAt: new Date().toISOString(),
      actions: [
        { id: 'step-1', type: 'navigate', url: `http://127.0.0.1:${port}/` },
        { id: 'step-2', type: 'extractText', selector: '#total', output: 'text1' },
        { id: 'step-3', type: 'extractTable', selector: '#results', output: 'table1' },
        { id: 'step-4', type: 'screenshot', selector: '#shot', filename: 'image1.png', output: 'image1' },
      ],
    };

    // Seed storage directly rather than driving a full record session — the
    // recording's shape is all this check needs, not how it was produced.
    const seed = await context.newPage();
    await seed.goto(`chrome-extension://${extensionId}/popup.html`);
    await seed.evaluate((rec) => chrome.storage.local.set({ 'browser-agent-recordings': [rec] }), recording);
    await seed.close();

    const report = await context.newPage();
    await report.goto(`chrome-extension://${extensionId}/popup.html?report=${recording.id}`);
    await report.waitForSelector('.report-composer');

    // --- Palette: one chip per fixed block type, plus one per result, each
    // with the icon matching its kind. ---
    const chipTexts = await report.locator('.report-palette-chip').allTextContents();
    console.log('[palette]', JSON.stringify(chipTexts));
    assert(chipTexts.some((t) => t.includes('Heading')), 'expected a Heading palette chip');
    assert(chipTexts.some((t) => t.includes('Paragraph')), 'expected a Paragraph palette chip');
    assert(chipTexts.some((t) => t.includes('Divider')), 'expected a Divider palette chip');
    assert(chipTexts.some((t) => t.includes('🎯') && t.includes('text1')), `expected a text-kind chip for text1, got: ${JSON.stringify(chipTexts)}`);
    assert(chipTexts.some((t) => t.includes('📊') && t.includes('table1')), `expected a table-kind chip for table1, got: ${JSON.stringify(chipTexts)}`);
    assert(chipTexts.some((t) => t.includes('🖼️') && t.includes('image1')), `expected an image-kind chip for image1, got: ${JSON.stringify(chipTexts)}`);
    console.log('[ok] palette lists fixed blocks plus one chip per result, each with the right kind icon');

    // --- Drag a Heading chip onto the canvas drop zone. ---
    const headingChip = report.locator('.report-palette-chip', { hasText: 'Heading' });
    await dragTo(report, headingChip, report.locator('.report-canvas-end-zone'));
    await report.waitForTimeout(150);
    let blockTypes = await report.locator('.report-block .report-block-type').allTextContents();
    console.log('[after drag heading]', JSON.stringify(blockTypes));
    assert(blockTypes.some((t) => t.includes('Heading')), `expected a Heading block after dragging it onto the canvas, got: ${JSON.stringify(blockTypes)}`);
    console.log('[ok] dragging a palette chip onto the canvas adds that block');

    // --- Click-to-add fallback: click the table1 result chip. ---
    await report.locator('.report-palette-chip', { hasText: 'table1' }).click();
    await report.waitForTimeout(100);
    blockTypes = await report.locator('.report-block .report-block-type').allTextContents();
    assert(blockTypes.some((t) => t.includes('table1')), `expected clicking the table1 chip to append a block, got: ${JSON.stringify(blockTypes)}`);
    console.log('[ok] clicking a palette chip appends that block to the end (drag fallback)');

    // --- Drag to reorder: move the last block (table1) above the first. ---
    const firstBlock = report.locator('.report-block').first();
    // table1 already has a default block (the canvas starts pre-populated
    // with one block per result) plus the one just clicked in above — target
    // that second one specifically, not either "a table1 block" ambiguously.
    const lastBlock = report.locator('.report-block', { hasText: 'table1' }).last();
    await dragTo(report, lastBlock, firstBlock);
    await report.waitForTimeout(150);
    blockTypes = await report.locator('.report-block .report-block-type').allTextContents();
    console.log('[after reorder]', JSON.stringify(blockTypes));
    assert(blockTypes[0].includes('table1'), `expected table1 to now be first after drag-reordering, got: ${JSON.stringify(blockTypes)}`);
    console.log('[ok] dragging an existing block onto another reorders the canvas');

    // --- Remove a block. ---
    const countBefore = await report.locator('.report-block').count();
    await report.locator('.report-block .report-block-btn[title="Remove"]').first().click();
    const countAfter = await report.locator('.report-block').count();
    assert.strictEqual(countAfter, countBefore - 1, 'expected the ✕ button to remove exactly one block');
    console.log('[ok] the remove button still works alongside drag-and-drop');

    // --- Add the image and text results too, then review. ---
    await report.locator('.report-palette-chip', { hasText: 'image1' }).click();
    await report.locator('.report-palette-chip', { hasText: 'text1' }).click();
    await report.waitForTimeout(100);

    await report.locator('.report-tab', { hasText: 'Review' }).click();
    await report.waitForSelector('.report-preview-frame');
    await report.waitForTimeout(300);

    // sandbox="" (no allow-same-origin) puts the iframe in an opaque origin,
    // so contentDocument access from the parent page would throw — Playwright's
    // frameLocator reaches sandboxed frame content directly instead.
    const previewHtml = await report.frameLocator('.report-preview-frame').locator('body').innerHTML();
    console.log('[preview length]', previewHtml.length);
    assert(previewHtml.includes('<table'), 'expected the table result to render as a real <table>, not raw text');
    assert(!previewHtml.includes('[object Object]'), 'a table result rendered as "[object Object]" instead of real cells');
    assert(previewHtml.includes('<img'), 'expected the image result to render as an <img>');
    console.log('[ok] Review tab renders the table result as a real table and the image result as an <img>');

    await report.close();
  } finally {
    await context.close();
    server.close();
  }

  console.log('PASS: report-canvas-check');
})().catch((err) => {
  console.error('FAILED:', err.stack || err.message || err);
  process.exit(1);
});
