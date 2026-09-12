import { useEffect, useRef, useState } from 'react';
import type { RecordedActionPayload } from '../types';

type NewAction = RecordedActionPayload;

// Sensible starting values, not guesses at the user's real setup — every
// field stays editable in the step's own config panel right after it's added.
const DEFAULTS: Record<string, () => NewAction> = {
  mailSend: () => ({
    type: 'mailSend',
    host: '',
    port: 587,
    user: '',
    password: '',
    to: '',
    subject: '',
    body: '',
  }),
  mailRead: () => ({
    type: 'mailRead',
    host: '',
    port: 993,
    secure: true,
    user: '',
    password: '',
    mailbox: 'INBOX',
    criteria: 'unseen',
    limit: 10,
    output: 'messages',
  }),
  mailSearch: () => ({
    type: 'mailSearch',
    host: '',
    port: 993,
    secure: true,
    user: '',
    password: '',
    mailbox: 'INBOX',
    limit: 10,
    output: 'messages',
  }),
  mailAttachment: () => ({
    type: 'mailAttachment',
    host: '',
    port: 993,
    secure: true,
    user: '',
    password: '',
    mailbox: 'INBOX',
    source: 'messages',
    saveDir: '',
    output: 'files',
  }),
  fileReadExcel: () => ({ type: 'fileReadExcel', filePath: '', headerRow: true, output: 'rows' }),
  fileWriteExcel: () => ({ type: 'fileWriteExcel', filePath: '', sheet: 'Sheet1', data: '', headerRow: true }),
  fileReadPdf: () => ({ type: 'fileReadPdf', filePath: '', output: 'text' }),
  fileMove: () => ({ type: 'fileMove', sourcePath: '', destPath: '' }),
  dbQuery: () => ({
    type: 'dbQuery',
    connection: { server: '', database: '', user: '', password: '' },
    query: '',
    output: 'rows',
  }),
  dbExecute: () => ({
    type: 'dbExecute',
    connection: { server: '', database: '', user: '', password: '' },
    statement: '',
  }),
  dbExport: () => ({
    type: 'dbExport',
    connection: { server: '', database: '', user: '', password: '' },
    query: '',
    format: 'csv',
    filePath: '',
  }),
  apiGet: () => ({ type: 'apiGet', url: '', output: 'result' }),
  apiPost: () => ({ type: 'apiPost', url: '', json: true, output: 'result' }),
  apiJsonParse: () => ({ type: 'apiJsonParse', input: '', output: 'parsed' }),
};

const GROUPS: { label: string; items: { type: string; label: string }[] }[] = [
  {
    label: 'Mail',
    items: [
      { type: 'mailSend', label: 'Send' },
      { type: 'mailRead', label: 'Read' },
      { type: 'mailSearch', label: 'Search' },
      { type: 'mailAttachment', label: 'Attachment' },
    ],
  },
  {
    label: 'File',
    items: [
      { type: 'fileReadExcel', label: 'Read Excel' },
      { type: 'fileWriteExcel', label: 'Write Excel' },
      { type: 'fileReadPdf', label: 'Read PDF' },
      { type: 'fileMove', label: 'Move File' },
    ],
  },
  {
    label: 'Database',
    items: [
      { type: 'dbQuery', label: 'Query' },
      { type: 'dbExecute', label: 'Execute' },
      { type: 'dbExport', label: 'Export' },
    ],
  },
  {
    label: 'API',
    items: [
      { type: 'apiGet', label: 'GET' },
      { type: 'apiPost', label: 'POST' },
      { type: 'apiJsonParse', label: 'JSON Parse' },
    ],
  },
];

interface Props {
  onAdd: (action: NewAction) => void;
}

export function AddStepMenu({ onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  return (
    <div className="add-step-menu" ref={ref}>
      <button className="add-step-btn" onClick={() => setOpen((v) => !v)}>
        + Add step
      </button>
      {open && (
        <div className="add-step-panel">
          {GROUPS.map((group) => (
            <div className="add-step-group" key={group.label}>
              <div className="add-step-group-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.type}
                  className="add-step-item"
                  onClick={() => {
                    onAdd(DEFAULTS[item.type]());
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
