import chalk from 'chalk';
import type { Workflow, WorkflowResult } from '@browser-agent/shared';
import type { BatchResult } from '@browser-agent/player';

export function printWorkflowInfo(workflow: Workflow): void {
  console.log(chalk.bold(`Workflow: ${workflow.name}`));
  console.log(`Version: ${workflow.version}`);
  if (workflow.metadata?.createdAt) console.log(`Created: ${workflow.metadata.createdAt}`);

  if (workflow.params?.length) {
    console.log('\nParameters:');
    for (const p of workflow.params) {
      console.log(`  - ${p.name} (${p.type}${p.required ? ', required' : ''})`);
    }
  }

  console.log('\nActions:');
  workflow.actions.forEach((action, i) => {
    const target = (action as any).url ?? (action as any).selector ?? '';
    console.log(`  ${i + 1}. ${action.type}${target ? ` → ${target}` : ''}`);
  });

  if (workflow.exportFormats?.length) {
    console.log('\nExport formats:');
    for (const f of workflow.exportFormats) console.log(`  - ${f.type}: ${f.output}`);
  }
}

export function printResult(result: WorkflowResult): void {
  if (result.success) {
    console.log(chalk.green('\n✅ Workflow completed successfully!'));
  } else {
    console.log(chalk.red('\n❌ Workflow failed'));
    if (result.error) console.log(chalk.red(`Error: ${result.error.message}`));
  }
  console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);
  if (Object.keys(result.files).length) {
    console.log('\nFiles:');
    for (const [key, file] of Object.entries(result.files)) console.log(`  - ${key}: ${file}`);
  }
}

// Playwright errors carry a multi-line call log with colour codes baked in;
// one clean line is all a batch row can show.
export function briefError(message = ''): string {
  return message
    .replace(/\[\d+m/g, '')
    .split('\n')[0]
    .trim();
}

export function printBatchResult(batch: BatchResult): void {
  const summary = `${batch.succeeded} succeeded, ${batch.failed} failed`;
  console.log(batch.failed ? chalk.yellow(`\n${summary}`) : chalk.green(`\n${summary}`));
  console.log(`Duration: ${(batch.durationMs / 1000).toFixed(1)}s`);

  if (batch.failed) {
    console.log(chalk.red('\nFailed rows:'));
    for (const row of batch.rows.filter((r) => !r.success)) {
      const label = Object.entries(row.params)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      console.log(chalk.red(`  [${row.index}] ${label} — ${briefError(row.error)}`));
    }
  }

  const files = Object.entries(batch.files);
  if (files.length) {
    console.log('\nFiles:');
    for (const [key, file] of files) console.log(`  - ${key}: ${file}`);
  } else {
    console.log(chalk.yellow('\nNo data captured — the workflow has no extract steps.'));
  }
}
