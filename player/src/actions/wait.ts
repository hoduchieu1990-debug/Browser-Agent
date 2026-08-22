import type { Page } from 'playwright';
import type { WaitAction, WaitForSelectorAction } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';

export async function wait(page: Page, action: WaitAction): Promise<void> {
  await page.waitForTimeout(action.duration);
}

export async function waitForSelector(page: Page, action: WaitForSelectorAction): Promise<void> {
  const el = await resolve(page, action.selector, action.selectorFallbacks, action.timeout);
  await el.waitFor({ timeout: action.timeout });
}
