import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';

export type DataRow = Record<string, string>;

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    // exceljs wraps formulas and rich text in objects
    const cell = value as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (cell.richText) return cell.richText.map((part) => part.text).join('');
    if (cell.text != null) return String(cell.text);
    if (cell.result != null) return String(cell.result);
    return '';
  }
  return String(value);
}

async function loadExcel(filePath: string): Promise<DataRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`No sheets found in ${filePath}`);

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

  return rows;
}

function loadCsv(filePath: string): DataRow[] {
  const parsed = Papa.parse<DataRow>(fs.readFileSync(filePath, 'utf-8'), {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length) {
    throw new Error(`Could not read ${path.basename(filePath)}: ${parsed.errors[0].message}`);
  }

  return parsed.data.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), String(value ?? '').trim()])),
  );
}

// One row per run: the column headers become the workflow's ${params}.
export async function loadDataRows(filePath: string): Promise<DataRow[]> {
  if (!fs.existsSync(filePath)) throw new Error(`Data file not found: ${filePath}`);

  const extension = path.extname(filePath).toLowerCase();
  const rows = extension === '.xlsx' || extension === '.xlsm' ? await loadExcel(filePath) : loadCsv(filePath);

  if (rows.length === 0) throw new Error(`${path.basename(filePath)} has no data rows`);
  return rows;
}
