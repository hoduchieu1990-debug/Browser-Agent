import type { Page } from 'playwright';
import type { DismissPopupAction } from '@browser-agent/shared';

export async function dismissPopup(page: Page, action: DismissPopupAction): Promise<void> {
  await dismissWithSelectors(page, action.selectors ?? [], action.timeout ?? 2000);
}

export async function dismissWithSelectors(
  page: Page,
  selectors: string[],
  timeout: number,
): Promise<void> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout })) {
        await locator.click({ timeout });
      }
    } catch {
      // selector not present within timeout — not a popup on this page, try the next one
    }
  }
}
