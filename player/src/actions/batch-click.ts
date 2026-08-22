import type { Page } from 'playwright';
import type { BatchClickAction } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';

export async function batchClick(page: Page, action: BatchClickAction): Promise<void> {
  const el = await resolve(page, action.selector, action.selectorFallbacks);
  await el.click();
}
