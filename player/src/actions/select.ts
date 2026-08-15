import type { Page } from 'playwright';
import type { SelectAction } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';

export async function select(page: Page, action: SelectAction): Promise<void> {
  const el = await resolve(page, action.selector, action.selectorFallbacks);
  await el.selectOption(action.value);
}
