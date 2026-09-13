# Replaying a Browser Agent workflow.json from outside this project

This is for another program (built by another AI agent, in any language/framework)
that needs to read a workflow `.json` exported from this extension and replay it
**without** using this repo's own CLI. It documents the actual, tested behavior of
this codebase — not an aspirational design. If you just need to run the file with
this project's own tooling, use `browser-agent run <file>.json` instead; none of
this is necessary in that case.

The two things a from-scratch implementation needs are: (1) the plain JSON schema
(trivial — any JSON-capable language reads it), and (2) the Nexacro bridge protocol
(the hard part — a Nexacro app's UI is not plain DOM, so a `nexacro:<id>` selector
needs a small piece of JavaScript run **inside the page**, not just a CSS query).

## 1. The workflow JSON shape

```ts
interface Workflow {
  version: string;
  name: string;
  description?: string;
  params?: { name: string; type: 'string'|'number'|'boolean'|'file'; required?: boolean }[];
  actions: WorkflowAction[];
}

interface BaseAction {
  id: string;
  type: string;               // see the action list below
  selector?: string;          // CSS selector, OR "nexacro:<componentId>" — see §2
  selectorFallbacks?: string[]; // tried in order if `selector` no longer matches
  value?: string;
  waitBefore?: number;        // ms to wait before the step
  waitAfter?: number;         // ms to wait after the step
  onError?: 'fail' | 'skip' | 'ignore';
  framework?: 'nexacro' | 'websquare'; // metadata only — never read to decide
                                        // replay behavior; the selector prefix
                                        // is what actually decides that (§2)
}
```

Action types you'll actually see from a Nexacro recording: `navigate` (`url`),
`click` (`selector`), `input` (`selector`, `value`), `select` (`selector`,
`value` — plain HTML `<select>` only), `extractText` (`selector`, `output`),
`extractTable` (`selector`, `output`, `headers?`), `screenshot` (`selector`,
`output`, `filename`), `hover` (`selector`), `scroll` (`position: 'top'|
'bottom'|'center'` or `pixels`), `wait` (`duration`), `uploadFile` (`selector`,
`value` — a file path or `${param}` placeholder).

For every type **except** `navigate`, `wait`, and `scroll`: if `selector` starts
with `nexacro:`, do NOT run a DOM query at all — use the bridge protocol in §2.
Otherwise, treat `selector` (and `selectorFallbacks`, in order, as a fallback
chain) as an ordinary CSS selector and drive it exactly the way you would on any
plain HTML page (Playwright locator / Selenium find_element / etc.) — nothing
Nexacro-specific applies to those steps.

## 2. The `nexacro:<componentId>` protocol

### 2.1 Why this exists

A Nexacro app (this was built against `demo.tobesoft.com`, Nexacro N / HTML5
runtime) renders every widget as an absolutely-positioned `<div>` — there is no
real `<input>`, `<select>`, or `<table>` to drive with ordinary DOM APIs. The
actual component (its value, its click handler, its bound dataset) lives on
`window.nexacro`'s own object tree in the page's JavaScript, not in the DOM. A
CSS selector can locate the *rendered box*, but only the component object can
tell you its value or make it respond correctly the way clicking it with a real
mouse would (e.g. for a Grid, `.click()` on the DOM node does nothing useful —
you need `component.click()`, its own method, or better, `set_value`/`get_value`
for anything that holds a value).

### 2.2 Resolving a component id to the live object

