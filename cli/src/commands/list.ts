import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export const listCommand = new Command('list')
  .description('List available workflows in a directory')
  .option('-d, --dir <path>', 'Directory to scan', './examples')
  .option('--tag <tag>', 'Filter by tag')
  .option('--details', 'Show details')
  .action((opts) => {
    if (!fs.existsSync(opts.dir)) {
      console.error(chalk.red(`Directory not found: ${opts.dir}`));
      process.exitCode = 4;
      return;
    }

    const files = fs.readdirSync(opts.dir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(opts.dir, file);
      const workflow = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const tags: string[] = workflow.metadata?.tags ?? [];

      if (opts.tag && !tags.includes(opts.tag)) continue;

      console.log(chalk.bold(file), '-', workflow.name);
      if (opts.details) {
        console.log(`  version: ${workflow.version}`);
        console.log(`  tags: ${tags.join(', ') || '-'}`);
        console.log(`  actions: ${workflow.actions?.length ?? 0}`);
      }
    }
  });
