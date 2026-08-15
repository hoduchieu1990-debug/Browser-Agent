import { Command } from 'commander';
import chalk from 'chalk';
import { WorkflowPlayer } from '@browser-agent/player';

export const validateCommand = new Command('validate')
  .description('Validate a workflow file')
  .argument('<workflow-file>', 'Path to workflow JSON file')
  .option('--strict', 'Strict validation mode')
  .action(async (workflowFile: string, opts) => {
    const player = new WorkflowPlayer();
    const workflow = player.loadFromFile(workflowFile);
    const result = await player.validate(workflow);

    if (result.valid) {
      console.log(chalk.green('✓ JSON schema valid'));
      console.log(chalk.green('✓ All required fields present'));
      if (result.warnings.length) {
        result.warnings.forEach((w) => console.log(chalk.yellow(`⚠ ${w.field}: ${w.message}`)));
        if (opts.strict) {
          process.exitCode = 2;
          return;
        }
      }
      console.log(chalk.green('\nWorkflow is valid and ready to run.'));
    } else {
      console.error(chalk.red('✗ Validation failed:'));
      result.errors.forEach((e) => console.error(chalk.red(`  - ${e.field}: ${e.message}`)));
      process.exitCode = 2;
    }
  });
