import type { WorkflowAction } from '../types';

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
