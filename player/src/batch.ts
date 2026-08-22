import * as path from 'path';
import type { Workflow, ExportFormat } from '@browser-agent/shared';
import type { WorkflowPlayer } from './workflow-player';
import type { ExecutionOptions } from './types';
import type { DataRow } from './data/data-loader';
import { runExporters } from './exporters';

export interface BatchRowResult {
  index: number;
  params: DataRow;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface BatchResult {
  rows: BatchRowResult[];
  succeeded: number;
  failed: number;
  data: Record<string, unknown[]>;
  files: Record<string, string>;
  durationMs: number;
}

export interface BatchOptions extends ExecutionOptions {
  stopOnError?: boolean;
  onRowStart?: (index: number, total: number, params: DataRow) => void;
  onRowEnd?: (result: BatchRowResult) => void;
}

// A workflow exported from the recorder has no exportFormats, but a batch run
// still has to leave the collected data somewhere.
function defaultExportFormats(data: Record<string, unknown[]>): ExportFormat[] {
  return Object.keys(data).map((key) => ({ type: 'csv', output: `${key}.csv`, dataKey: key }));
}

// Every row's outputs are tagged with the inputs that produced them, otherwise
// 500 result rows are indistinguishable once they are concatenated.
function accumulate(bucket: Record<string, unknown[]>, variables: Record<string, unknown>, params: DataRow): void {
  for (const [key, value] of Object.entries(variables)) {
    const target = (bucket[key] ??= []);
    if (Array.isArray(value)) {
      target.push(...value.map((row) => ({ ...params, ...(row as object) })));
    } else {
      target.push({ ...params, [key]: value });
    }
  }
}

export async function runBatch(
  player: WorkflowPlayer,
  workflow: Workflow,
  rows: DataRow[],
  options: BatchOptions = {},
): Promise<BatchResult> {
  const startedAt = Date.now();
  const outputDir = options.outputDir ?? '.';
  const data: Record<string, unknown[]> = {};
  const results: BatchRowResult[] = [];

  // Export once at the end over the combined data instead of once per row,
  // which would just overwrite the same filenames on every iteration.
  const perRow: Workflow = { ...workflow, exportFormats: [] };

  for (const [index, params] of rows.entries()) {
    options.onRowStart?.(index + 1, rows.length, params);
    const rowStart = Date.now();

    const result = await player.run(perRow, params, { ...options, outputDir });
    if (result.success) accumulate(data, result.data, params);

    const rowResult: BatchRowResult = {
      index: index + 1,
      params,
      success: result.success,
      error: result.error?.message,
      durationMs: Date.now() - rowStart,
    };
    results.push(rowResult);
    options.onRowEnd?.(rowResult);

    if (!result.success && options.stopOnError) break;
  }

  const formats = workflow.exportFormats?.length ? workflow.exportFormats : defaultExportFormats(data);
  const files = await runExporters(formats, data, outputDir);

  return {
    rows: results,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    data,
    files: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, path.resolve(file)])),
    durationMs: Date.now() - startedAt,
  };
}
