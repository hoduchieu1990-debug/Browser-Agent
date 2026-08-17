/**
 * Reads tabular data out of an element, whether the page used a real <table>,
 * ARIA roles, or plain divs laid out as a grid.
 *
 * Both engines run this: the extension calls it directly on a DOM node, and the
 * player hands it to Playwright's `locator.evaluate`, which serialises the
 * function into the page. That serialisation is why every helper lives inside
 * the function bodies — a reference to anything module-scoped would be
 * undefined once the source lands in the browser.
 */

export interface TableShape {
  headers: string[];
  rows: string[][];
}

// Plenty of pages still nest their whole layout in a <table>. Structurally
// that is a table, but capturing it hands back the entire page — stylesheets
// and all — rather than data, so it must not be offered as one.
const LAYOUT_CELL_TEXT_LIMIT = 300;

function isLayoutScaffolding(el: Element): boolean {
  const role = el.getAttribute('role');
  if (role === 'presentation' || role === 'none') return true;

  // Column headings are the clearest sign the author meant it as data.
  if (el.querySelector('th, [role="columnheader"]')) return false;

  const cells = Array.from(el.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
  return cells.some((cell) => (cell.textContent ?? '').trim().length > LAYOUT_CELL_TEXT_LIMIT);
}

/** Detection only: does this element present itself as tabular data? */
export function isTableLike(el: Element): boolean {
  if (el.tagName === 'TABLE') return !isLayoutScaffolding(el);

  // A <tbody> also looks like "repeated rows of equal shape", but stopping
  // there would leave the <thead> — and therefore the column names — outside
  // the captured element.
  if (['TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'COLGROUP'].includes(el.tagName)) return false;

  const role = el.getAttribute('role');
  if (role === 'table' || role === 'grid' || role === 'treegrid') return !isLayoutScaffolding(el);

  // A div grid gives itself away by repetition: several sibling "rows" of the
  // same shape, each holding the same number of children.
  const children = Array.from(el.children);
  if (children.length < 2 || children.length > 500) return false;

  const rowsOf = (candidates: Element[]) => {
    const cellCounts = candidates.map((c) => c.children.length);
    const tag = candidates[0].tagName;
    const uniform = candidates.every((c) => c.tagName === tag) && new Set(cellCounts).size === 1;
    return uniform && cellCounts[0] >= 2;
  };

  if (rowsOf(children)) return true;

  // …often wrapped one level down, e.g. a header row plus a body container
  const body = children.find((c) => c.children.length >= 2);
  return body ? rowsOf(Array.from(body.children)) : false;
}

export function readTable(el: Element): TableShape {
  const ROW_SELECTOR = 'tr, [role="row"]';
  const CELL_SELECTOR = 'td, th, [role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]';
  const HEADER_SELECTOR = 'th, [role="columnheader"]';

  // textContent would include anything a <style> or <script> inside the cell
  // happens to hold, and pages do put those mid-content — the stylesheet then
  // shows up as the cell's "value". Walk the text nodes and skip those.
  const text = (node: Element) => {
    const parts: string[] = [];
    const collect = (n: Node) => {
      if (n.nodeType === 3) {
        parts.push(n.nodeValue ?? '');
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = (n as Element).tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return;
      n.childNodes.forEach(collect);
    };
    collect(node);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };

  const isHeaderCell = (cell: Element) => cell.tagName === 'TH' || cell.getAttribute('role') === 'columnheader';

  // --- explicit structures first: <table> or ARIA roles ---
  let rowElements = Array.from(el.querySelectorAll(ROW_SELECTOR));
  let cellsOf = (row: Element) => Array.from(row.querySelectorAll(CELL_SELECTOR));

  // --- otherwise infer rows from repeated children ---
  if (rowElements.length === 0) {
    const children = Array.from(el.children);
    const uniform = (candidates: Element[]) =>
      candidates.length >= 2 &&
      new Set(candidates.map((c) => c.children.length)).size === 1 &&
      candidates[0].children.length >= 2;

    if (uniform(children)) {
      rowElements = children;
    } else {
      const body = children.find((c) => uniform(Array.from(c.children)));
      if (body) rowElements = Array.from(body.children);
    }

    cellsOf = (row: Element) => Array.from(row.children);
  }

  const grid = rowElements.map((row) => cellsOf(row)).filter((cells) => cells.length > 0);
  if (grid.length === 0) return { headers: [], rows: [] };

  // A first row made entirely of header cells is a header, not data. Failing
  // that, a div grid's first row is treated as a header only when the rest of
  // the rows exist to compare it against.
  // A grid built from plain divs has no <th> to go by, so fall back to how the
  // page draws it: a header row is the one rendered bold above ordinary rows.
  const looksLikeHeaderRow = (cells: Element[], next: Element[] | undefined) => {
    if (!next || cells.length === 0) return false;
    const weight = (cell: Element) => {
      const value = getComputedStyle(cell).fontWeight;
      return value === 'bold' || value === 'bolder' ? 700 : Number(value) || 400;
    };
    return cells.every((c) => weight(c) >= 600) && next.every((c) => weight(c) < 600);
  };

  const first = grid[0];
  const firstIsHeader =
    first.every(isHeaderCell) ||
    (grid.length > 1 && first.every((c) => c.tagName === 'TH')) ||
    looksLikeHeaderRow(first, grid[1]);

  const headerCells = firstIsHeader ? first : Array.from(el.querySelectorAll(HEADER_SELECTOR)).slice(0, first.length);
  const headers = headerCells.map((cell, i) => text(cell) || `column${i + 1}`);

  const dataRows = firstIsHeader ? grid.slice(1) : grid;
  const rows = dataRows.map((cells) => cells.map(text));

  return { headers, rows };
}

/** Column names only — the recorder stores these alongside the step. */
export function readTableHeaders(el: Element): string[] {
  return readTable(el).headers;
}

/** The shape both exporters and the results view expect. */
export function readTableRecords(el: Element, headers?: string[]): Record<string, string>[] {
  const shape = readTable(el);
  const columns = headers?.length ? headers : shape.headers;

  return shape.rows.map((cells) => {
    const record: Record<string, string> = {};
    cells.forEach((value, i) => {
      record[columns[i] ?? `column${i + 1}`] = value;
    });
    return record;
  });
}
