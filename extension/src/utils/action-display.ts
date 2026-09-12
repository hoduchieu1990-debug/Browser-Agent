import type { WorkflowAction } from '../types';

// Same icon a given kind of step uses everywhere it's offered while
// recording (the Add badge's menu, Batch's submenu) — reusing those keeps
// one visual vocabulary instead of a second, unrelated set just for lists.
const ACTION_TYPE_ICONS: Record<string, string> = {
  navigate: '🌐',
  click: '🖱️',
  input: '⌨️',
  select: '🔽',
  uploadFile: '📎',
  wait: '⏳',
  waitForSelector: '👁️',
  extractText: '🎯',
  extractTable: '📊',
  extractJson: '🧾',
  dismissPopup: '✖️',
  hover: '👆',
  screenshot: '🖼️',
  scroll: '📜',
  batchInput: '⌨️',
  batchClick: '🖱️',
  batchSearch: '🔎',
  batchExtract: '📤',
  mailSend: '✉️',
  mailRead: '📥',
  mailSearch: '📬',
  mailAttachment: '📎',
  fileReadExcel: '📗',
  fileWriteExcel: '📘',
  fileReadPdf: '📕',
  fileMove: '🗂️',
  dbQuery: '🗄️',
  dbExecute: '🛠️',
  dbExport: '💾',
  apiGet: '⬇️',
  apiPost: '⬆️',
  apiJsonParse: '🧩',
};

// Mail/File/Database steps run through player/cli only — the extension's
// in-browser replay has no SMTP/IMAP socket, filesystem, or DB driver, so it
// reports these as unsupported rather than attempting them. apiJsonParse is
// here for a different reason: apiGet/apiPost run fine in-browser on their
// own, but in-browser replay sends each step to the content script with no
// access to earlier steps' outputs (that bookkeeping lives in background.ts,
// per-run, not threaded through REPLAY_STEP) — apiJsonParse specifically
// needs a prior step's output, so only player/cli (one process, one
// `context.variables`) can run it.
const CLI_ONLY_TYPES = new Set([
  'mailSend',
  'mailRead',
  'mailSearch',
  'mailAttachment',
  'fileReadExcel',
  'fileWriteExcel',
  'fileReadPdf',
  'fileMove',
  'dbQuery',
  'dbExecute',
  'dbExport',
  'apiJsonParse',
]);

export function isCliOnlyAction(type: string): boolean {
  return CLI_ONLY_TYPES.has(type);
}

export function actionTypeIcon(type: string): string {
  return ACTION_TYPE_ICONS[type] ?? '▫️';
}

export function actionSelectorText(action: WorkflowAction): string | undefined {
  switch (action.type) {
    case 'mailSend':
      return `to: ${action.to}`;
    case 'mailRead':
    case 'mailSearch':
      return `${action.host} (${action.mailbox ?? 'INBOX'})`;
    case 'mailAttachment':
      return `${action.host} → ${action.saveDir}`;
    case 'fileReadExcel':
    case 'fileReadPdf':
      return action.filePath;
    case 'fileWriteExcel':
      return action.filePath;
    case 'fileMove':
      return `${action.sourcePath} → ${action.destPath}`;
    case 'dbQuery':
    case 'dbExecute':
    case 'dbExport':
      return `${action.connection.server}/${action.connection.database}`;
    case 'apiJsonParse':
      return action.input;
  }
  if ('url' in action) return action.url;
  if ('selector' in action) return action.selector;
  if (action.type === 'wait') return `${action.duration}ms`;
  return undefined;
}

export function actionValueText(action: WorkflowAction): string | undefined {
  switch (action.type) {
    case 'dbQuery':
      return `${action.query} → ${action.output}`;
    case 'dbExecute':
      return action.statement;
    case 'dbExport':
      return `${action.query} → ${action.filePath}`;
    case 'fileWriteExcel':
      return `${action.data} (variable)`;
  }
  if ('value' in action) return action.value;
  if ('output' in action) return `→ ${action.output}`;
  return undefined;
}

export function describeAction(action: WorkflowAction): string {
  const target = actionSelectorText(action);
  const value = actionValueText(action);
  const parts = [action.type, target].filter(Boolean);
  const summary = parts.join(' → ');
  return value ? `${summary} = "${value}"` : summary;
}

const BATCH_NODE_LABELS: Record<string, string> = {
  batchInput: 'Input',
  batchClick: 'Click',
  batchSearch: 'Search',
  batchExtract: 'Extract',
};

// "Input 1" / "Click 2" are purely a display convention — nothing stores this
// number, it's just how many nodes of the same batch kind came before it.
export function batchNodeLabel(actions: WorkflowAction[], index: number): string {
  const action = actions[index];
  const name = BATCH_NODE_LABELS[action.type];
  if (!name) return action.type;

  const ordinal = actions.slice(0, index + 1).filter((a) => a.type === action.type).length;
  return `${name} ${ordinal}`;
}
