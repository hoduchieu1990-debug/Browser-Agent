/**
 * Types for the `.schedule.json` file: a snapshot of a saved recording plus
 * a recurrence rule and SMTP report settings. Written by the extension
 * (extension/src/popup/ReportComposer.tsx), read and updated in place by the
 * CLI daemon (cli/src/schedule/*).
 */

import type { Workflow } from './types';

// Each entry in `times` is its own independent trigger: a run + its own
// email, not a count of back-to-back repeats. "08:00, 12:00, 17:00" fires
// three separate times a day, each producing one report.
export type ScheduleRecurrence =
  | { type: 'once'; date: string /* YYYY-MM-DD */; times: string[] /* HH:mm, local */ }
  | { type: 'weekly'; weekdays: number[] /* 0=Sun..6=Sat */; times: string[] /* HH:mm, local */ };

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
  lastStatus?: 'success' | 'failed';
  lastError?: string;
  lastRunDurationMs?: number;
}

export interface ScheduleAttachment {
  format: 'csv' | 'excel';
}

// The email body as a small canvas: an ordered list of blocks the user adds,
// edits, removes, and reorders in ReportComposer.tsx. 'results' is a
// placeholder — buildReportEmail (report-email.ts) substitutes the actual
// results table/failure message there, so its position among the other
// blocks is the only thing this format needs to record.
export type ReportBlockType = 'heading' | 'paragraph' | 'results' | 'divider';

export interface ReportBlock {
  id: string;
  type: ReportBlockType;
  /** heading/paragraph only — ignored for 'results' and 'divider'. */
  text?: string;
}

/** What a new report starts with: an empty intro line above the results table. */
export function defaultReportBlocks(): ReportBlock[] {
  return [
    { id: 'block-intro', type: 'paragraph', text: '' },
    { id: 'block-results', type: 'results' },
  ];
}

export interface ScheduleConfig {
  id: string;
  name: string;
  /** Snapshot taken at creation time — editing the original saved recording later does not affect this. */
  workflow: Workflow;
  recurrence: ScheduleRecurrence;
  /** Which action `output` names to include in the report email. */
  resultKeys: string[];
  /** The email body, in block order. Missing/empty falls back to defaultReportBlocks(). */
  contentBlocks?: ReportBlock[];
  /** Omitted — no attached file; set — attach the same results as CSV/Excel. */
  attachment?: ScheduleAttachment;
  email: ScheduleEmailConfig;
  state: ScheduleState;
}
