import { defaultReportBlocks, type ScheduleConfig } from './schedule-types';

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

// The extension's own preview run (ReportComposer.tsx's Review tab) captures
// screenshot steps as data: URLs — the same representation the popup's
// Preview tab already shows. Rendering it as text would dump the whole
// base64 blob into the table instead of an actual picture.
function isImageValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

// Inline styles throughout, not a <style> block — most email clients strip
// <style> tags (or a stylesheet entirely, on some webmail), so anything that
// must survive an actual send has to be inline. Also used verbatim for the
// extension's own live preview iframe, so one template serves both.
const THEME = {
  primary: '#4f46e5',
  primaryDark: '#4338ca',
  text: '#1e293b',
  muted: '#64748b',
  border: '#e2e8f0',
  panelAlt: '#f8fafc',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',
  errorText: '#b91c1c',
};

type ResultKind = 'text' | 'table' | 'image';

// The recorded action that produced this output name is the one source of
// truth for what shape its value is — extractTable's is an array of rows,
// screenshot's is a data: URL, everything else is a single scalar. Looking
// it up here (rather than stamping a redundant kind onto the ReportBlock)
// means a block never has to be kept in sync if the recording changes.
function outputKind(config: ScheduleConfig, key: string): ResultKind {
  const action = config.workflow.actions.find((a) => 'output' in a && a.output === key);
  if (action?.type === 'extractTable') return 'table';
  if (action?.type === 'screenshot') return 'image';
  return 'text';
}

function runFailureBlock(error: string): { text: string; html: string } {
  return {
    text: `FAILED — ${error}`,
    html: `
      <div style="background:${THEME.errorBg};border:1px solid ${THEME.errorBorder};border-radius:8px;padding:14px 16px;margin:4px 0">
        <strong style="color:${THEME.errorText};font-size:13px">⚠ Run failed</strong>
        <div style="color:${THEME.errorText};font-size:13px;margin-top:4px">${escapeHtml(error)}</div>
      </div>`,
  };
}

// A table result's rows arrive flattened directly into batch.data[key] (one
// entry per row, column names as its own keys — see player/batch.ts's
// accumulate) rather than nested under a `key` property the way a scalar
// result is, so it needs its own render path: an actual table, one row per
// entry, columns read off whichever keys the first row happens to have.
function renderTableBlock(key: string, rows: unknown[]): { text: string; html: string } {
  if (rows.length === 0) {
    return {
      text: `${key}: (no rows)`,
      html: `<p style="font-size:13px;color:${THEME.muted};margin:4px 0">${escapeHtml(key)}: no rows.</p>`,
    };
  }
  const columns = Object.keys(rows[0] as object);
  const cell = (row: unknown, col: string) => formatValue((row as Record<string, unknown>)[col]);

  const text = [columns.join(' | '), ...rows.map((r) => columns.map((c) => cell(r, c)).join(' | '))].join('\n');

  const head = columns
    .map(
      (c) =>
        `<th align="left" style="padding:8px 10px;font-size:11px;font-weight:600;color:${THEME.muted};border:1px solid ${THEME.border};background:${THEME.panelAlt}">${escapeHtml(c)}</th>`,
    )
    .join('');
  const body = rows
    .map(
      (r, i) => `
        <tr style="background:${i % 2 === 0 ? '#ffffff' : THEME.panelAlt}">
          ${columns.map((c) => `<td style="padding:8px 10px;font-size:12px;color:${THEME.text};border:1px solid ${THEME.border}">${escapeHtml(cell(r, c)) || '&nbsp;'}</td>`).join('')}
        </tr>`,
    )
    .join('');
  const html = `<table role="presentation" style="width:100%;border-collapse:collapse;margin:4px 0" cellpadding="0" cellspacing="0"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

  return { text, html };
}

function renderScalarBlock(key: string, value: unknown, kind: ResultKind): { text: string; html: string } {
  const isImage = kind === 'image' || isImageValue(value);
  const text = `${key}: ${isImage ? '[image]' : formatValue(value)}`;
  const cell = isImage
    ? `<img src="${value}" alt="${escapeHtml(key)}" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid ${THEME.border};display:block" />`
    : `<span style="font-size:13px;color:${THEME.text}">${escapeHtml(formatValue(value)) || '<span style="color:#94a3b8">(empty)</span>'}</span>`;
  const html = `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:4px 0" cellpadding="0" cellspacing="0">
      <tbody>
        <tr style="background:${THEME.panelAlt}">
          <th align="left" valign="top" style="padding:10px 14px;font-size:12px;font-weight:600;color:${THEME.muted};border:1px solid ${THEME.border};width:32%;white-space:nowrap">${escapeHtml(key)}</th>
          <td style="padding:10px 14px;border:1px solid ${THEME.border}">${cell}</td>
        </tr>
      </tbody>
    </table>`;
  return { text, html };
}

