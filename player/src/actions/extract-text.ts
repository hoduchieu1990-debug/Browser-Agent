import type { Page } from 'playwright';
import type { ExtractTextAction } from '@browser-agent/shared';

export async function extractText(page: Page, action: ExtractTextAction): Promise<string> {
  const text = await page.locator(action.selector).first().textContent();
  if (text === null) throw new Error(`No element found for extractText at selector "${action.selector}"`);
  return text.trim();
}
