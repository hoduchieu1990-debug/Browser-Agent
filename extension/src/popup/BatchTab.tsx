import { useRef, useState } from 'react';
import type { WorkflowAction, BatchDataset, BatchReplayState, BatchRunRow } from '../types';
import { batchNodeLabel } from '../utils/action-display';
import { parseExcelDataset } from '../utils/dataset-parser';

interface Props {
  actions: WorkflowAction[];
  dataset: BatchDataset | null;
  state: BatchReplayState | null;
  onSetDataset: (dataset: BatchDataset) => void;
  onTestRow: () => void;
  onRunAll: (stopOnError: boolean) => void;
  onStop: () => void;
}

function nodePreview(actions: WorkflowAction[], index: number): string {
  const action = actions[index];
  const label = batchNodeLabel(actions, index);
  if (action.type === 'batchInput') return `${label} → ${action.column || '(no column)'}`;
  if (action.type === 'batchExtract') return `${label} → ${action.output}`;
  return label;
}

function resultColumns(dataset: BatchDataset | null, rows: BatchRunRow[]): string[] {
  const outputKeys = new Set<string>();
  rows.forEach((row) => Object.keys(row.output).forEach((key) => outputKeys.add(key)));
  return [...(dataset?.headers ?? []), ...outputKeys];
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildResultsCsv(dataset: BatchDataset | null, rows: BatchRunRow[]): string {
  const columns = resultColumns(dataset, rows);
  const lines = [columns.map(csvCell).join(',')];

  for (const row of rows) {
    const record = { ...row.input, ...row.output };
    lines.push(columns.map((col) => csvCell(record[col] ?? '')).join(','));
  }

  return lines.join('\n');
}

export function BatchTab({ actions, dataset, state, onSetDataset, onTestRow, onRunAll, onStop }: Props) {
  const [attachError, setAttachError] = useState<string | null>(null);
  const [stopOnError, setStopOnError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const batchActions = actions.filter((a) => a.type.startsWith('batch'));
  const rows = state?.rows ?? [];
  const columns = resultColumns(dataset, rows);
  const running = state?.running ?? false;

  const handleFile = async (file: File) => {
    setAttachError(null);
    try {
      const { headers, rows } = await parseExcelDataset(await file.arrayBuffer());
      onSetDataset({ fileName: file.name, headers, rows });
    } catch (error) {
      setAttachError((error as Error).message);
    }
  };

  const handleExport = () => {
    const blob = new Blob([buildResultsCsv(dataset, rows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'batch-results.csv' });
  };

  return (
    <div className="export-form">
      <div className="form-group">
        <label className="form-label">Data</label>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <button className="reset-btn" onClick={() => fileInput.current?.click()}>
          📎 {dataset ? 'Replace dataset' : 'Attach Excel file'}
        </button>
        {dataset && (
          <p className="form-hint">
            {dataset.fileName} — {dataset.headers.length} columns, {dataset.rows.length} rows
          </p>
        )}
        {attachError && <div className="error-banner">⚠️ {attachError}</div>}
      </div>

      <div className="form-group">
        <label className="form-label">Batch Workflow</label>
        <div className="job-list">
          {batchActions.length === 0 ? (
            <p className="form-hint">Record with Add → Batch → Input/Click/Search/Extract to build one.</p>
          ) : (
            actions.map(
              (action, index) =>
                action.type.startsWith('batch') && (
                  <div className="job-item" key={action.id} style={{ cursor: 'default' }}>
                    <span className="job-name">{nodePreview(actions, index)}</span>
                  </div>
                ),
            )
          )}
        </div>
      </div>

      <div className="recording-controls">
        <button
          className="record-btn start"
          disabled={running || !dataset?.rows.length || batchActions.length === 0}
          onClick={onTestRow}
        >
          ▶️ Test Row
        </button>
        <button
          className="record-btn start"
          disabled={running || !dataset?.rows.length || batchActions.length === 0}
          onClick={() => onRunAll(stopOnError)}
        >
          ⏩ Run All
        </button>
        <button className="record-btn stop" disabled={!running} onClick={onStop}>
          ⏹️ Stop
        </button>
      </div>

      <label className="form-hint" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} />
        Stop on first failed row
      </label>

      {state && (
        <div className="form-group">
          <label className="form-label">
            Result Monitor — {rows.filter((r) => r.status !== 'running').length}/{state.total}
            {running ? ' (running…)' : state.error ? ' (stopped)' : ' (done)'}
          </label>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${state.total ? (rows.length / state.total) * 100 : 0}%` }}
            />
          </div>
          {state.error && <div className="error-banner">⚠️ {state.error}</div>}

          {rows.length > 0 && (
            <div className="result-table-wrap">
              <table className="result-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Status</th>
                    {columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.index}>
                      <td>{row.index}</td>
                      <td title={row.error}>{row.status === 'success' ? '✓' : row.status === 'failed' ? '✗' : '●'}</td>
                      {columns.map((col) => (
                        <td key={col}>{row.input[col] ?? row.output[col] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button className="export-btn" disabled={rows.length === 0} onClick={handleExport}>
            📥 Export results
          </button>
        </div>
      )}
    </div>
  );
}
