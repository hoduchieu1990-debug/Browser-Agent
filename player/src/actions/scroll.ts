import type { Page } from 'playwright';
import type { ScrollAction } from '@browser-agent/shared';

export async function scroll(page: Page, action: ScrollAction): Promise<void> {
  if (action.position === 'top') {
    await page.evaluate(() => window.scrollTo(0, 0));
  } else if (action.position === 'bottom') {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  } else if (action.position === 'center') {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  } else {
    await page.mouse.wheel(0, action.pixels ?? 500);
  }
}
