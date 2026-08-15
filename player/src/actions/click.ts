import type { Page } from 'playwright';
import type { ClickAction } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';

export async function click(page: Page, action: ClickAction): Promise<void> {
  const el = await resolve(page, action.selector, action.selectorFallbacks);
  await el.click();
}