// Shared by the CLI daemon (real sends, cli/src/schedule/runner.ts) and the
// extension's Report window Review tab (a placeholder ReportBatchResult) —
// one function means the preview is exactly what actually gets sent, given
// the same inputs.
//
// Each configured time-of-day is its own independent trigger, so `batch`
// always has exactly one row (see runner.ts's tick()) — this renders "did
// this one run succeed", not a table of repeats.
function renderResultBlock(config: ScheduleConfig, batch: ReportBatchResult, key: string): { text: string; html: string } {
  const row = batch.rows[0];
  if (!row?.success) return runFailureBlock(row?.error ?? 'unknown error');

  const kind = outputKind(config, key);
  const entries = batch.data[key] ?? [];
  if (kind === 'table') return renderTableBlock(key, entries);

  const value = (entries[0] as Record<string, unknown> | undefined)?.[key];
  return renderScalarBlock(key, value, kind);
}

function renderBlockHtml(type: string, value: string): string {
  if (type === 'heading') {
    return `<h3 style="margin:22px 0 10px;font-size:15px;font-weight:700;color:${THEME.primary};border-bottom:2px solid #e0e7ff;padding-bottom:6px">${escapeHtml(value)}</h3>`;
  }
  return `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#334155">${escapeHtml(value).replace(/\n/g, '<br>')}</p>`;
}

export function buildReportEmail(config: ScheduleConfig, batch: ReportBatchResult): MailMessage {
  const dateLabel = new Date().toLocaleString();
  const subject = config.email.subject || `[Browser Agent] ${config.name} — ${dateLabel}`;

  const blocks = config.contentBlocks?.length ? config.contentBlocks : defaultReportBlocks(config.resultKeys);
  const textParts: string[] = [];
  const htmlParts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'heading' || block.type === 'paragraph') {
      const value = block.text ?? '';
      if (!value) continue;
      textParts.push(value);
      htmlParts.push(renderBlockHtml(block.type, value));
    } else if (block.type === 'divider') {
      textParts.push('----------');
      htmlParts.push(`<hr style="border:none;border-top:1px solid ${THEME.border};margin:20px 0" />`);
    } else if (block.type === 'result' && block.resultKey) {
      const result = renderResultBlock(config, batch, block.resultKey);
      textParts.push(result.text);
      htmlParts.push(result.html);
    }
  }

  const text = `${config.name} — ${dateLabel}\n\n${textParts.join('\n\n')}`;
  const html = `
    <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;background:${THEME.panelAlt};padding:20px">
      <div style="background:linear-gradient(135deg,${THEME.primary},${THEME.primaryDark});border-radius:12px 12px 0 0;padding:22px 28px">
        <div style="font-size:19px;font-weight:700;color:#ffffff">${escapeHtml(config.name)}</div>
        <div style="font-size:12px;color:#e0e7ff;margin-top:4px">${escapeHtml(dateLabel)}</div>
      </div>
      <div style="background:#ffffff;border:1px solid ${THEME.border};border-top:none;border-radius:0 0 12px 12px;padding:22px 28px">
        ${htmlParts.join('') || `<p style="font-size:13px;color:${THEME.muted}">No content blocks.</p>`}
      </div>
      <div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:14px">Generated by Browser Agent</div>
    </div>
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
