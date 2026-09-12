import type { WorkflowAction } from '../types';

type FieldType = 'text' | 'number' | 'password' | 'checkbox' | 'textarea' | 'select' | 'keyvalue' | 'lines' | 'attachments';

interface FieldSpec {
  key: string; // dot path allowed, e.g. "connection.server"
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  full?: boolean; // spans the whole row instead of sharing it
}

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((v, k) => v?.[k], obj);
}

// Builds a patch shaped like the nested object it targets — {a:{b:1}} for
// "a.b" — because App.tsx's onUpdateAction does a shallow `{...action,
// ...patch}` merge; a bare {b: 1} would sit next to `connection`, not inside it.
function setPath(obj: any, path: string, value: unknown): Record<string, unknown> {
  const [root, ...rest] = path.split('.');
  if (rest.length === 0) return { [root]: value };
  return { [root]: { ...(obj?.[root] ?? {}), ...setPath(obj?.[root] ?? {}, rest.join('.'), value) } };
}

function parseKeyValue(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key) result[key] = line.slice(idx + 1).trim();
  }
  return result;
}

function formatKeyValue(obj: Record<string, string> | undefined): string {
  return Object.entries(obj ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function parseLines(text: string): (string | number | boolean | null)[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line === 'true') return true;
      if (line === 'false') return false;
      if (line === 'null') return null;
      if (line !== '' && !Number.isNaN(Number(line))) return Number(line);
      return line;
    });
}

function parseAttachments(text: string): { filePath: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((filePath) => ({ filePath }));
}

const MAIL_CONNECTION_FIELDS: FieldSpec[] = [
  { key: 'host', label: 'Host', type: 'text' },
  { key: 'port', label: 'Port', type: 'number' },
  { key: 'secure', label: 'Use TLS', type: 'checkbox' },
  { key: 'user', label: 'Username', type: 'text' },
  { key: 'password', label: 'Password', type: 'password' },
];

const DB_CONNECTION_FIELDS: FieldSpec[] = [
  { key: 'connection.server', label: 'Server', type: 'text' },
  { key: 'connection.database', label: 'Database', type: 'text' },
  { key: 'connection.user', label: 'User', type: 'text' },
  { key: 'connection.password', label: 'Password', type: 'password' },
  { key: 'connection.port', label: 'Port', type: 'number' },
  { key: 'connection.encrypt', label: 'Encrypt', type: 'checkbox' },
  { key: 'connection.trustServerCertificate', label: 'Trust server cert', type: 'checkbox' },
];

