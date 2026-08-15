import type { Workflow, WorkflowAction, WorkflowParam, RecorderSettings } from '../types';

function detectFileParams(actions: WorkflowAction[]): WorkflowParam[] {
  const names = new Set<string>();

  for (const action of actions) {
    if (action.type !== 'uploadFile') continue;
    const match = /^\$\{(\w+)\}$/.exec(action.value);
    if (match) names.add(match[1]);
  }

  return [...names].map((name) => ({ name, type: 'file', required: true }));
}

export function buildWorkflow(
  actions: WorkflowAction[],
  name: string,
  description: string,
  settings: RecorderSettings,
): Workflow {
  return {
    version: '1.0.0',
    name,
    ...(description ? { description } : {}),
    params: detectFileParams(actions),
    ...(settings.autoDismissPopup ? { globalSettings: { autoDismissPopup: { enabled: true } } } : {}),
    actions,
    exportFormats: [],
  };
}