`componentId` is everything after the `nexacro:` prefix — a dotted path like
`mainframe.form.edtUsername`, matching the object path under
`window.nexacro.getApplication()`. Resolve it like this (tested, verbatim logic
from this project's own bridge):

```js
function resolveComponent(id) {
  const nexacro = window.nexacro;
  const app = nexacro?.getApplication?.();
  if (!app) return null;

  // Drop a trailing DOM-only rendering suffix, e.g. "TextField00:box" -> "TextField00".
  // Only the LAST path segment is allowed to have one.
  const parts = id.replace(/:[^:.]*$/, '').split('.');
  let obj = app;
  for (let i = 0; i < parts.length; i++) {
    let next = obj?.[parts[i]];
    if (next === undefined) {
      // A Nexacro app that opens screens in dynamic "work windows" suffixes
      // that window's frame id with a run-specific instance number, e.g.
      // "winFFM0371_0_744" — a different number every time the screen opens,
      // even in the same session. Recover by asking the containing frameset
      // for whichever frame currently serves the same stable prefix
      // ("winFFM0371") instead of failing outright.
      const m = /^(win[A-Za-z0-9]+)_\d+_\d+$/.exec(parts[i]);
      if (m) next = findActiveFrameByFormId(obj, m[1]);
      if (next == null) {
        // A miss on any segment OTHER than the last one means the component
        // tree isn't fully built yet (real, right after navigation — can take
        // several seconds on a heavy app). Only the last segment is allowed
        // to be a harmless DOM-rendering artifact with no matching property.
        return i === parts.length - 1 ? obj : null;
      }
    }
    obj = next;
  }
  return obj;
}

function findActiveFrameByFormId(container, formId) {
  if (!container) return null;
  const active = typeof container.getActiveFrame === 'function' ? container.getActiveFrame() : null;
  if (active?.id && String(active.id).indexOf(formId) === 0) return active;
  const all = container.all;
  if (all && typeof all.length === 'number') {
    for (let i = 0; i < all.length; i++) {
      const frame = all[i];
      if (frame?.id && String(frame.id).indexOf(formId) === 0) return frame;
    }
  }
  return null;
}
```

**Retry, don't fail fast**: right after a `navigate` step, the component tree
can take multiple seconds to finish constructing (observed ~8s on a heavy real
app). Poll `resolveComponent` every ~200ms for up to ~15s before giving up.

### 2.3 Running the four supported actions

Once you have `comp = resolveComponent(componentId)`:

| Recorded step | What to actually run |
|---|---|
| `click` | `comp.click?.(); if (typeof comp.onclick === 'function') comp.onclick();` |
| `input` (set a value) | `comp.set_value?.(value); comp.setFocus?.(); if (typeof comp.onchange === 'function') comp.onchange();` |
| reading a value back | `String(comp.value ?? comp.get_value?.() ?? '')` |
| `extractTable` on a Grid | see §2.4 |

Note `comp.onclick`/`comp.onchange` are only ever called as plain functions —
never call them if they're a Nexacro EventHandler *object* instead of a
function (checking `typeof === 'function'` first, as above, avoids that).

After a `click` that might trigger a server round-trip, wait for the app to go
idle before moving to the next step:

```js
function isIdleNow() {
  const bc = getComputedStyle(document.body).cursor;
  const hc = getComputedStyle(document.documentElement).cursor;
  if (bc === 'wait' || bc === 'progress' || hc === 'wait' || hc === 'progress') return false;
  for (const el of document.querySelectorAll('[id*="waitwindow"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
    return false; // a visible loading overlay is still up
  }
  return true;
}
// poll isIdleNow() every ~150ms, up to ~8s, before the next step — a timeout
// here is a soft warning, not a hard failure; whatever's next will catch a
// still-loading page on its own.
```

### 2.4 Extracting a Grid's data

**Never** read a Grid off the DOM — it virtualizes rows and columns outside the
rendered viewport, so a cell far from view can have no DOM node at all while its
data still exists.

```js
function extractGridData(grid) {
  const dataset = typeof grid?.getBindDataset === 'function' ? grid.getBindDataset() : null;
  if (!dataset) return { error: 'no bound dataset' };

  const columns = [];
  for (let c = 0; c < dataset.colcount; c++) columns.push(dataset.getColID(c));
  const rawRows = [];
  for (let r = 0; r < dataset.rowcount; r++) {
    const row = {};
    for (const col of columns) row[col] = dataset.getColumn(r, col);
    rawRows.push(row);
  }

  // Prefer what the screen actually paints (combo labels, number formatting)
  // over the raw code/id values, by mapping each body cell to its header text
  // through the grid's own head/body cell metadata — not by matching head and
  // body cells at the same rendered column position (a merged group header, or
  // a hidden column, makes those diverge).
  let mappedRows = [];
  try {
    const headCount = grid.getCellCount('head');
    const heads = [];
    for (let hi = 0; hi < headCount; hi++) {
      const text = String(grid.getCellProperty('head', hi, 'text') || '').trim();
      if (!text) continue;
      heads.push({
        text,
        col: Number(grid.getCellProperty('head', hi, 'col')) || 0,
        row: Number(grid.getCellProperty('head', hi, 'row')) || 0,
        colspan: Number(grid.getCellProperty('head', hi, 'colspan')) || 1,
      });
    }
    const bodyCount = grid.getCellCount('body');
    const bodyColumns = []; // index 0 is the grid's own state/checkbox column — skip it
    for (let bi = 1; bi < bodyCount; bi++) {
      const bodyCol = Number(grid.getCellProperty('body', bi, 'col'));
      if (Number.isNaN(bodyCol)) continue;
      const matched = heads.filter((h) => bodyCol >= h.col && bodyCol < h.col + h.colspan);
      matched.sort((x, y) => y.row - x.row || x.colspan - y.colspan); // deepest, narrowest header wins
      if (matched[0]) bodyColumns.push({ cellIndex: bi, header: matched[0].text });
    }
    if (bodyColumns.length > 0) {
      for (let r = 0; r < dataset.rowcount; r++) {
        const mapped = {};
        for (const { cellIndex, header } of bodyColumns) {
          const t = grid.getCellText(r, cellIndex);
          mapped[header] = t === undefined ? null : t;
        }
        mappedRows.push(mapped);
      }
    }
  } catch {
    mappedRows = [];
  }

  return { rows: mappedRows.length > 0 ? mappedRows : rawRows };
}
```

Grid data can arrive slightly after the component resolves (loading overlay
clears before the dataset actually binds) — poll for a first row for a few
seconds rather than trusting an immediate empty result.

## 3. Which component types this actually resolves

Only these Nexacro component types get a working `nexacro:` id at all — a
recording on anything else falls back to a plain CSS selector automatically, so
those steps replay with ordinary DOM automation, no bridge involved:
`Button`, `TextField`, `Edit`, `Combo`, `MultiCombo`, `CheckBox`, `CheckBoxSet`,
`Radio`, `RadioSet`, `DateField`, `Grid`. Anything else (labels, containers,
custom cell-editors inside a Grid) was never a `nexacro:` selector to begin
with — you'll see a normal CSS selector for those and should just drive it like
any other page element.

## 4. Known-fragile pattern: a Grid cell's own combo/dropdown editor

A dropdown that lives *inside a Grid cell* (as opposed to a real `Combo`
component) renders its option list as a **transient popup** that only exists
while it's open. A recording of picking one of its options is a sequence of
plain `click` steps with CSS selectors pointing at that popup's items (e.g.
`....cellcombo0.combolist.item_1:text`) — and by the time replay runs, that
exact popup instance may not exist yet, or may have already closed, so
"element not found" here is a real, currently-unsolved limitation of this
project, not a sign your reimplementation is wrong. If you need this to work
reliably, the most robust approach is: replay the click that opens the cell's
editor, wait for *some* popup list to appear, then click whichever item in it
matches the recorded option's **text**, rather than trusting the exact recorded
id/selector to still exist.

