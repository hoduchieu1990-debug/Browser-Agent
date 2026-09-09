import type { Page } from 'playwright';
import { NEXACRO_SELECTOR_PREFIX } from '@browser-agent/shared';

export function isNexacroSelector(selector: string): boolean {
  return selector.startsWith(NEXACRO_SELECTOR_PREFIX);
}

export function nexacroComponentId(selector: string): string {
  return selector.slice(NEXACRO_SELECTOR_PREFIX.length);
}

// Playwright's page.evaluate() runs in the page's real JS context (unlike the
// extension's content script, which is stuck in an isolated world) — no
// bridge needed here, window.nexacro is reachable directly.
//
// A Nexacro-rendered id is the component's full dotted object-model path
// (mainframe.WorkFrame.form...TextField00), sometimes with a trailing
// DOM-only rendering suffix ("box:simpleinput") that isn't a public
// property — only the very last segment is allowed to miss for that reason.
// A miss on any earlier segment means the component tree isn't fully built
// yet (real, right after a fresh navigation — verified against a live
// Nexacro N app: the walk lands on a still-attaching parent Form instead of
// the target TextField for about a second), so that must resolve to nothing
// rather than the shallower parent, or waitForComponent's poll below would
// treat a half-booted page as "found" and every function here would then act
// on the wrong component. window.nexacro.getActiveFrame(), used here
// previously, does not exist on real Nexacro N.
//
// The one other recoverable miss: a dynamic work window's frame id carries
// an instance suffix assigned the moment it opens ("winFFM0371_0_744") that
// changes the next time the same screen opens, even within the same
// session — a real MES/ERP-style multi-screen Nexacro app, as opposed to the
// single-frame demo above was verified against. Recognise that shape (the
// "win" prefix is Nexacro Studio's own default naming convention for a work
// window's root form, confirmed against a live production Nexacro
// automation tool's own resolver) and ask the containing frameset for
// whichever frame currently serves that same stable prefix ("winFFM0371")
// instead of failing.
//
// Each function below repeats this walk inline (rather than sharing one
// helper) because page.evaluate() serializes only the function it's given —
// it can't close over another module-level function.
function resolveInPage(id: string): unknown {
  const app = (window as any).nexacro?.getApplication?.();
  if (!app) return null;
  const parts = id.replace(/:[^:.]*$/, '').split('.');
  let obj: any = app;
  for (let i = 0; i < parts.length; i++) {
    let next = obj?.[parts[i]];
    if (next === undefined) {
      const dynamicMatch = /^(win[A-Za-z0-9]+)_\d+_\d+$/.exec(parts[i]);
      if (dynamicMatch) {
        const formId = dynamicMatch[1];
        const active = typeof obj?.getActiveFrame === 'function' ? obj.getActiveFrame() : null;
        if (active?.id && String(active.id).indexOf(formId) === 0) next = active;
        else if (obj?.all && typeof obj.all.length === 'number') {
          for (let j = 0; j < obj.all.length; j++) {
            const frame = obj.all[j];
            if (frame?.id && String(frame.id).indexOf(formId) === 0) {
              next = frame;
              break;
            }
          }
        }
      }
      if (next == null) return i === parts.length - 1 ? obj : null;
    }
    obj = next;
  }
  return obj;
}

// A Nexacro app can take several seconds after page load before
// getApplication()'s component tree is fully populated (observed ~8s on a
// real, heavy Nexacro N app) — long enough that the previous 10s default cut
// it close.
const IDLE_WAIT_MS = 8000;

async function waitForComponent(page: Page, componentId: string, timeout = 15000): Promise<void> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const found = await page.evaluate(resolveInPage, componentId);
    if (found) return;
    await page.waitForTimeout(100);
  }

  throw new Error(`Nexacro component not found: ${componentId}`);
}

