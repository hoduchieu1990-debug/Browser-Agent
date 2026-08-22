import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import { WorkflowPlayer, runBatch, loadDataRows } from '@browser-agent/player';
import { printResult, printBatchResult, briefError } from '../formatters/console-formatter';

function parseParams(pairs: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of pairs) {
    const [key, ...rest] = pair.split('=');
    params[key] = rest.join('=');
  }
  return params;
}

export const runCommand = new Command('run')
  .description('Execute a workflow')
  .argument('<workflow-file>', 'Path to workflow JSON file')
  .option(
    '--param <key=value>',
    'Workflow parameter (repeatable)',
    (v: string, prev: string[]) => [...prev, v],
    [] as string[],
  )
  .option('--data <file>', 'CSV/XLSX file — run the workflow once per row, columns become params')
  .option('--stop-on-error', 'Stop the batch at the first failing row (default: keep going)')
  .option('-o, --output <dir>', 'Output directory', './')
  .option('--headed', 'Show browser UI')
  .option('--dry-run', 'Validate workflow only')
  .option('-v, --verbose', 'Verbose output')
  .option('--timeout <ms>', 'Global action timeout', (v: string) => parseInt(v, 10))
  .option('--browser <name>', 'Browser to use (chromium, firefox, webkit, edge)', 'chromium')
  .action(async (workflowFile: string, opts) => {
    if (!fs.existsSync(workflowFile)) {
      console.error(chalk.red(`Error: Workflow file not found: ${workflowFile}`));
      process.exit(4);
    }

    const player = new WorkflowPlayer({
      headless: !opts.headed,
      browser: opts.browser,
      timeout: opts.timeout,
    });

    const workflow = player.loadFromFile(workflowFile);
    const validation = await player.validate(workflow);
    if (!validation.valid) {
      console.error(chalk.red('Workflow validation failed:'));
      validation.errors.forEach((e) => console.error(`  - ${e.field}: ${e.message}`));
      process.exit(2);
    }

    if (opts.dryRun) {
      console.log(chalk.green('Workflow is valid and ready to run.'));
      return;
    }

    if (opts.verbose) {
      player.on('actionStart', (action) => console.log(`▶️  ${action.id}: ${action.type}`));
      player.on('actionEnd', (action, duration) => console.log(`✅ ${action.id} (${duration}ms)`));
    }

    try {
      if (opts.data) {
        const rows = await loadDataRows(opts.data);
        console.log(chalk.bold(`Running ${workflow.name} over ${rows.length} rows from ${opts.data}\n`));

        const batch = await runBatch(player, workflow, rows, {
          outputDir: opts.output,
          verbose: opts.verbose,
          stopOnError: opts.stopOnError,
          onRowEnd: (row) => {
            const label = Object.entries(row.params)
              .map(([key, value]) => `${key}=${value}`)
              .join(' ');
            const mark = row.success ? chalk.green('✓') : chalk.red('✕');
            const detail = row.success ? '' : chalk.red(` — ${briefError(row.error)}`);
            console.log(`${mark} [${row.index}/${rows.length}] ${label} (${row.durationMs}ms)${detail}`);
          },
        });

        printBatchResult(batch);
        process.exitCode = batch.failed > 0 ? 3 : 0;
        return;
      }

      const result = await player.run(workflow, parseParams(opts.param), {
        outputDir: opts.output,
        verbose: opts.verbose,
      });
      printResult(result);
      process.exitCode = result.success ? 0 : 3;
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exitCode = 1;
    } finally {
      await player.close();
    }
  });
