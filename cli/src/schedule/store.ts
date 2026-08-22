import * as fs from 'fs';
import * as path from 'path';
import type { ScheduleConfig } from '@browser-agent/shared';

export function listScheduleFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.schedule.json'))
    .map((f) => path.join(dir, f));
}

export function readSchedule(filePath: string): ScheduleConfig {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function writeSchedule(filePath: string, config: ScheduleConfig): void {
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
}
