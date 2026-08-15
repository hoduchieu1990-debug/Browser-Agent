import * as path from 'path';
import type { ExportFormat } from '@browser-agent/shared';
import { exportExcel } from './excel-exporter';
import { exportCsv } from './csv-exporter';
import { exportJson } from './json-exporter';

export async function runExporters(
  formats: ExportFormat[],
  variables: Record<string, any>,
  outputDir: string,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  for (const format of formats) {
    const data = variables[format.dataKey];
    if (data === undefined) continue;
    const filePath = path.join(outputDir, format.output);

    if (format.type === 'excel') await exportExcel(data, filePath);
    else if (format.type === 'csv') exportCsv(data, filePath);
    else exportJson(data, filePath);

    files[format.dataKey] = filePath;
  }

  return files;
}
