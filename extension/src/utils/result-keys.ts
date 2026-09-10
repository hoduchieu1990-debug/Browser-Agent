import type { WorkflowAction } from '../types';

export type ReportResultKind = 'text' | 'table' | 'image';

export interface ReportResultSource {
  key: string;
  kind: ReportResultKind;
}

function kindOf(action: WorkflowAction): ReportResultKind {
  if (action.type === 'extractTable') return 'table';
  if (action.type === 'screenshot') return 'image';
  return 'text';
}

// Output names — and what kind of value they hold — are already known at
// record time (each extractText/extractTable/extractJson/screenshot/
// batchExtract action declares its own `output` field) — no need to replay
// the recording first just to find out what could be emailed.
export function extractableOutputs(actions: WorkflowAction[]): ReportResultSource[] {
  const kinds = new Map<string, ReportResultKind>();
  for (const action of actions) {
    if ('output' in action && action.output) kinds.set(action.output, kindOf(action));
  }
  return [...kinds].map(([key, kind]) => ({ key, kind }));
}
