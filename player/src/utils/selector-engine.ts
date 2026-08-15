import type { Page, Locator } from 'playwright';

export function locate(page: Page, selector: string): Locator {
  const isXPath = selector.startsWith('//') || selector.startsWith('xpath=');
  return isXPath ? page.locator(`xpath=${selector.replace(/^xpath=/, '')}`) : page.locator(selector);
}

// Playwright's :is() would merge the candidates into one locator, but that
// resolves to whichever matches first in document order rather than honouring
// the recorded preference — so try them in turn instead.
export async function resolve(
  page: Page,
  selector: string,
  fallbacks: string[] = [],
  timeout = 10000,
): Promise<Locator> {
  const candidates = [selector, ...fallbacks];
  const deadline = Date.now() + timeout;

  do {
    for (const candidate of candidates) {
      const locator = locate(page, candidate).first();
      if ((await locator.count()) > 0) return locator;
    }
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);

  const tried = candidates.length > 1 ? ` (tried ${candidates.length} selectors)` : '';
  throw new Error(`Element not found: ${selector}${tried}`);
}
