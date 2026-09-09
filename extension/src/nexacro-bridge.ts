// Injected via <script src> into the page's own JS world — this is the only
// way to reach window.nexacro, since MV3 content scripts run in an isolated
// world that shares the DOM but not globals. Communication with the content
// script happens over CustomEvents on `document`, which both worlds can see.
const MARK_ATTR = 'data-ba-nexacro-id';
const TYPE_ATTR = 'data-ba-nexacro-type';
const MARKING_EVENT = '__ba_nexacro_marking__';
const REQUEST_EVENT = '__ba_nexacro_request__';
const RESPONSE_EVENT = '__ba_nexacro_response__';

interface NexacroComponent {
  _type_name?: string;
  value?: unknown;
  click?: () => void;
  onclick?: unknown;
  set_value?: (value: string) => void;
  get_value?: () => unknown;
  setFocus?: () => void;
  onchange?: unknown;
}

// A Nexacro app that opens screens in dynamic "work windows" (any real
// multi-screen Nexacro MES/ERP app, as opposed to the single-frame demo
// VERIFIED_FACTS.md was written against) assigns that window's frame id an
// instance suffix the moment it opens — e.g. "winFFM0371_0_744" — and a
// different suffix the next time the same screen opens, even in the same
// session. A component id recorded under it therefore stops resolving
// verbatim on a fresh run. Detect that shape and recover by asking the
// containing frameset for whichever frame is CURRENTLY serving that same
// stable prefix ("winFFM0371"), instead of failing outright. The "win"
// prefix is Nexacro Studio's own default naming convention for a work
// window's root form, not a guess — confirmed against a live production
// Nexacro automation tool's own resolver, which uses this exact pattern.
const DYNAMIC_FRAME_SUFFIX = /^(win[A-Za-z0-9]+)_\d+_\d+$/;

