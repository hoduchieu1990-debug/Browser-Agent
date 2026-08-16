import ExcelJS from 'exceljs';
import type { DataRow } from '../types';

// Mirrors player/src/data/data-loader.ts's cellToString exactly, so a
// dataset attached in the extension and the same file passed via the CLI's
// --data flag produce identical rows.
function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const cell = value as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (cell.richText) return cell.richText.map((part) => part.text).join('');
    if (cell.text != null) return String(cell.text);
    if (cell.result != null) return String(cell.result);
    return '';
  }
  return String(value);
}

export async function parseExcelDataset(buffer: ArrayBuffer): Promise<{ headers: string[]; rows: DataRow[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('No sheets found in this file');

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = cellToString(cell.value).trim();
  });

  const rows: DataRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const record: DataRow = {};
    let hasValue = false;

    headers.forEach((header, colNumber) => {
      if (!header) return;
      const value = cellToString(row.getCell(colNumber).value).trim();
      record[header] = value;
      if (value) hasValue = true;
    });

    if (hasValue) rows.push(record);
  }

  if (rows.length === 0) throw new Error('This file has no data rows');
  return { headers: headers.filter(Boolean), rows };
}
