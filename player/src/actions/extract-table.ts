import type { Page } from 'playwright';
import type { ExtractTableAction } from '@browser-agent/shared';

export async function extractTable(
  page: Page,
  action: ExtractTableAction,
): Promise<Record<string, string>[]> {
  return page.$$eval(
    `${action.selector} tr`,
    (rows, headers) => {
      const data: Record<string, string>[] = [];
      for (const row of rows as HTMLTableRowElement[]) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length === 0) continue;
        const record: Record<string, string> = {};
        cells.forEach((cell, i) => {
          const key = (headers as string[])[i] ?? `column${i + 1}`;
          record[key] = cell.textContent?.trim() ?? '';
        });
        data.push(record);
      }
      return data;
    },
    action.headers ?? [],
  );
}