function findActiveFrameByFormId(container: any, formId: string): any {
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

// A Nexacro-rendered DOM element's id is the component's full dotted
// object-model path (mainframe.WorkFrame.form...TextField00), sometimes
// with a trailing DOM-only rendering suffix ("box:simpleinput") that isn't a
// public property. Walking the path from window.nexacro.getApplication() and
// stopping at the last segment that actually resolves lands on the real
// component — verified against a live Nexacro N app (demo.tobesoft.com).
// (window.nexacro.getActiveFrame(), used here previously, does not exist on
// real Nexacro N — it silently made this whole bridge a no-op.)
function resolveComponent(id: string): NexacroComponent | null {
  const nexacro = (window as any).nexacro;
  const app = nexacro?.getApplication?.();
  if (!app) return null;

  const parts = id.replace(/:[^:.]*$/, '').split('.');
  let obj: any = app;
  for (let i = 0; i < parts.length; i++) {
    let next = obj?.[parts[i]];
    if (next === undefined) {
      // A miss on a dynamic work-window segment is recoverable (see
      // DYNAMIC_FRAME_SUFFIX above) — try that before giving up on it.
      const dynamicMatch = DYNAMIC_FRAME_SUFFIX.exec(parts[i]);
      if (dynamicMatch) next = findActiveFrameByFormId(obj, dynamicMatch[1]);

      if (next == null) {
        // Only the very last segment is allowed to miss for any other
        // reason — that's the expected DOM-rendering sub-part with no
        // public property (e.g. "box" in TextField00.box). A miss on any
        // earlier segment means the component tree isn't fully built yet
        // (real, right after a fresh navigation — observed on
        // demo.tobesoft.com: the walk lands on a still-attaching parent Form
        // instead of the target TextField for about a second). Returning
        // null here (instead of that shallower parent) is what lets the
        // retry loop above keep polling instead of "succeeding" against the
        // wrong object.
        return i === parts.length - 1 ? obj : null;
      }
    }
    obj = next;
  }
  return obj;
}

// Every rendered node under a Nexacro form gets a dotted id — wrapper divs
// (Form, ChildFrame, Panel) and internal rendering sub-parts (ButtonControl,
// EditControl, GridBandInfo, ...) included, confirmed by walking a live
// Nexacro N app end to end. Marking all of those would hand clicks on plain
// layout containers to the bridge instead of the component a user actually
// meant to interact with. This allowlist is the set of top-level interactive
// control types the reference docs describe (Button/Edit/Combo/CheckBox/
// Radio/DateField/Grid) plus the real type names observed live (TextField,
// MultiCombo) — the internal "*Control" and container types are excluded.
const INTERACTIVE_TYPES = new Set([
  'Button',
  'TextField',
  'Edit',
  'Combo',
  'MultiCombo',
  'CheckBox',
  'CheckBoxSet',
  'Radio',
  'RadioSet',
  'DateField',
  'Grid',
]);

function syncComponents(): void {
  if (!(window as any).nexacro?.getApplication) return;

  // Nexacro elements are the only ones on the page whose id is a real
  // multi-segment dotted path — scanning the (already-rendered) DOM for that
  // shape is far cheaper than recursively walking the component tree, and
  // finds exactly the same set.
  const candidates = Array.from(document.querySelectorAll('[id*="."]'));
  for (const el of candidates) {
    const id = el.id;
    if (el.getAttribute(MARK_ATTR) === id) continue;

    const comp = resolveComponent(id);
    if (!comp?._type_name || !INTERACTIVE_TYPES.has(comp._type_name)) continue;

    el.setAttribute(MARK_ATTR, id);
    el.setAttribute(TYPE_ATTR, comp._type_name);
  }
}

let markingTimer: number | null = null;

function setMarking(enabled: boolean): void {
  if (enabled && markingTimer === null) {
    syncComponents();
    // Nexacro keeps adding/removing components (popups, grid rows) with no
    // public hook to observe — a short poll is simpler and more reliable
    // here than trying to catch every internal render path.
    markingTimer = window.setInterval(syncComponents, 500);
  } else if (!enabled && markingTimer !== null) {
    window.clearInterval(markingTimer);
    markingTimer = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Replay's leading `navigate` step reloads the page, and a Nexacro app can
// take several seconds after that before getApplication()'s component tree
// is fully populated (observed ~8s on a real, heavy Nexacro N app) — an
// action run right after navigation can easily land before that, so this
// gives the app real time to finish booting instead of failing on the very
// first lookup.
const RESOLVE_TIMEOUT_MS = 15000;

// Nexacro shows its own loading affordance (a busy cursor, or a
// "waitwindow"-id overlay) while a click's server round-trip is in flight —
// the DOM/network signals Playwright/the extension would otherwise watch
// settle immediately, well before the app is actually done. A .nexamodaloverlay
// (an open modal window) is deliberately NOT treated as loading here — it
// never clears on its own and waiting on it would just hang.
function isIdleNow(): boolean {
  const bodyCursor = getComputedStyle(document.body).cursor;
  const htmlCursor = getComputedStyle(document.documentElement).cursor;
  if (bodyCursor === 'wait' || bodyCursor === 'progress' || htmlCursor === 'wait' || htmlCursor === 'progress') {
    return false;
  }
  const nodes = document.querySelectorAll('[id*="waitwindow"]');
  for (const el of Array.from(nodes)) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    return false;
  }
  return true;
}

// Bounded and best-effort: most clicks don't trigger server work, so this
// returns immediately (isIdleNow() is already true). A timeout here is a
// warning, not a failure — the next lookup or the workflow's own wait step
// catches anything actually still loading.
const IDLE_WAIT_MS = 8000;

async function waitIdle(): Promise<void> {
  const deadline = Date.now() + IDLE_WAIT_MS;
  while (Date.now() < deadline) {
    if (isIdleNow()) return;
    await sleep(150);
  }
}

interface GridExtractResult {
  rows: Record<string, unknown>[];
}

// Never read a Nexacro Grid off the DOM: it virtualizes both rows and
// columns outside the rendered viewport (a far-right or far-down cell can
// have no DOM node at all while its data still exists), and a combo-mapped
// column's DOM text is the underlying code, not the label the grid paints.
// The bound dataset (rowcount/colcount/getColumn) holds every row
// regardless of scroll; getCellText(row, cell) is what the grid actually
// paints (combo labels, number formatting applied).
//
// Header names come from the Format metadata's own 'col'/'colspan' on each
// head/body cell, not from matching head and body cells at the same
// rendered position — a merged group header or a hidden captioned column
// makes the head band's index space diverge from the body band's, so
// position-matching silently reads the wrong column for some cells.
function extractGridData(grid: any): GridExtractResult | { error: string } {
  const dataset = typeof grid?.getBindDataset === 'function' ? grid.getBindDataset() : null;
  if (!dataset) return { error: 'Nexacro grid has no bound dataset' };

  const columns: string[] = [];
  for (let c = 0; c < dataset.colcount; c++) columns.push(dataset.getColID(c));
  const rawRows: Record<string, unknown>[] = [];
  for (let r = 0; r < dataset.rowcount; r++) {
    const row: Record<string, unknown> = {};
    for (const col of columns) row[col] = dataset.getColumn(r, col);
    rawRows.push(row);
  }

  let mappedRows: Record<string, unknown>[] = [];
  try {
    if (typeof grid.getCellCount === 'function' && typeof grid.getCellProperty === 'function') {
      const headCount = grid.getCellCount('head');
      const heads: { text: string; col: number; row: number; colspan: number }[] = [];
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

      // bodyCellIndex -> resolved header text. Index 0 is the grid's own
      // checkbox/state column, excluded like every other rendering-only cell.
      const bodyCount = grid.getCellCount('body');
      const bodyColumns: { cellIndex: number; header: string }[] = [];
      for (let bi = 1; bi < bodyCount; bi++) {
        const bodyCol = Number(grid.getCellProperty('body', bi, 'col'));
        if (Number.isNaN(bodyCol)) continue;
        const matched = heads.filter((h) => bodyCol >= h.col && bodyCol < h.col + h.colspan);
        // Deepest header row first, narrowest span second — a specific
        // sub-header wins over the wide group header it sits under.
        matched.sort((x, y) => y.row - x.row || x.colspan - y.colspan);
        if (matched[0]) bodyColumns.push({ cellIndex: bi, header: matched[0].text });
      }

      if (bodyColumns.length > 0) {
        for (let mr = 0; mr < dataset.rowcount; mr++) {
          const mapped: Record<string, unknown> = {};
          for (const { cellIndex, header } of bodyColumns) {
            const cellText = grid.getCellText(mr, cellIndex);
            mapped[header] = cellText === undefined ? null : cellText;
          }
          mappedRows.push(mapped);
        }
      }
    }
  } catch {
    mappedRows = [];
  }

  // Prefer what the screen actually shows; only the raw code/id data is
  // available when the grid exposes no head captions to map with.
  return { rows: mappedRows.length > 0 ? mappedRows : rawRows };
}

const GRID_DATA_WAIT_MS = 8000;

async function runComponentAction(
  componentId: string,
  action: string,
  value?: string,
): Promise<{ ok: boolean; error?: string; value?: string; grid?: GridExtractResult }> {
  const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
  let comp = resolveComponent(componentId);
  while (!comp && Date.now() < deadline) {
    await sleep(200);
    comp = resolveComponent(componentId);
  }
  if (!comp) return { ok: false, error: `Nexacro component not found: ${componentId}` };

  try {
    switch (action) {
      case 'click':
        comp.click?.();
        // A real component's onclick is a Nexacro EventHandler object, not a
        // plain function — comp.onclick?.() would still attempt the call
        // (optional chaining only guards null/undefined) and throw. click()
        // alone already runs the component's own click handling.
        if (typeof comp.onclick === 'function') comp.onclick();
        await waitIdle();
        return { ok: true };
      case 'set_value':
        comp.set_value?.(value ?? '');
        comp.setFocus?.();
        if (typeof comp.onchange === 'function') comp.onchange();
        return { ok: true };
      case 'get_value':
        return { ok: true, value: String(comp.value ?? comp.get_value?.() ?? '') };
      case 'extract_grid': {
        const first = extractGridData(comp);
        if ('error' in first) return { ok: false, error: first.error };
        // Grid data can arrive slightly after the component itself resolves
        // — the loading overlay clears before the dataset actually binds —
        // so poll for a first row rather than reporting a false empty result
        // from a search that's still running. rows: [] after this wait is a
        // real empty result.
        let result = first;
        const gridDeadline = Date.now() + GRID_DATA_WAIT_MS;
        while (result.rows.length === 0 && Date.now() < gridDeadline) {
          await sleep(250);
          const retry = extractGridData(comp);
          if ('error' in retry) break;
          result = retry;
        }
        return { ok: true, grid: result };
      }
      default:
        return { ok: false, error: `Unknown nexacro action: ${action}` };
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

document.addEventListener(MARKING_EVENT, ((event: CustomEvent) => {
  setMarking(!!event.detail?.enabled);
}) as EventListener);

document.addEventListener(REQUEST_EVENT, ((event: CustomEvent) => {
  const { requestId, componentId, action, value } = event.detail;
  runComponentAction(componentId, action, value).then((result) => {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: { requestId, ...result } }));
  });
}) as EventListener);
