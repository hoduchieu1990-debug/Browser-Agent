import type { Page } from 'playwright';
import type { EventEmitter } from 'events';
import type { WorkflowAction, GlobalSettings } from '@browser-agent/shared';
import type { RunContext } from '../types';
import { resolveAction } from './parameter-resolver';
import { toExecutionError } from './error-handler';
import { getActionHandler } from '../actions';
import { dismissWithSelectors } from '../actions/dismiss-popup';

export class ActionExecutor {
  constructor(
    private page: Page,
    private globalSettings: GlobalSettings,
    private emitter: EventEmitter,
  ) {}

  async execute(action: WorkflowAction, context: RunContext): Promise<void> {
    const resolved = resolveAction(action, context.params);

    const popupConfig = this.globalSettings.autoDismissPopup;
    if (popupConfig?.enabled && popupConfig.selectors?.length) {
      await dismissWithSelectors(this.page, popupConfig.selectors, popupConfig.timeout ?? 2000);
    }

    if (action.waitBefore) await this.page.waitForTimeout(action.waitBefore);

    this.emitter.emit('actionStart', resolved);
    const start = Date.now();

    const retryCount = action.retry?.count ?? 0;
    const retryDelay = action.retry?.delayMs ?? 0;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const handler = getActionHandler(action.type);
        const output = await handler(this.page, resolved, context);
        if ((resolved as any).output && output !== undefined) {
          context.variables[(resolved as any).output] = output;
        }
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < retryCount) await this.page.waitForTimeout(retryDelay);
      }
    }

    if (lastError) {
      const onError = action.onError ?? 'fail';
      if (onError === 'fail') {
        throw lastError;
      }
      context.logs.push(`[${onError}] ${action.id}: ${(lastError as Error).message}`);
      this.emitter.emit('error', toExecutionError(action.id, context.currentStep, lastError));
    }

    if (action.waitAfter) await this.page.waitForTimeout(action.waitAfter);

    this.emitter.emit('actionEnd', resolved, Date.now() - start);
  }
}
