// Embedded verbatim into an exported workflow.json whenever it contains a
// "nexacro:<id>" selector (see workflow-builder.ts) — so a program built by
// someone with no access to this repo can still replay those steps, using
// only the exported .json. Kept as a single self-contained script (no
// imports) since it's meant to be copied out and injected into the page
// as-is, e.g. via Playwright's page.evaluate() or Selenium's
// execute_script(), not run as part of this codebase.
export const NEXACRO_BRIDGE_SCRIPT = `
// Resolves "nexacro:<componentId>" down to the live Nexacro component object.
// A component id is a dotted path under window.nexacro.getApplication(), e.g.
// "mainframe.form.edtUsername" — the object the id names is where the real
// value/click handler live, not the DOM node the id also happens to match
// (Nexacro renders every widget as a plain positioned <div>; there is no real
// <input>/<select>/<table> to drive with ordinary DOM APIs).
function resolveComponent(id) {
  var nexacro = window.nexacro;
  var app = nexacro && nexacro.getApplication ? nexacro.getApplication() : null;
  if (!app) return null;

  // Drop a trailing DOM-only rendering suffix, e.g. "TextField00:box" -> "TextField00".
  // Only the LAST path segment is allowed to carry one.
  var parts = id.replace(/:[^:.]*$/, '').split('.');
  var obj = app;
  for (var i = 0; i < parts.length; i++) {
    var next = obj ? obj[parts[i]] : undefined;
    if (next === undefined) {
      // A Nexacro app that opens screens in dynamic "work windows" suffixes
      // that window's frame id with a run-specific instance number, e.g.
      // "winFFM0371_0_744" — a different number every time the screen opens,
      // even in the same session. Recover by asking the containing frameset
      // for whichever frame currently serves the same stable prefix
      // ("winFFM0371") instead of failing outright.
      var m = /^(win[A-Za-z0-9]+)_\\d+_\\d+$/.exec(parts[i]);
      if (m) next = findActiveFrameByFormId(obj, m[1]);
      if (next === null || next === undefined) {
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
  var active = typeof container.getActiveFrame === 'function' ? container.getActiveFrame() : null;
  if (active && active.id && String(active.id).indexOf(formId) === 0) return active;
  var all = container.all;
  if (all && typeof all.length === 'number') {
    for (var i = 0; i < all.length; i++) {
      var frame = all[i];
      if (frame && frame.id && String(frame.id).indexOf(formId) === 0) return frame;
    }
  }
  return null;
}

// Poll this (every ~200ms, up to ~15s) instead of resolving once — right
// after navigate, the component tree can take several seconds to finish
// constructing on a heavy real app.
function resolveComponentWithRetry(id, deadlineMs) {
  return new Promise(function (resolve) {
    var deadline = Date.now() + (deadlineMs || 15000);
    (function attempt() {
      var comp = resolveComponent(id);
      if (comp || Date.now() >= deadline) return resolve(comp);
      setTimeout(attempt, 200);
    })();
  });
}

// A Nexacro click can trigger a server round-trip — wait for this to go true
// before the next step. A timeout here is a soft warning, not a hard failure.
function isIdleNow() {
  var bc = getComputedStyle(document.body).cursor;
  var hc = getComputedStyle(document.documentElement).cursor;
  if (bc === 'wait' || bc === 'progress' || hc === 'wait' || hc === 'progress') return false;
  var nodes = document.querySelectorAll('[id*="waitwindow"]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    var s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
    return false; // a visible loading overlay is still up
  }
  return true;
}

function waitIdle(timeoutMs) {
  return new Promise(function (resolve) {
    var deadline = Date.now() + (timeoutMs || 8000);
    (function poll() {
      if (isIdleNow() || Date.now() >= deadline) return resolve();
      setTimeout(poll, 150);
    })();
  });
}

// Runs one recorded step's action against the resolved component. Never call
// comp.onclick/comp.onchange unless they're actually plain functions — on a
// real component they're usually a Nexacro EventHandler object instead, and
// calling that directly throws.
function runComponentAction(comp, type, value) {
  if (type === 'click') {
    if (typeof comp.click === 'function') comp.click();
    if (typeof comp.onclick === 'function') comp.onclick();
  } else if (type === 'input') {
    if (typeof comp.set_value === 'function') comp.set_value(value || '');
    if (typeof comp.setFocus === 'function') comp.setFocus();
    if (typeof comp.onchange === 'function') comp.onchange();
  }
}

function getComponentValue(comp) {
  if (comp.value !== undefined) return String(comp.value);
  if (typeof comp.get_value === 'function') return String(comp.get_value() || '');
  return '';
}

// Never read a Grid off the DOM — it virtualizes rows/columns outside the
// rendered viewport, so a cell far from view can have no DOM node at all
// while its data still exists.
function extractGridData(grid) {
  var dataset = typeof grid.getBindDataset === 'function' ? grid.getBindDataset() : null;
  if (!dataset) return { error: 'no bound dataset' };

  var columns = [];
  for (var c = 0; c < dataset.colcount; c++) columns.push(dataset.getColID(c));
  var rawRows = [];
  for (var r = 0; r < dataset.rowcount; r++) {
    var row = {};
    for (var ci = 0; ci < columns.length; ci++) row[columns[ci]] = dataset.getColumn(r, columns[ci]);
    rawRows.push(row);
  }

  // Prefer what the screen actually paints (combo labels, number formatting)
  // over the raw code/id values, by mapping each body cell to its header text
  // through the grid's own head/body cell metadata — not by matching head and
  // body cells at the same rendered column position (a merged group header,
  // or a hidden column, makes those diverge).
  var mappedRows = [];
  try {
    var headCount = grid.getCellCount('head');
    var heads = [];
    for (var hi = 0; hi < headCount; hi++) {
      var text = String(grid.getCellProperty('head', hi, 'text') || '').trim();
      if (!text) continue;
      heads.push({
        text: text,
        col: Number(grid.getCellProperty('head', hi, 'col')) || 0,
        row: Number(grid.getCellProperty('head', hi, 'row')) || 0,
        colspan: Number(grid.getCellProperty('head', hi, 'colspan')) || 1,
      });
    }
    var bodyCount = grid.getCellCount('body');
    var bodyColumns = []; // index 0 is the grid's own state/checkbox column — skip it
    for (var bi = 1; bi < bodyCount; bi++) {
      var bodyCol = Number(grid.getCellProperty('body', bi, 'col'));
      if (isNaN(bodyCol)) continue;
      var matched = heads.filter(function (h) { return bodyCol >= h.col && bodyCol < h.col + h.colspan; });
      matched.sort(function (x, y) { return y.row - x.row || x.colspan - y.colspan; }); // deepest, narrowest header wins
      if (matched[0]) bodyColumns.push({ cellIndex: bi, header: matched[0].text });
    }
    if (bodyColumns.length > 0) {
      for (var mr = 0; mr < dataset.rowcount; mr++) {
        var mapped = {};
        for (var bci = 0; bci < bodyColumns.length; bci++) {
          var t = grid.getCellText(mr, bodyColumns[bci].cellIndex);
          mapped[bodyColumns[bci].header] = t === undefined ? null : t;
        }
        mappedRows.push(mapped);
      }
    }
  } catch (e) {
    mappedRows = [];
  }

  return { rows: mappedRows.length > 0 ? mappedRows : rawRows };
}
`.trim();

