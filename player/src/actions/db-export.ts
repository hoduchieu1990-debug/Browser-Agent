import type { DbExportAction } from '@browser-agent/shared';
import { runQuery } from '../utils/db-client';
import { exportExcel } from '../exporters/excel-exporter';
import { exportCsv } from '../exporters/csv-exporter';
import { exportJson } from '../exporters/json-exporter';

export async function dbExport(_page: unknown, action: DbExportAction): Promise<string> {
  const rows = await runQuery(action.connection, action.query, action.params);

  if (action.format === 'excel') await exportExcel(rows, action.filePath);
  else if (action.format === 'csv') exportCsv(rows, action.filePath);
  else exportJson(rows, action.filePath);

  return action.filePath;
}
