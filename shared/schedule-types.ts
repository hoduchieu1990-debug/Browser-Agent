/**
 * Types for the `.schedule.json` file: a snapshot of a saved recording plus
 * a recurrence rule and SMTP report settings. Written by the extension
 * (extension/src/popup/ScheduleForm.tsx), read and updated in place by the
 * CLI daemon (cli/src/schedule/*).
 */

import type { Workflow } from './types';

export type ScheduleRecurrence =
  | { type: 'once'; date: string /* YYYY-MM-DD */; time: string /* HH:mm, local */ }
  | { type: 'weekly'; weekdays: number[] /* 0=Sun..6=Sat */; time: string /* HH:mm, local */ };

export interface ScheduleEmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from?: string;
  to: string;
  subject?: string;
}

export interface ScheduleState {
  /** ISO — the nominal slot last fired, not wall-clock "now" (written before the run starts). */
  lastRunAt?: string;
  timesTriggered: number;
  lastStatus?: 'success' | 'partial' | 'failed';
  lastError?: string;
  lastRunDurationMs?: number;
}

export interface ScheduleConfig {
  id: string;
  name: string;
  /** Snapshot taken at creation time — editing the original saved recording later does not affect this. */
  workflow: Workflow;
  recurrence: ScheduleRecurrence;
  /** Back-to-back runs of the same workflow each time the schedule fires. >= 1. */
  repeatCount: number;
  /** Which action `output` names to include in the report email. */
  resultKeys: string[];
  /** If a repeat run fails, stop the remaining repeats instead of continuing. */
  stopOnError: boolean;
  email: ScheduleEmailConfig;
  state: ScheduleState;
}
