import type { Page } from 'playwright';
import type { WaitAction, WaitForSelectorAction } from '@browser-agent/shared';
import { locate } from '../utils/selector-engine';

export async function wait(page: Page, action: WaitAction): Promise<void> {
  await page.waitForTimeout(action.duration);
}

export async function waitForSelector(page: Page, action: WaitForSelectorAction): Promise<void> {
  await locate(page, action.selector).first().waitFor({ timeout: action.timeout });
}
