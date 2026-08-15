import { Command } from 'commander';
import { WorkflowPlayer } from '@browser-agent/player';
import { printWorkflowInfo } from '../formatters/console-formatter';

export const showCommand = new Command('show')
  .description('Show workflow details')
  .argument('<workflow-file>', 'Path to workflow JSON file')
  .action((workflowFile: string) => {
    const player = new WorkflowPlayer();
    const workflow = player.loadFromFile(workflowFile);
    printWorkflowInfo(workflow);
  });