export async function nexacroClick(page: Page, componentId: string): Promise<void> {
  await waitForComponent(page, componentId);
  await page.evaluate(({ id }) => {
    const app = (window as any).nexacro?.getApplication?.();
    const parts = id.replace(/:[^:.]*$/, '').split('.');
    let obj: any = app;
    let comp: any = null;
    for (let i = 0; i < parts.length; i++) {
      let next = obj?.[parts[i]];
      if (next === undefined) {
        const dynamicMatch = /^(win[A-Za-z0-9]+)_\d+_\d+$/.exec(parts[i]);
        if (dynamicMatch) {
          const formId = dynamicMatch[1];
          const active = typeof obj?.getActiveFrame === 'function' ? obj.getActiveFrame() : null;
          if (active?.id && String(active.id).indexOf(formId) === 0) next = active;
          else if (obj?.all && typeof obj.all.length === 'number') {
            for (let j = 0; j < obj.all.length; j++) {
              const frame = obj.all[j];
              if (frame?.id && String(frame.id).indexOf(formId) === 0) {
                next = frame;
                break;
              }
            }
          }
        }
        if (next == null) {
          comp = i === parts.length - 1 ? obj : null;
          break;
        }
      }
      obj = next;
      comp = obj;
    }
    if (!comp) return;
    comp.click?.();
    // A real component's onclick is a Nexacro EventHandler object, not a
    // plain function — calling it unconditionally throws. click() alone
    // already runs the component's own click handling.
    if (typeof comp.onclick === 'function') comp.onclick();
  }, { id: componentId });

  // Nexacro shows its own loading affordance (busy cursor, or a
  // "waitwindow"-id overlay) while a click's server round-trip is in
  // flight — Playwright's own load-state signals settle immediately, well
  // before the app is actually done. Bounded and best-effort: most clicks
  // don't trigger server work, so this returns right away; a timeout here
  // is a warning; the next step's own resolve/wait catches anything real.
  await page
    .waitForFunction(
      () => {
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
      },
      null,
      { timeout: IDLE_WAIT_MS },
    )
    .catch(() => {});
}

export async function nexacroSetValue(page: Page, componentId: string, value: string): Promise<void> {
  await waitForComponent(page, componentId);
  await page.evaluate(
    ({ id, value }) => {
      const app = (window as any).nexacro?.getApplication?.();
      const parts = id.replace(/:[^:.]*$/, '').split('.');
      let obj: any = app;
      let comp: any = null;
      for (let i = 0; i < parts.length; i++) {
        let next = obj?.[parts[i]];
        if (next === undefined) {
          const dynamicMatch = /^(win[A-Za-z0-9]+)_\d+_\d+$/.exec(parts[i]);
          if (dynamicMatch) {
            const formId = dynamicMatch[1];
            const active = typeof obj?.getActiveFrame === 'function' ? obj.getActiveFrame() : null;
            if (active?.id && String(active.id).indexOf(formId) === 0) next = active;
            else if (obj?.all && typeof obj.all.length === 'number') {
              for (let j = 0; j < obj.all.length; j++) {
                const frame = obj.all[j];
                if (frame?.id && String(frame.id).indexOf(formId) === 0) {
                  next = frame;
                  break;
                }
              }
            }
          }
          if (next == null) {
            comp = i === parts.length - 1 ? obj : null;
            break;
          }
        }
        obj = next;
        comp = obj;
      }
      if (!comp) return;
      comp.set_value?.(value);
      comp.setFocus?.();
      if (typeof comp.onchange === 'function') comp.onchange();
    },
    { id: componentId, value },
  );
}

