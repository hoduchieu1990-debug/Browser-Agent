import type { Page } from 'playwright';
import type { InputAction } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';

export async function input(page: Page, action: InputAction): Promise<void> {
  const el = await resolve(page, action.selector, action.selectorFallbacks);
  await el.fill(action.value);
}
