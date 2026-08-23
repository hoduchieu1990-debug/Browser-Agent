import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import chalk from 'chalk';
import type { ScheduleRecurrence } from '@browser-agent/shared';
import { listScheduleFiles, readSchedule } from '../schedule/store';
import { tick } from '../schedule/runner';

// The extension downloads .schedule.json files to this same folder
// (extension/src/popup/ScheduleForm.tsx's `filename` prefix) — there is no
// shared code path between the browser extension bundle and this CLI to
// enforce the two stay in sync, so this literal must be changed in both
// places together if it ever changes.
function defaultScheduleDir(): string {
  return path.join(os.homedir(), 'Downloads', 'BrowserAgent-Schedules');
}

function describeRecurrence(recurrence: ScheduleRecurrence): string {
  const times = recurrence.times.join(', ');
  if (recurrence.type === 'once') return `once on ${recurrence.date} at ${times}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `weekly on ${recurrence.weekdays.map((d) => days[d]).join(',')} at ${times}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const runSubcommand = new Command('run')
  .description('Poll a folder of .schedule.json files and run any that are due')
  .option('-d, --dir <path>', 'Folder to watch for .schedule.json files', defaultScheduleDir())
  .option('--interval <seconds>', 'Poll interval in seconds', (v: string) => parseInt(v, 10), 60)
  .option('--once', 'Check once and exit, instead of looping forever')
  .action(async (opts) => {
    console.log(chalk.bold(`Watching ${opts.dir} for due schedules (every ${opts.interval}s)`));

    do {
      const files = listScheduleFiles(opts.dir);
      for (const file of files) {
        try {
          await tick(file);
        } catch (error) {
          console.error(chalk.red(`Error processing ${file}: ${(error as Error).message}`));
        }
      }
      if (!opts.once) await sleep(opts.interval * 1000);
    } while (!opts.once);
  });

const listSubcommand = new Command('list')
  .description('List configured schedules and their last-run status')
  .option('-d, --dir <path>', 'Folder to scan for .schedule.json files', defaultScheduleDir())
  .action((opts) => {
    const files = listScheduleFiles(opts.dir);
    if (files.length === 0) {
      console.log(`No schedules found in ${opts.dir}`);
      return;
    }

    for (const file of files) {
      const config = readSchedule(file);
      console.log(chalk.bold(config.name), `(${config.id})`);
      console.log(`  recurrence: ${describeRecurrence(config.recurrence)}`);
      console.log(`  last run: ${config.state.lastRunAt ?? 'never'} — ${config.state.lastStatus ?? '-'}`);
      if (config.state.lastError) console.log(chalk.red(`  last error: ${config.state.lastError}`));
      console.log(`  times triggered: ${config.state.timesTriggered}`);
    }
  });

export const scheduleCommand = new Command('schedule')
  .description('Run scheduled saved jobs and email their results')
  .addCommand(runSubcommand)
  .addCommand(listSubcommand);
