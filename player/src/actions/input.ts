import type { Page } from 'playwright';
import type { InputAction } from '@browser-agent/shared';
import { locate } from '../utils/selector-engine';

export async function input(page: Page, action: InputAction): Promise<void> {
  await locate(page, action.selector).fill(action.value);
}