const FIELD_SCHEMAS: Record<string, FieldSpec[]> = {
  mailSend: [
    ...MAIL_CONNECTION_FIELDS,
    { key: 'to', label: 'To', type: 'text' },
    { key: 'cc', label: 'Cc', type: 'text' },
    { key: 'bcc', label: 'Bcc', type: 'text' },
    { key: 'subject', label: 'Subject', type: 'text' },
    { key: 'html', label: 'Body is HTML', type: 'checkbox' },
    { key: 'body', label: 'Body', type: 'textarea', full: true },
    { key: 'attachments', label: 'Attachments (one file path per line)', type: 'attachments', full: true },
  ],
  mailRead: [
    ...MAIL_CONNECTION_FIELDS,
    { key: 'mailbox', label: 'Mailbox', type: 'text', placeholder: 'INBOX' },
    {
      key: 'criteria',
      label: 'Which messages',
      type: 'select',
      options: [
        { value: 'unseen', label: 'Unread only' },
        { value: 'all', label: 'All' },
      ],
    },
    { key: 'limit', label: 'Max messages', type: 'number' },
    { key: 'markSeen', label: 'Mark as read after fetching', type: 'checkbox' },
    { key: 'output', label: 'Output variable', type: 'text' },
  ],
  mailSearch: [
    ...MAIL_CONNECTION_FIELDS,
    { key: 'mailbox', label: 'Mailbox', type: 'text', placeholder: 'INBOX' },
    { key: 'from', label: 'From contains', type: 'text' },
    { key: 'subject', label: 'Subject contains', type: 'text' },
    { key: 'since', label: 'Since (date)', type: 'text', placeholder: 'YYYY-MM-DD' },
    { key: 'unseen', label: 'Unread only', type: 'checkbox' },
    { key: 'limit', label: 'Max messages', type: 'number' },
    { key: 'output', label: 'Output variable', type: 'text' },
  ],
  mailAttachment: [
    ...MAIL_CONNECTION_FIELDS,
    { key: 'mailbox', label: 'Mailbox', type: 'text', placeholder: 'INBOX' },
    { key: 'source', label: 'Messages variable (from a Mail Read/Search step)', type: 'text', full: true },
    { key: 'saveDir', label: 'Save to folder', type: 'text', full: true },
    { key: 'output', label: 'Output variable', type: 'text' },
  ],
  fileReadExcel: [
    { key: 'filePath', label: 'File path', type: 'text', full: true },
    { key: 'sheet', label: 'Sheet (name or number)', type: 'text' },
    { key: 'headerRow', label: 'First row is headers', type: 'checkbox' },
    { key: 'output', label: 'Output variable', type: 'text' },
  ],
  fileWriteExcel: [
    { key: 'filePath', label: 'File path', type: 'text', full: true },
    { key: 'sheet', label: 'Sheet name', type: 'text', placeholder: 'Sheet1' },
    { key: 'data', label: 'Rows variable (from an earlier step)', type: 'text' },
    { key: 'headerRow', label: 'Write header row', type: 'checkbox' },
  ],
  fileReadPdf: [
    { key: 'filePath', label: 'File path', type: 'text', full: true },
    { key: 'output', label: 'Output variable', type: 'text' },
  ],
  fileMove: [
    { key: 'sourcePath', label: 'Source path', type: 'text', full: true },
    { key: 'destPath', label: 'Destination path', type: 'text', full: true },
    { key: 'overwrite', label: 'Overwrite if it exists', type: 'checkbox' },
  ],
  dbQuery: [
    ...DB_CONNECTION_FIELDS,
    { key: 'query', label: 'SQL (bind params as @p0, @p1, …)', type: 'textarea', full: true },
    { key: 'params', label: 'Params (one per line, in @p0, @p1… order)', type: 'lines', full: true },
    { key: 'output', label: 'Output variable', type: 'text' },
  ],
  dbExecute: [
    ...DB_CONNECTION_FIELDS,
    { key: 'statement', label: 'SQL (bind params as @p0, @p1, …)', type: 'textarea', full: true },
    { key: 'params', label: 'Params (one per line, in @p0, @p1… order)', type: 'lines', full: true },
    { key: 'output', label: 'Output variable (rows affected, optional)', type: 'text' },
  ],
  dbExport: [
    ...DB_CONNECTION_FIELDS,
    { key: 'query', label: 'SQL (bind params as @p0, @p1, …)', type: 'textarea', full: true },
    { key: 'params', label: 'Params (one per line, in @p0, @p1… order)', type: 'lines', full: true },
    {
      key: 'format',
      label: 'File format',
      type: 'select',
      options: [
        { value: 'csv', label: 'CSV' },
        { value: 'excel', label: 'Excel' },
        { value: 'json', label: 'JSON' },
      ],
    },
    { key: 'filePath', label: 'Save to path', type: 'text', full: true },
    { key: 'output', label: 'Output variable (saved path, optional)', type: 'text' },
  ],
  apiGet: [
    { key: 'url', label: 'URL', type: 'text', full: true },
    { key: 'queryParams', label: 'Query params (key: value per line)', type: 'keyvalue', full: true },
    { key: 'httpHeaders', label: 'Headers (key: value per line)', type: 'keyvalue', full: true },
    { key: 'output', label: 'Output variable', type: 'text' },
  ],
  apiPost: [
    { key: 'url', label: 'URL', type: 'text', full: true },
    { key: 'httpHeaders', label: 'Headers (key: value per line)', type: 'keyvalue', full: true },
    { key: 'json', label: 'Send as JSON', type: 'checkbox' },
    { key: 'body', label: 'Body', type: 'textarea', full: true },
    { key: 'output', label: 'Output variable', type: 'text' },
  ],
  apiJsonParse: [
    { key: 'input', label: 'JSON variable (from an earlier step)', type: 'text' },
    { key: 'path', label: 'Path (optional, e.g. data.items)', type: 'text' },
    { key: 'output', label: 'Output variable', type: 'text' },
  ],
};

interface Props {
  action: WorkflowAction;
  onUpdate: (patch: Record<string, unknown>) => void;
}

export function PluginActionConfig({ action, onUpdate }: Props) {
  const fields = FIELD_SCHEMAS[action.type];
  if (!fields) return null;

  return (
    <div className="action-batch-config plugin-action-config">
      {fields.map((field) => {
        const value = getPath(action, field.key);
        const commit = (v: unknown) => onUpdate(setPath(action, field.key, v));

        return (
          <label key={field.key} className={field.full ? 'full-width' : undefined}>
            {field.label}
            {field.type === 'checkbox' && (
              <input type="checkbox" checked={Boolean(value)} onChange={(e) => commit(e.target.checked || undefined)} />
            )}
            {field.type === 'select' && (
              <select value={value ?? field.options?.[0]?.value ?? ''} onChange={(e) => commit(e.target.value)}>
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
            {field.type === 'textarea' && (
              <textarea
                rows={3}
                placeholder={field.placeholder}
                value={value ?? ''}
                onChange={(e) => commit(e.target.value)}
              />
            )}
            {field.type === 'keyvalue' && (
              <textarea
                rows={2}
                placeholder="name: value"
                value={formatKeyValue(value)}
                onChange={(e) => commit(parseKeyValue(e.target.value))}
              />
            )}
            {field.type === 'lines' && (
              <textarea
                rows={2}
                placeholder={field.placeholder}
                value={(value ?? []).join('\n')}
                onChange={(e) => commit(parseLines(e.target.value))}
              />
            )}
            {field.type === 'attachments' && (
              <textarea
                rows={2}
                placeholder="C:\path\to\file.pdf"
                value={(value ?? []).map((a: { filePath: string }) => a.filePath).join('\n')}
                onChange={(e) => commit(parseAttachments(e.target.value))}
              />
            )}
            {(field.type === 'text' || field.type === 'number' || field.type === 'password') && (
              <input
                type={field.type}
                placeholder={field.placeholder}
                value={value ?? ''}
                onChange={(e) => commit(field.type === 'number' ? Number(e.target.value) : e.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