export async function nexacroGetValue(page: Page, componentId: string): Promise<string> {
  await waitForComponent(page, componentId);
  return page.evaluate((id) => {
    const app = (window as any).nexacro?.getApplication?.();
    const parts = id.replace(/:[^:.]*$/, '').split('.');
    let obj: any = app;
    let comp: any = null;
    for (let i = 0; i < parts.length; i++) {
      let next = obj?.[parts[i]];
      if (next === undefined) {
        const dynamicMatch = /^(win[A-Za-z0-9]+)_\d+_\d+$/.exec(parts[i]);
        if (dynamicMatch) {
          const formId = dynamicMatch[1];
          const active = typeof obj?.getActiveFrame === 'function' ? obj.getActiveFrame() : null;
          if (active?.id && String(active.id).indexOf(formId) === 0) next = active;
          else if (obj?.all && typeof obj.all.length === 'number') {
            for (let j = 0; j < obj.all.length; j++) {
              const frame = obj.all[j];
              if (frame?.id && String(frame.id).indexOf(formId) === 0) {
                next = frame;
                break;
              }
            }
          }
        }
        if (next == null) {
          comp = i === parts.length - 1 ? obj : null;
          break;
        }
      }
      obj = next;
      comp = obj;
    }
    return String(comp?.value ?? comp?.get_value?.() ?? '');
  }, componentId);
}

interface NexacroGridExtractResult {
  error?: string;
  rows: Record<string, unknown>[];
}

// Never read a Nexacro Grid off the DOM: it virtualizes both rows and
// columns outside the rendered viewport (a far cell can have no DOM node at
// all while its data still exists), and a combo-mapped column's DOM text is
// the underlying code, not the label the grid paints. The bound dataset
// (rowcount/colcount/getColumn) holds every row regardless of scroll;
// getCellText(row, cell) is what the grid actually paints.
//
// Header names come from the Format metadata's own 'col'/'colspan' on each
// head/body cell, not from matching head and body cells at the same
// rendered position — a merged group header or a hidden captioned column
// makes the head band's index space diverge from the body band's, so
// position-matching silently reads the wrong column for some cells.
async function extractGridInPage(page: Page, componentId: string): Promise<NexacroGridExtractResult> {
  return page.evaluate((id) => {
    const app = (window as any).nexacro?.getApplication?.();
    const parts = id.replace(/:[^:.]*$/, '').split('.');
    let obj: any = app;
    let grid: any = null;
    for (let i = 0; i < parts.length; i++) {
      let next = obj?.[parts[i]];
      if (next === undefined) {
        const dynamicMatch = /^(win[A-Za-z0-9]+)_\d+_\d+$/.exec(parts[i]);
        if (dynamicMatch) {
          const formId = dynamicMatch[1];
          const active = typeof obj?.getActiveFrame === 'function' ? obj.getActiveFrame() : null;
          if (active?.id && String(active.id).indexOf(formId) === 0) next = active;
          else if (obj?.all && typeof obj.all.length === 'number') {
            for (let j = 0; j < obj.all.length; j++) {
              const frame = obj.all[j];
              if (frame?.id && String(frame.id).indexOf(formId) === 0) {
                next = frame;
                break;
              }
            }
          }
        }
        if (next == null) {
          grid = i === parts.length - 1 ? obj : null;
          break;
        }
      }
      obj = next;
      grid = obj;
    }
    if (!grid) return { error: `Nexacro component not found: ${id}`, rows: [] };

    const dataset = typeof grid.getBindDataset === 'function' ? grid.getBindDataset() : null;
    if (!dataset) return { error: 'Nexacro grid has no bound dataset', rows: [] };

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
  }, componentId);
}

const GRID_DATA_WAIT_MS = 8000;

export async function nexacroExtractGrid(page: Page, componentId: string): Promise<Record<string, string>[]> {
  await waitForComponent(page, componentId);

  let result = await extractGridInPage(page, componentId);
  if (result.error) throw new Error(result.error);

  // Grid data can arrive slightly after the component itself resolves — the
  // loading overlay clears before the dataset actually binds — so poll for a
  // first row rather than reporting a false empty result from a search
  // that's still running. rows: [] after this wait is a real empty result.
  const deadline = Date.now() + GRID_DATA_WAIT_MS;
  while (result.rows.length === 0 && Date.now() < deadline) {
    await page.waitForTimeout(250);
    const retry = await extractGridInPage(page, componentId);
    if (retry.error) break;
    result = retry;
  }

  return result.rows.map((row) => {
    const record: Record<string, string> = {};
    for (const key of Object.keys(row)) record[key] = String(row[key] ?? '');
    return record;
  });
}
