import ExcelJS from 'exceljs';
import type { FileWriteExcelAction } from '@browser-agent/shared';
import type { RunContext } from '../types';

export async function fileWriteExcel(
  _page: unknown,
  action: FileWriteExcelAction,
  context: RunContext,
): Promise<void> {
  const rows = context.variables[action.data];
  if (!Array.isArray(rows)) throw new Error(`Variable "${action.data}" is not an array of rows`);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(action.sheet ?? 'Sheet1');

  if (rows.length > 0 && action.headerRow !== false) {
    sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key }));
    sheet.addRows(rows);
  } else {
    sheet.addRows(rows.map((row) => (Array.isArray(row) ? row : Object.values(row as object))));
  }

  await workbook.xlsx.writeFile(action.filePath);
}
