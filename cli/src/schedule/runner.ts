import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkflowPlayer, runBatch } from '@browser-agent/player';
import { buildReportEmail, type ScheduleEmailConfig } from '@browser-agent/shared';
import { computeDueSlot } from './due';
import { createSmtpMailer, type Mailer } from './mailer';
import { readSchedule, writeSchedule } from './store';

export interface TickOptions {
  mailerFactory?: (email: ScheduleEmailConfig) => Mailer;
  now?: Date;
}

// One pass over a single schedule file: fires it if (and only if) it's due
// and hasn't already fired for this slot. Safe to call repeatedly/often —
// most calls are a cheap no-op read+compare.
export async function tick(scheduleFilePath: string, options: TickOptions = {}): Promise<void> {
  const now = options.now ?? new Date();
  const config = readSchedule(scheduleFilePath);

  const slot = computeDueSlot(config.recurrence, now);
  if (!slot) return;
  if (config.state.lastRunAt && new Date(config.state.lastRunAt) >= slot) return;

  // Guards against two daemon processes (or two overlapping ticks) racing
  // the same schedule file — the daemon's own loop can't overlap itself
  // since it awaits each full pass before sleeping, so this only matters
  // for a second, separate process.
  const lockPath = `${scheduleFilePath}.lock`;
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
  } catch {
    return;
  }

  try {
    // Claim this slot BEFORE running, not after — if the process dies
    // mid-run, the next tick sees the slot already claimed and waits for
    // the next natural slot instead of re-firing or double-sending mail.
    config.state.lastRunAt = slot.toISOString();
    writeSchedule(scheduleFilePath, config);

    const runStart = Date.now();
    const player = new WorkflowPlayer({ headless: true });
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-agent-schedule-'));

    try {
      const validation = await player.validate(config.workflow);
      if (!validation.valid) {
        throw new Error(`Workflow validation failed: ${validation.errors.map((e) => e.message).join('; ')}`);
      }

      // Each configured time is its own independent trigger now — exactly
      // one run per tick, not a batch of repeats. Still routed through
      // runBatch (with a single row) rather than player.run() directly, to
      // reuse its exportFormats -> attachment-file wiring unchanged.
      const batch = await runBatch(player, config.workflow, [{}], { outputDir, stopOnError: true });

      const mailer = (options.mailerFactory ?? createSmtpMailer)(config.email);
      await mailer.send(buildReportEmail(config, batch));

      config.state.lastStatus = batch.failed === 0 ? 'success' : 'failed';
      config.state.lastError = batch.rows[0]?.error;
    } catch (error) {
      config.state.lastStatus = 'failed';
      config.state.lastError = (error as Error).message;
    } finally {
      config.state.timesTriggered += 1;
      config.state.lastRunDurationMs = Date.now() - runStart;
      writeSchedule(scheduleFilePath, config);
      await player.close();
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  } finally {
    fs.unlinkSync(lockPath);
  }
}
