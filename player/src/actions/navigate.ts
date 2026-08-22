import type { Page } from 'playwright';
import type { NavigateAction } from '@browser-agent/shared';

export async function navigate(page: Page, action: NavigateAction): Promise<void> {
  await page.goto(action.url, { waitUntil: 'load' });
}
