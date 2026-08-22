import { EventEmitter } from 'events';
import * as fs from 'fs';
import type { Workflow, WorkflowResult, ValidationResult } from '@browser-agent/shared';
import { validateWorkflow } from '@browser-agent/shared';
import type { PlayerOptions, ExecutionOptions, RunContext } from './types';
import { PageContext } from './core/page-context';
import { ActionExecutor } from './core/action-executor';
import { toExecutionError } from './core/error-handler';
import { runExporters } from './exporters';

export class WorkflowPlayer extends EventEmitter {
  private pageContext: PageContext;

  constructor(private options: PlayerOptions = {}) {
    super();
    this.pageContext = new PageContext(options);
    // Node treats a listener-less 'error' emit as fatal and throws. Failures are
    // already reported through WorkflowResult.error, so keep a no-op subscriber
    // to stop a failed workflow from crashing the whole process.
    this.on('error', () => {});
  }

  loadFromFile(filePath: string): Workflow {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  loadFromObject(workflow: Workflow): Workflow {
    return workflow;
  }

  async validate(workflow: Workflow): Promise<ValidationResult> {
    return validateWorkflow(workflow);
  }

  async run(
    workflow: Workflow,
    params: Record<string, any> = {},
    options: ExecutionOptions = {},
  ): Promise<WorkflowResult> {
    const startTime = Date.now();
    const outputDir = options.outputDir ?? '.';
    fs.mkdirSync(outputDir, { recursive: true });

    const context: RunContext = {
      workflow,
      params,
      variables: {},
      currentStep: 0,
      logs: [],
      startTime,
      outputDir,
    };

    const page = await this.pageContext.launch();
    const executor = new ActionExecutor(page, workflow.globalSettings ?? {}, this);

    let error: WorkflowResult['error'];

    try {
      for (let i = 0; i < workflow.actions.length; i++) {
        context.currentStep = i;
        this.emit('progress', i + 1, workflow.actions.length);
        await executor.execute(workflow.actions[i], context);
      }
    } catch (err) {
      const action = workflow.actions[context.currentStep];
      error = toExecutionError(action.id, context.currentStep, err);
      context.logs.push(`[fail] ${action.id}: ${error.message}`);
    }

    const files: Record<string, string> = {};
    if (!error && workflow.exportFormats?.length) {
      Object.assign(files, await runExporters(workflow.exportFormats, context.variables, outputDir));
    }

    const result: WorkflowResult = {
      success: !error,
      data: context.variables,
      files,
      logs: context.logs,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      error,
    };

    this.emit('complete', result);
    if (error) this.emit('error', error);

    return result;
  }

  async close(): Promise<void> {
    await this.pageContext.close();
  }
}
