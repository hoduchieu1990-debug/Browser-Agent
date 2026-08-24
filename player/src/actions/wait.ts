import type { Page } from 'playwright';
import type { WaitAction, WaitForSelectorAction } from '@browser-agent/shared';
import { resolve, WAIT_TIMEOUT_MS } from '../utils/selector-engine';

export async function wait(page: Page, action: WaitAction): Promise<void> {
  await page.waitForTimeout(action.duration);
}

export async function waitForSelector(page: Page, action: WaitForSelectorAction): Promise<void> {
  // A step the user added specifically to wait for something is, by
  // definition, the "this may still be loading" case — it defaults to the
  // longer allowance, not the short interact one, when no explicit timeout
  // was set on the step itself.
  const timeout = action.timeout ?? WAIT_TIMEOUT_MS;
  const el = await resolve(page, action.selector, action.selectorFallbacks, timeout);
  await el.waitFor({ timeout });
}
