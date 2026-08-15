import type { Page } from 'playwright';
import type { ExtractJsonAction } from '@browser-agent/shared';

export async function extractJson(page: Page, action: ExtractJsonAction): Promise<any> {
  const raw = action.selector
    ? await page.locator(action.selector).first().textContent()
    : await page.evaluate(() => document.body.textContent);

  if (!raw) throw new Error(`No content found for extractJson at selector "${action.selector}"`);

  const parsed = JSON.parse(raw);
  if (!action.path) return parsed;

  return action.path.split('.').reduce((value: any, key) => value?.[key], parsed);
}
