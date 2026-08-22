import type { Page } from 'playwright';
import type { BatchSearchAction } from '@browser-agent/shared';
import type { RunContext } from '../types';
import { resolve } from '../utils/selector-engine';

// Waiting on the Search trigger itself would be a no-op (it's already on the
// page). Absent an explicit wait target, the thing actually worth waiting for
// is whatever the recorded workflow extracts next.
function defaultWaitSelector(context: RunContext): string | undefined {
  const { actions } = context.workflow;
  for (let i = context.currentStep + 1; i < actions.length; i++) {
    const next = actions[i];
    if (next.type === 'batchExtract') return next.selector;
  }
  return undefined;
}

// A Search node is a click plus a wait for the result — a lone click here
// would leave Extract racing the page's own response.
export async function batchSearch(page: Page, action: BatchSearchAction, context: RunContext): Promise<void> {
  const trigger = await resolve(page, action.selector, action.selectorFallbacks);
  await trigger.click();

  const { selector, timeout } = action.waitCondition;
  const waitSelector = selector ?? defaultWaitSelector(context) ?? action.selector;
  const target = await resolve(page, waitSelector, undefined, timeout);
  await target.waitFor({ state: 'visible', timeout });
}
