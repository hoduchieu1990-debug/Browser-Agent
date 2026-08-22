import type { Page } from 'playwright';
import type { ExtractTableAction } from '@browser-agent/shared';
import { readTable } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';

export async function extractTable(
  page: Page,
  action: ExtractTableAction,
): Promise<Record<string, string>[]> {
  const el = await resolve(page, action.selector, action.selectorFallbacks);

  // readTable is self-contained precisely so Playwright can serialise it into
  // the page; the column mapping needs no DOM, so it happens back here.
  const shape = await el.evaluate(readTable);
  const columns = action.headers?.length ? action.headers : shape.headers;

  return shape.rows.map((cells) => {
    const record: Record<string, string> = {};
    cells.forEach((value, i) => {
      record[columns[i] ?? `column${i + 1}`] = value;
    });
    return record;
  });
}
