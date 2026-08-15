import type { Page, Locator } from 'playwright';

export function locate(page: Page, selector: string): Locator {
  const isXPath = selector.startsWith('//') || selector.startsWith('xpath=');
  return isXPath ? page.locator(`xpath=${selector.replace(/^xpath=/, '')}`) : page.locator(selector);
}
