import ExcelJS from 'exceljs';
import type { FileReadExcelAction } from '@browser-agent/shared';

export async function fileReadExcel(
  _page: unknown,
  action: FileReadExcelAction,
): Promise<Record<string, unknown>[] | unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(action.filePath);

  const sheet =
    typeof action.sheet === 'number'
      ? workbook.worksheets[action.sheet - 1]
      : action.sheet
        ? workbook.getWorksheet(action.sheet)
        : workbook.worksheets[0];
  if (!sheet) throw new Error(`Sheet not found: ${action.sheet ?? '(first sheet)'} in ${action.filePath}`);

  const rows: unknown[][] = [];
  sheet.eachRow((row) => {
    const cells: unknown[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) cells.push(row.getCell(c).value);
    rows.push(cells);
  });

  if (action.headerRow === false) return rows;

  const [headers, ...dataRows] = rows;
  return dataRows.map((row) => Object.fromEntries(headers.map((h, i) => [String(h ?? `col${i + 1}`), row[i]])));
}
