import type { WorkflowAction } from '@browser-agent/shared';

export type * from '@browser-agent/shared';

// Omit collapses a union to its shared keys, which would drop selector/value/…
// entirely — distribute over each action variant instead.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type RecordedActionPayload = DistributiveOmit<WorkflowAction, 'id'>;

export interface RecorderSettings {
  autoDismissPopup: boolean;
  captureScreenshots: boolean;
  highlightElements: boolean;
  onPageConfirmation: boolean;
  verboseLogging: boolean;
}

export const DEFAULT_SETTINGS: RecorderSettings = {
  autoDismissPopup: true,
  captureScreenshots: false,
  highlightElements: true,
  onPageConfirmation: true,
  verboseLogging: false,
};

export type RuntimeMessage =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'RESET' }
  | { type: 'GET_STATE' }
  | { type: 'REMOVE_ACTION'; index: number }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; settings: RecorderSettings }
  | { type: 'SET_RECORDING'; value: boolean; highlightElements: boolean }
  | { type: 'RECORDED_ACTION'; action: RecordedActionPayload }
  | { type: 'ACTIONS_UPDATED'; actions: WorkflowAction[] }
  | { type: 'SHOW_TOAST'; step: number; action: WorkflowAction }
  | { type: 'REPLAY_START'; background: boolean }
  | { type: 'REPLAY_STEP'; action: WorkflowAction }
  | { type: 'REPLAY_UPDATED'; state: ReplayState }
  | { type: 'GET_REPLAY_STATE' }
  | { type: 'GET_RECORDINGS' }
  | { type: 'LOAD_RECORDING'; id: string }
  | { type: 'DELETE_RECORDING'; id: string }
  | { type: 'RECORDINGS_UPDATED'; recordings: SavedRecording[] };

export interface SavedRecording {
  id: string;
  name: string;
  createdAt: string;
  actions: WorkflowAction[];
}

export type ReplayStepStatus = 'running' | 'done' | 'skipped' | 'failed';

export interface ReplayStepLog {
  index: number; // 1-based, matches the numbering shown in the Record tab
  type: string;
  target?: string;
  status: ReplayStepStatus;
  message?: string;
  durationMs?: number;
}

export interface ReplayState {
  running: boolean;
  total: number;
  steps: ReplayStepLog[];
  variables: Record<string, unknown>;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface RecorderState {
  recording: boolean;
  actions: WorkflowAction[];
  highlightElements: boolean;
  error?: string | null;
}
