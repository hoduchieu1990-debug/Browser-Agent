import type { Page } from 'playwright';
import type { ClickAction } from '@browser-agent/shared';
import { locate } from '../utils/selector-engine';

export async function click(page: Page, action: ClickAction): Promise<void> {
  await locate(page, action.selector).click();
}
