import ExcelJS from 'exceljs';

export async function exportExcel(rows: any[], filePath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Results');
  if (rows.length > 0) {
    sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key }));
    sheet.addRows(rows);
  }
  await workbook.xlsx.writeFile(filePath);
}