export const NEXACRO_REPLAY_README = `
This workflow contains one or more "nexacro:<componentId>" selectors — steps
recorded against a Nexacro app (not plain HTML). A CSS query cannot replay
those: there is no real DOM control to query, the value/click lives on
window.nexacro's own object tree in the page's own JavaScript. This file is
self-contained — nexacroReplayGuide.bridgeScript below is ready to inject as-is
(e.g. Playwright page.evaluate(), Selenium execute_script()) and
nexacroReplayGuide.readme (this text) explains how to use it. No other file or
access to the project that produced this export is needed.

DISPATCHING EACH STEP
For every action except "navigate", "wait", and "scroll": if action.selector
starts with "nexacro:", strip that prefix to get the componentId and use the
bridge functions below — do NOT run a DOM query. Otherwise, treat
action.selector (and action.selectorFallbacks, in order, as a fallback chain)
as an ordinary CSS selector and drive it exactly the way you would on any
plain HTML page — nothing Nexacro-specific applies to those steps.
"action.framework" is metadata only (a hint for a human reading the file
later) — it is never what decides replay behavior; the selector prefix is.

USING THE BRIDGE (functions are in nexacroReplayGuide.bridgeScript)
  1. var comp = await resolveComponentWithRetry(componentId);
     // poll for up to ~15s — right after a "navigate" step, a heavy app's
     // component tree can take several seconds to finish constructing.
  2. runComponentAction(comp, action.type, action.value);
     // action.type is "click" or "input" — that's the entire recorded
     // vocabulary against a nexacro: selector; "select" only ever targets a
     // plain HTML <select> and never carries this prefix.
  3. await waitIdle();
     // a click can trigger a server round-trip; wait for it to settle before
     // the next step.
  4. To read a value back (e.g. for an extractText-equivalent step):
     getComponentValue(comp)
  5. To extract a Grid's rows (extractTable): extractGridData(comp)

WHICH COMPONENT TYPES EVER GET A nexacro: SELECTOR
Only these — a recording on anything else already fell back to a plain CSS
selector at record time, so you'll never need the bridge for it: Button,
TextField, Edit, Combo, MultiCombo, CheckBox, CheckBoxSet, Radio, RadioSet,
DateField, Grid.

KNOWN-FRAGILE PATTERN: a Grid cell's own combo/dropdown editor
A dropdown that lives inside a Grid cell (as opposed to a standalone Combo
component) renders its option list as a transient popup that only exists
while it's open. Recording a selection from one is a sequence of plain click
steps with CSS selectors pointing at that popup's items (ids like
"....cellcombo0.combolist.item_1:text") — by replay time that exact popup
instance may not exist yet or may already be gone, so "element not found"
here reflects a real, currently-unsolved limitation of the recorder, not a
bug in your reimplementation. The more robust approach: replay the click that
opens the cell's editor, wait for some popup list to appear, then click
whichever item in it matches the recorded option's TEXT, rather than trusting
the exact recorded id to still exist.

TIMING GOTCHA for extractText/extractTable/screenshot steps
Don't trust an element's position/size on the very first read right after a
navigate or a click that changed the page — Nexacro can keep repositioning
things for a couple of seconds while its component tree finishes constructing
(confirmed live: a login card kept sliding for 2+ seconds after the page
"loaded"). Poll getBoundingClientRect() until it stops changing for ~300ms
(cap the wait at a few seconds and use whatever was last measured) before
trusting it or cropping a screenshot to it.
`.trim();
