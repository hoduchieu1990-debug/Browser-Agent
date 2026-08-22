import type { WorkflowAction } from '../types';

// Output names are already known at record time (extractText/extractTable/
// extractJson each declare their own `output` field) — no need to replay
// the recording first just to find out what could be emailed.
export function extractableOutputs(actions: WorkflowAction[]): string[] {
  const names = new Set<string>();
  for (const action of actions) {
    if ('output' in action && action.output) names.add(action.output);
  }
  return [...names];
}
