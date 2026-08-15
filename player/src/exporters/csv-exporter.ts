import Papa from 'papaparse';
import * as fs from 'fs';

export function exportCsv(rows: any[], filePath: string): void {
  fs.writeFileSync(filePath, Papa.unparse(rows));
}
