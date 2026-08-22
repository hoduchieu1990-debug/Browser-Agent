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
  screenshot: '🖼️',
  scroll: '📜',
  batchInput: '⌨️',
  batchClick: '🖱️',
  batchSearch: '🔎',
  batchExtract: '📤',
};

export function actionTypeIcon(type: string): string {
  return ACTION_TYPE_ICONS[type] ?? '▫️';
}

export function actionSelectorText(action: WorkflowAction): string | undefined {
  if ('url' in action) return action.url;
  if ('selector' in action) return action.selector;
  if (action.type === 'wait') return `${action.duration}ms`;
  return undefined;
}

export function actionValueText(action: WorkflowAction): string | undefined {
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
