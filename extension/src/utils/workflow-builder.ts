import type { Workflow, WorkflowAction, WorkflowParam, RecorderSettings } from '../types';
import { isNexacroSelector } from './nexacro';
import { NEXACRO_BRIDGE_SCRIPT, NEXACRO_REPLAY_README } from './nexacro-replay-guide';

function detectFileParams(actions: WorkflowAction[]): WorkflowParam[] {
  const names = new Set<string>();

  for (const action of actions) {
    if (action.type !== 'uploadFile') continue;
    const match = /^\$\{(\w+)\}$/.exec(action.value);
    if (match) names.add(match[1]);
  }

  return [...names].map((name) => ({ name, type: 'file', required: true }));
}

function usesNexacroSelector(actions: WorkflowAction[]): boolean {
  return actions.some((action) => 'selector' in action && !!action.selector && isNexacroSelector(action.selector));
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
    // Embedded so the exported .json alone (no other file, no access to this
    // project) is enough for a program with no Nexacro-specific code of its
    // own to replay the nexacro:<id> steps — see nexacro-replay-guide.ts.
    ...(usesNexacroSelector(actions)
      ? { nexacroReplayGuide: { readme: NEXACRO_REPLAY_README, bridgeScript: NEXACRO_BRIDGE_SCRIPT } }
      : {}),
  };
}
