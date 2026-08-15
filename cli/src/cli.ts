import { Command } from 'commander';
import { runCommand } from './commands/run';
import { validateCommand } from './commands/validate';
import { listCommand } from './commands/list';
import { showCommand } from './commands/show';

export function buildCli(): Command {
  const program = new Command();
  program
    .name('browser-agent')
    .description('Run and manage browser automation workflows')
    .version('0.1.0');

  program.addCommand(runCommand);
  program.addCommand(validateCommand);
  program.addCommand(listCommand);
  program.addCommand(showCommand);

  return program;
}
