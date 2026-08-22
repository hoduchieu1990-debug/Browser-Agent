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
  pinSide: boolean;
  verboseLogging: boolean;
}

export const DEFAULT_SETTINGS: RecorderSettings = {
  autoDismissPopup: true,
  captureScreenshots: false,
  highlightElements: true,
  onPageConfirmation: true,
  pinSide: true,
  verboseLogging: false,
};

// Viewport-relative, in CSS px — the same shape captureVisibleTab-based
// cropping already expects elsewhere (see utils/capture.ts's CaptureRect).
export interface ThumbnailRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RuntimeMessage =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'RESET' }
  | { type: 'GET_STATE' }
  | { type: 'REMOVE_ACTION'; index: number }
  | { type: 'UPDATE_ACTION'; index: number; patch: Record<string, unknown> }
  | { type: 'CLOSE_POPUP'; windowId: number }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; settings: RecorderSettings }
  | { type: 'SET_RECORDING'; value: boolean; highlightElements: boolean }
  | {
      type: 'RECORDED_ACTION';
      action: RecordedActionPayload;
      replacesLastClick?: boolean;
      rect?: ThumbnailRect;
      dpr?: number;
    }
  | { type: 'ACTIONS_UPDATED'; actions: WorkflowAction[] }
  | { type: 'GET_THUMBNAILS' }
  | { type: 'THUMBNAIL_READY'; actionId: string; dataUrl: string }
  | { type: 'RECORDING_UPDATED'; recording: boolean }
  | { type: 'SHOW_TOAST'; step: number; action: WorkflowAction }
  | { type: 'REPLAY_START'; background: boolean }
  | { type: 'REPLAY_STEP'; action: WorkflowAction & { resolvedValue?: string } }
  | { type: 'REPLAY_UPDATED'; state: ReplayState }
  | { type: 'GET_REPLAY_STATE' }
  | { type: 'GET_RECORDINGS' }
  | { type: 'LOAD_RECORDING'; id: string }
  | { type: 'DELETE_RECORDING'; id: string }
  | { type: 'RECORDINGS_UPDATED'; recordings: SavedRecording[] }
  | { type: 'BATCH_SET_DATASET'; fileName: string; headers: string[]; rows: DataRow[] }
  | { type: 'BATCH_GET_DATASET' }
  | { type: 'BATCH_TEST_ROW' }
  | { type: 'BATCH_RUN_ALL'; stopOnError: boolean }
  | { type: 'BATCH_STOP' }
  | { type: 'BATCH_GET_STATE' }
  | { type: 'BATCH_UPDATED'; state: BatchReplayState };

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

// ============= BATCH =============

export type DataRow = Record<string, string>;

export interface BatchDataset {
  fileName: string;
  headers: string[];
  rows: DataRow[];
}

export interface BatchRunRow {
  index: number; // 1-based
  input: DataRow;
  output: Record<string, string>;
  status: 'running' | 'success' | 'failed';
  error?: string;
}

export interface BatchReplayState {
  running: boolean;
  total: number;
  rows: BatchRunRow[];
  startedAt: number;
  updatedAt: number;
  error?: string;
}
