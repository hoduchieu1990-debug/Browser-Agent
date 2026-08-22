import type { ScheduleConfig } from '@browser-agent/shared';
import type { BatchResult } from '@browser-agent/player';
import type { MailMessage } from './mailer';

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// batch.data[key] only ever gets an entry pushed for a SUCCESSFUL run (see
// accumulate() in player/src/batch.ts), in row order — walking batch.rows
// while only advancing a separate success counter is what keeps a value
// lined up with the run that actually produced it once some runs fail.
export function buildReportEmail(config: ScheduleConfig, batch: BatchResult): MailMessage {
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

  const text = `Browser Agent scheduled report: ${config.name}\n\n${rowsText.join('\n')}${noteText}`;
  const html = `
    <h2>${escapeHtml(config.name)}</h2>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
      <thead><tr><th>Run</th>${config.resultKeys.map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml.join('')}</tbody>
    </table>
    ${noteHtml}
  `.trim();

  return { to: config.email.to, from: config.email.from, subject, text, html };
}
