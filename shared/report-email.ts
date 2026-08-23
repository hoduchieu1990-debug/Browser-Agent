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
// Each configured time-of-day is its own independent trigger, so `batch`
// always has exactly one row (see runner.ts's tick()) — this is "did this
// one run succeed" rendering, not a table of repeats.
export function buildReportEmail(config: ScheduleConfig, batch: ReportBatchResult): MailMessage {
  const dateLabel = new Date().toLocaleString();
  const subject = config.email.subject || `[Browser Agent] ${config.name} — ${dateLabel}`;

  const row = batch.rows[0];
  let bodyText: string;
  let bodyHtml: string;

  if (row?.success) {
    const values = config.resultKeys.map((key) => {
      const entry = batch.data[key]?.[0] as Record<string, unknown> | undefined;
      return [key, formatValue(entry?.[key])] as const;
    });
    bodyText = values.map(([key, value]) => `${key}: ${value}`).join('\n');
    bodyHtml = `
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
        <tbody>${values.map(([key, value]) => `<tr><th align="left">${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</tbody>
      </table>
    `.trim();
  } else {
    const error = row?.error ?? 'unknown error';
    bodyText = `FAILED — ${error}`;
    bodyHtml = `<p style="color:#b00020">FAILED — ${escapeHtml(error)}</p>`;
  }

  const introText = config.content ? `${config.content}\n\n` : '';
  const introHtml = config.content
    ? `<p>${escapeHtml(config.content).replace(/\n/g, '<br>')}</p>`
    : '';

  const text = `${introText}${config.name} — ${dateLabel}\n\n${bodyText}`;
  const html = `
    ${introHtml}
    <h2>${escapeHtml(config.name)}</h2>
    ${bodyHtml}
  `.trim();

  const attachments = config.attachment
    ? config.resultKeys
        .filter((key) => batch.files[key])
        .map((key) => ({ filename: basename(batch.files[key]), path: batch.files[key] }))
    : undefined;

  // Resolved here, once, rather than left for the mailer to fall back on —
  // otherwise the Review tab's preview (which never touches the mailer)
  // would show a blank From whenever only the account, not a separate From
  // address, was set in Settings, while the real send used the account
  // anyway. One resolved value keeps both paths honest.
  const from = config.email.from || config.email.user;

  return { to: config.email.to, from, subject, text, html, attachments };
}