## 5. Minimal reference runner (Playwright)

```js
const { chromium } = require('playwright');
const workflow = require('./exported-workflow.json');

const BRIDGE_JS = `/* paste the functions from §2.2–§2.4 here, unmodified */`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const action of workflow.actions) {
    if (action.type === 'navigate') { await page.goto(action.url); continue; }
    if (action.type === 'wait') { await page.waitForTimeout(action.duration); continue; }

    const isNexacro = action.selector?.startsWith('nexacro:');
    const componentId = isNexacro ? action.selector.slice('nexacro:'.length) : null;

    if (isNexacro) {
      // page.evaluate runs in the page's own JS world already — no
      // cross-world messaging needed here (that machinery in this project's
      // own nexacro-bridge.ts exists only because a Chrome extension's
      // content script is isolated from the page; a Playwright script isn't).
      await page.evaluate(([id, type, value]) => {
        ${'/* inline BRIDGE_JS functions available here */'}
        const comp = resolveComponent(id); // add your own poll/retry around this
        if (type === 'click') { comp.click?.(); if (typeof comp.onclick === 'function') comp.onclick(); }
        if (type === 'input') { comp.set_value?.(value); comp.setFocus?.(); if (typeof comp.onchange === 'function') comp.onchange(); }
      }, [componentId, action.type, action.value]);
      continue;
    }

    // Plain DOM path — try selector, then each fallback, in order.
    const candidates = [action.selector, ...(action.selectorFallbacks ?? [])];
    let locator;
    for (const sel of candidates) {
      const l = page.locator(sel).first();
      if (await l.count() > 0) { locator = l; break; }
    }
    if (!locator) { if (action.onError !== 'skip' && action.onError !== 'ignore') throw new Error(`not found: ${action.selector}`); continue; }

    if (action.type === 'click') await locator.click();
    else if (action.type === 'input') await locator.fill(action.value);
    else if (action.type === 'select') await locator.selectOption(action.value);
    else if (action.type === 'hover') await locator.hover();
    // extractText/extractTable/screenshot: read locator.textContent(), or
    // crop a screenshot to locator.boundingBox() — see the note on timing below.
  }

  await browser.close();
})();
```

## 6. A screenshot/`extractText`/`extractTable` timing gotcha

If a step reads or screenshots an element right after a `navigate` or a click
that changed the page, don't trust the element's position/size on the very
first read — Nexacro can keep repositioning things for a couple of seconds
while its own component tree finishes constructing (confirmed live: a login
card kept sliding for 2+ seconds after the page "loaded"). Poll
`getBoundingClientRect()` until it stops changing for ~300ms (cap the wait at
a few seconds and use whatever you last measured) before trusting it, rather
than reading it once on a fixed short delay.
