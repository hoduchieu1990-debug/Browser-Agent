import * as fs from 'fs';

export function exportJson(data: any, filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
