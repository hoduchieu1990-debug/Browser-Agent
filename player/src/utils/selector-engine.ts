import type { Page, Locator } from 'playwright';

export function locate(page: Page, selector: string): Locator {
  const isXPath = selector.startsWith('//') || selector.startsWith('xpath=');
  return isXPath ? page.locator(`xpath=${selector.replace(/^xpath=/, '')}`) : page.locator(selector);
}

// Two tiers, not one timeout for every step: click/input/select act on a
// control that should already be on the page, so a wrong selector fails fast
// (INTERACT_TIMEOUT_MS). extractText/Table/Json, batchExtract, and
// screenshot read something that may still be loading or may only exist
// after a search — those pass WAIT_TIMEOUT_MS explicitly. Both replace what
// used to be a single unnamed 10s default that every action shared, which
// made a real search or a slow-loading page surface as an outright failure
// instead of just a slower success.
export const INTERACT_TIMEOUT_MS = 10000;
export const WAIT_TIMEOUT_MS = 30000;

// Playwright's :is() would merge the candidates into one locator, but that
// resolves to whichever matches first in document order rather than honouring
// the recorded preference — so try them in turn instead.
export async function resolve(
  page: Page,
  selector: string,
  fallbacks: string[] = [],
  timeout = INTERACT_TIMEOUT_MS,
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
