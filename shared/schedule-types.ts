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

// The email body as a small canvas: an ordered list of blocks the user drags
// in, edits, removes, and reorders in ReportComposer.tsx. 'result' is a
// placeholder for ONE named output (resultKey) — buildReportEmail
// (report-email.ts) substitutes that output's actual value there (as text,
// an inline image, or a table, depending on what the value turns out to be),
// so its position among the other blocks is the only thing this format
// needs to record. One block per result, not one block for all of them, is
// what lets the user place each result exactly where they want it relative
// to their own headings/paragraphs.
export type ReportBlockType = 'heading' | 'paragraph' | 'result' | 'divider';

export interface ReportBlock {
  id: string;
  type: ReportBlockType;
  /** heading/paragraph only — ignored otherwise. */
  text?: string;
  /** result only — which action `output` name this block renders. */
  resultKey?: string;
}

/**
 * What a report starts with when nothing was explicitly laid out: an intro
 * line plus one block per given result key, in that order. Used both for a
 * brand-new report in ReportComposer.tsx (pre-populated with every result
 * the job produced, so there's something to rearrange rather than an empty
 * canvas) and as report-email.ts's fallback for a ScheduleConfig that has no
 * contentBlocks at all.
 */
export function defaultReportBlocks(resultKeys: string[] = []): ReportBlock[] {
  return [
    { id: 'block-intro', type: 'paragraph', text: '' },
    ...resultKeys.map((resultKey, i) => ({ id: `block-result-${i}`, type: 'result' as const, resultKey })),
  ];
}

export interface ScheduleConfig {
  id: string;
  name: string;
  /** Snapshot taken at creation time — editing the original saved recording later does not affect this. */
  workflow: Workflow;
  recurrence: ScheduleRecurrence;
  /** Which action `output` names to attach as a CSV/Excel file — independent of which ones appear as 'result' blocks in the body. */
  resultKeys: string[];
  /** The email body, in block order. Missing/empty falls back to defaultReportBlocks(). */
  contentBlocks?: ReportBlock[];
  /** Omitted — no attached file; set — attach the same results as CSV/Excel. */
  attachment?: ScheduleAttachment;
  email: ScheduleEmailConfig;
  state: ScheduleState;
}
