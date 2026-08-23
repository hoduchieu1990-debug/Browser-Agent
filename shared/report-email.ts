import type { ScheduleConfig } from './schedule-types';

// No Node `path` import here on purpose — this file is also bundled into
// the browser extension (via shared/index.ts's `export *`), which has no
// Node polyfills.
function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

// A structural subset of player's BatchResult — shared/ can't import from
// player (player already depends on shared, so the reverse would be
// circular), and this is all buildReportEmail actually reads. A real
// BatchResult satisfies this too, since it only adds fields on top.
export interface ReportBatchRow {
  index: number;
  success: boolean;
  error?: string;
}

export interface ReportBatchResult {
  rows: ReportBatchRow[];
  data: Record<string, unknown[]>;
  files: Record<string, string>;
}

export interface MailMessage {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; path: string }[];
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Shared by the CLI daemon (real sends, cli/src/schedule/runner.ts) and the
// extension's Report window Review tab (a placeholder ReportBatchResult) —
// one function means the preview is exactly what actually gets sent, given
// the same inputs.
//
// batch.data[key] only ever gets an entry pushed for a SUCCESSFUL run (see
// accumulate() in player/src/batch.ts), in row order — walking batch.rows
// while only advancing a separate success counter is what keeps a value
// lined up with the run that actually produced it once some runs fail.
export function buildReportEmail(config: ScheduleConfig, batch: ReportBatchResult): MailMessage {
  const dateLabel = new Date().toLocaleString();
  const subject = config.email.subject || `[Browser Agent] ${config.name} — ${dateLabel}`;

  let successIndex = 0;
  const rowsText: string[] = [];
  const rowsHtml: string[] = [];

  for (const row of batch.rows) {
    if (row.success) {
      const values = config.resultKeys.map((key) => {
        const entry = batch.data[key]?.[successIndex] as Record<string, unknown> | undefined;
        return formatValue(entry?.[key]);
      });
      successIndex++;

      rowsText.push(`Run ${row.index}: ${config.resultKeys.map((key, i) => `${key}=${values[i]}`).join(', ')}`);
      rowsHtml.push(`<tr><td>${row.index}</td>${values.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`);
    } else {
      const error = row.error ?? 'unknown error';
      rowsText.push(`Run ${row.index}: FAILED — ${error}`);
      rowsHtml.push(
        `<tr><td>${row.index}</td><td colspan="${config.resultKeys.length}" style="color:#b00020">FAILED — ${escapeHtml(error)}</td></tr>`,
      );
    }
  }

  const stoppedEarly = batch.rows.length < config.repeatCount;
  const noteText = stoppedEarly
    ? `\n\n(Stopped early after a failed run — ${batch.rows.length}/${config.repeatCount} repeats ran.)`
    : '';
  const noteHtml = stoppedEarly
    ? `<p style="color:#b00020">Stopped early after a failed run — ${batch.rows.length}/${config.repeatCount} repeats ran.</p>`
    : '';

  const introText = config.content ? `${config.content}\n\n` : '';
  const introHtml = config.content
    ? `<p>${escapeHtml(config.content).replace(/\n/g, '<br>')}</p>`
    : '';

  const text = `${introText}Browser Agent scheduled report: ${config.name}\n\n${rowsText.join('\n')}${noteText}`;
  const html = `
    ${introHtml}
    <h2>${escapeHtml(config.name)}</h2>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
      <thead><tr><th>Run</th>${config.resultKeys.map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml.join('')}</tbody>
    </table>
    ${noteHtml}
  `.trim();

  const attachments = config.attachment
    ? config.resultKeys
        .filter((key) => batch.files[key])
        .map((key) => ({ filename: basename(batch.files[key]), path: batch.files[key] }))
    : undefined;

  return { to: config.email.to, from: config.email.from, subject, text, html, attachments };
}
