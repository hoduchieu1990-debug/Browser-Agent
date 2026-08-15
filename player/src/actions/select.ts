import type { Page } from 'playwright';
import type { SelectAction } from '@browser-agent/shared';
import { locate } from '../utils/selector-engine';

export async function select(page: Page, action: SelectAction): Promise<void> {
  await locate(page, action.selector).selectOption(action.value);
}
